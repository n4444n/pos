// สำรองข้อมูลอัตโนมัติลงคอมเครื่องนี้ (ตั้งค่าแยกแต่ละเครื่อง — หน้า ตั้งค่า → สำรอง & กู้คืนข้อมูล ในระบบ POS)
//   ทุก X นาที · ตอนปิดกะ · ตอนปิดโปรแกรม → ดาวน์โหลดไฟล์ .db จากเซิร์ฟเวอร์ร้าน แล้วบันทึกลงโฟลเดอร์ที่เลือก (ในเครื่องนี้เท่านั้น)
//   สำรองได้ทั้งร้าน หรือแยกไฟล์รายสาขา · ไฟล์ใช้กู้คืนได้ในหน้าเดิม
//   ใช้กุญแจของเครื่อง (ผู้จัดการเปิดให้) — สำรองได้แม้ยังไม่มีใครเข้าสู่ระบบ · กุญแจเข้ารหัสด้วย Windows (safeStorage)
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  enabled: false,
  intervalMin: 30,
  scope: 'all', //          'all' = ทั้งร้าน · 'branches' = แยกไฟล์ตามสาขาที่เลือก
  branchIds: [],
  folder: '',
  onShiftClose: true,
  onAppClose: true,
  skipUnchanged: true, //   ข้อมูลไม่เปลี่ยนตั้งแต่รอบก่อน → ไม่สร้างไฟล์ซ้ำ
  keepDays: 0, //           0 = เก็บทุกไฟล์ · มากกว่า 0 = ลบไฟล์ที่ระบบสร้างซึ่งเก่ากว่านี้
  deviceId: 0,
  deviceName: '',
  key: '', //               'enc:<base64>' (เข้ารหัสด้วย Windows) หรือ 'raw:<token>' (เครื่องที่เข้ารหัสไม่ได้)
  route: '', //             ร้านที่ออกกุญแจ (เปลี่ยน license เป็นร้านอื่น → กุญแจใช้ไม่ได้)
};
const KEEP = [0, 7, 14, 30, 60, 90, 180, 365];

function sanitizeAutoBackup(v) {
  const c = { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
  const n = Number(c.intervalMin);
  return {
    enabled: c.enabled === true,
    intervalMin: Number.isFinite(n) ? Math.min(1440, Math.max(5, Math.round(n))) : 30,
    scope: c.scope === 'branches' ? 'branches' : 'all',
    branchIds: Array.isArray(c.branchIds) ? [...new Set(c.branchIds.map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 100) : [],
    folder: typeof c.folder === 'string' ? c.folder.slice(0, 500) : '',
    onShiftClose: c.onShiftClose !== false,
    onAppClose: c.onAppClose !== false,
    skipUnchanged: c.skipUnchanged !== false,
    keepDays: KEEP.includes(Number(c.keepDays)) ? Number(c.keepDays) : 0,
    deviceId: Number.isInteger(Number(c.deviceId)) && Number(c.deviceId) > 0 ? Number(c.deviceId) : 0,
    deviceName: String(c.deviceName || '').slice(0, 80),
    key: /^(enc|raw):[\w+/=-]{10,2000}$/.test(String(c.key || '')) ? String(c.key) : '',
    route: /^[a-z0-9-]{0,30}$/.test(String(c.route || '')) ? String(c.route || '') : '',
  };
}

/** ชื่อไฟล์ที่ Windows ใช้ได้ */
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 60) || 'ร้าน';
const p2 = (n) => String(n).padStart(2, '0');
const stampOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
/** ไฟล์ที่ระบบนี้สร้าง: <ร้าน>_<ทั้งร้าน|สาขา>_YYYY-MM-DD_HHMM[-n].db */
const OUR_FILE = /_\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?\.db$/;

function createAutoBackup({ app, net, safeStorage, getConfig, saveConfig, broadcast, machineName = () => '' }) {
  const STATE_FILE = path.join(app.getPath('userData'), 'auto-backup-state.json');
  let state = { lastRunMs: 0, lastAt: null, ok: null, error: '', reason: '', files: [], skipped: false, stamps: {} };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch { /* ยังไม่เคยสำรอง */ }
  const saveState = () => {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch { /* เขียนไม่ได้ก็ข้าม */ }
  };
  let running = null;
  let timer = null;
  let quitDone = false;
  let skipQuit = false;

  const cfg = () => getConfig().autoBackup;
  const defaultFolder = () => path.join(app.getPath('documents'), 'Clothing POS Backup');
  const folderOf = (c = cfg()) => c.folder || defaultFolder();

  const enc = (token) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(token).toString('base64')}` : `raw:${token}`);
  const dec = (k) => {
    if (!k) return '';
    try {
      return k.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(k.slice(4), 'base64')) : k.slice(4);
    } catch {
      return '';
    }
  };

  /** บังคับเก็บในเครื่องนี้: ไม่รับโฟลเดอร์ในเครือข่าย (\\เครื่องอื่น\...) · ต้องเขียนได้ */
  function checkFolder(dir) {
    const d = String(dir || '');
    if (!d || !path.isAbsolute(d)) return 'เลือกโฟลเดอร์ในเครื่องนี้';
    if (/^\\\\|^\/\//.test(d)) return 'ต้องเลือกโฟลเดอร์ในคอมเครื่องนี้ (ไม่ใช่โฟลเดอร์ในเครือข่าย)';
    try {
      fs.mkdirSync(d, { recursive: true });
      const t = path.join(d, `.pos-write-test-${process.pid}`);
      fs.writeFileSync(t, 'ok');
      fs.unlinkSync(t);
      return '';
    } catch (e) {
      return `บันทึกลงโฟลเดอร์นี้ไม่ได้ (${e.code || e.message}) — ถ้าเป็นแฟลชไดรฟ์ ตรวจว่าเสียบอยู่`;
    }
  }

  const server = () => String(getConfig().serverUrl || '').replace(/\/+$/, '');
  async function call(p, token, extra = {}) {
    return net.fetch(`${server()}${p}`, { headers: { 'X-Backup-Key': token, ...extra }, cache: 'no-store', signal: AbortSignal.timeout(180_000) });
  }
  async function errorOf(res) {
    let msg = `เซิร์ฟเวอร์ตอบ ${res.status}`;
    let code = '';
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
      code = (j && j.code) || '';
    } catch { /* ไม่ใช่ JSON */ }
    return Object.assign(new Error(msg), { code, status: res.status });
  }

  function publicState() {
    const c = cfg();
    const { key: _k, ...rest } = c;
    const next = c.enabled ? Math.max(Date.now(), (state.lastRunMs || 0) + c.intervalMin * 60_000) : null;
    return {
      config: rest, hasKey: !!dec(c.key), keyForOtherShop: !!c.key && !!c.route && c.route !== (getConfig().license?.route || ''),
      folder: folderOf(c), defaultFolder: defaultFolder(), running: !!running, nextAt: next,
      last: { at: state.lastAt, ok: state.ok, error: state.error, reason: state.reason, files: state.files, skipped: state.skipped },
      version: app.getVersion(),
      machineName: machineName(), // ชื่อเครื่อง (ส่งไปพร้อมทุกสถานะ ไม่หายเมื่อสำรองเสร็จ)
    };
  }
  const notify = () => broadcast('pos:backup-status', publicState());

  /** สำรองตอนนี้ · reason: schedule | manual | shift | close */
  function run(reason) {
    if (running) return running;
    running = doRun(reason).finally(() => {
      running = null;
      notify();
    });
    notify();
    return running;
  }

  async function doRun(reason) {
    const c = cfg();
    state.lastRunMs = Date.now();
    state.reason = reason;
    const done = (ok, error, files = [], skipped = false) => {
      Object.assign(state, { lastAt: new Date().toISOString(), ok, error, files, skipped });
      saveState();
      return { ok, error, files, skipped };
    };
    const token = dec(c.key);
    if (!token) return done(false, 'เครื่องนี้ยังไม่ได้รับสิทธิ์สำรองอัตโนมัติ — เปิดสวิตช์ "สำรองอัตโนมัติ" ใหม่');
    const folder = folderOf(c);
    const bad = checkFolder(folder);
    if (bad) return done(false, bad);
    try {
      const ir = await call('/api/backup/auto/info', token);
      if (!ir.ok) throw await errorOf(ir);
      const info = await ir.json();
      const targets = c.scope === 'all'
        ? [{ id: null, label: 'ทั้งร้าน' }]
        : (info.branches || []).filter((b) => c.branchIds.includes(b.id)).map((b) => ({ id: b.id, label: b.code ? `${b.code} ${b.name}` : b.name }));
      if (!targets.length) return done(false, 'สาขาที่เลือกไว้ไม่มีในระบบแล้ว — เลือกสาขาใหม่');
      const files = [];
      let allSkipped = true;
      for (const t of targets) {
        const k = `${getConfig().license?.route || 'main'}:${t.id ?? 'all'}`;
        const since = c.skipUnchanged && reason !== 'manual' && state.stamps[k] ? { 'X-Backup-Since': state.stamps[k] } : {}; // กดสำรองเอง = สร้างไฟล์เสมอ
        const res = await call(`/api/backup/auto${t.id ? `?branch=${t.id}` : ''}`, token, since);
        if (res.status === 304) continue; // ข้อมูลไม่เปลี่ยน
        if (!res.ok) throw await errorOf(res);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw new Error('ไฟล์ที่ได้ไม่ใช่ฐานข้อมูล — ลองใหม่อีกครั้ง');
        allSkipped = false;
        const base = `${safe(info.shop)}_${safe(t.label)}_${stampOf(new Date())}`;
        let name = `${base}.db`;
        for (let i = 2; fs.existsSync(path.join(folder, name)); i++) name = `${base}-${i}.db`;
        const tmp = path.join(folder, `.${name}.tmp`);
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, path.join(folder, name));
        files.push({ name, size: buf.length });
        state.stamps[k] = res.headers.get('x-backup-stamp') || '';
      }
      prune(folder, safe(info.shop), c.keepDays);
      return done(true, '', files, allSkipped);
    } catch (e) {
      if (e.code === 'BACKUP_KEY') saveConfig({ autoBackup: { ...cfg(), key: '', deviceId: 0 } }); // ถูกยกเลิกสิทธิ์ → ต้องเปิดใหม่
      const msg = e.name === 'TimeoutError' || /fetch|network|ERR_/i.test(e.message) ? `ติดต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ต (${e.message})` : e.message;
      return done(false, msg);
    }
  }

  /** ลบไฟล์ที่ระบบนี้สร้างซึ่งเก่ากว่า keepDays วัน (ไม่แตะไฟล์อื่นในโฟลเดอร์) */
  function prune(folder, shop, keepDays) {
    if (!keepDays) return;
    const cut = Date.now() - keepDays * 86_400_000;
    try {
      for (const f of fs.readdirSync(folder)) {
        if (!f.startsWith(`${shop}_`) || !OUR_FILE.test(f)) continue;
        const p = path.join(folder, f);
        if (fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p);
      }
    } catch { /* โฟลเดอร์หาย */ }
  }

  /** ไฟล์ .db ในโฟลเดอร์ (ใหม่สุดก่อน) */
  function listFiles() {
    const folder = folderOf();
    try {
      return fs.readdirSync(folder)
        .filter((f) => /\.(db|sqlite3?)$/i.test(f) && !f.startsWith('.'))
        .map((f) => {
          const st = fs.statSync(path.join(folder, f));
          return { name: f, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 50);
    } catch {
      return [];
    }
  }
  /** อ่านไฟล์ในโฟลเดอร์ (ไว้กู้คืน) — ชื่อไฟล์อย่างเดียว ห้ามมี path */
  function readFile(name) {
    const n = String(name || '');
    if (!n || n !== path.basename(n) || !/\.(db|sqlite3?)$/i.test(n)) throw new Error('ชื่อไฟล์ไม่ถูกต้อง');
    const p = path.join(folderOf(), n);
    const st = fs.statSync(p);
    if (st.size > 500 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 500 MB');
    return fs.readFileSync(p);
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      const c = cfg();
      if (!c.enabled || running) return;
      // ล้มเหลว → ลองใหม่ใน 5 นาที (ไม่ต้องรอครบรอบ)
      const wait = state.ok === false ? Math.min(c.intervalMin, 5) : c.intervalMin;
      if (Date.now() - (state.lastRunMs || 0) >= wait * 60_000) run('schedule');
    }, 30_000);
  }

  return {
    sanitize: sanitizeAutoBackup,
    start,
    run,
    state: publicState,
    listFiles,
    readFile,
    checkFolder,
    /** บันทึกค่าจากหน้าเว็บ (ไม่รับกุญแจจากช่องนี้) */
    save(v) {
      const cur = cfg();
      const next = sanitizeAutoBackup({ ...cur, ...v, key: cur.key, deviceId: cur.deviceId, deviceName: cur.deviceName, route: cur.route });
      if (next.folder && checkFolder(next.folder)) next.folder = cur.folder;
      const turnedOn = next.enabled && !cur.enabled;
      saveConfig({ autoBackup: next });
      if (turnedOn) setTimeout(() => run('manual'), 500); // เปิดแล้วสำรองครั้งแรกทันที
      notify();
      return publicState();
    },
    setKey({ id, token, name }) {
      if (!/^pbk_[a-f0-9]{48}$/.test(String(token || ''))) return false;
      saveConfig({ autoBackup: { ...cfg(), key: enc(String(token)), deviceId: Number(id) || 0, deviceName: String(name || ''), route: getConfig().license?.route || '' } });
      state.stamps = {};
      saveState();
      notify();
      return true;
    },
    clearKey() {
      saveConfig({ autoBackup: { ...cfg(), key: '', deviceId: 0, enabled: false } });
      notify();
    },
    /** ปิดกะ (จากหน้าเว็บ) */
    trigger(reason) {
      const c = cfg();
      if (c.enabled && reason === 'shift' && c.onShiftClose) run('shift');
    },
    /** ปิดโปรแกรม: สำรองก่อน (รอไม่เกิน 30 วินาที) · คืน true = กันการปิดไว้ก่อน แล้วปิดเองเมื่อเสร็จ */
    beforeQuit(quit) {
      const c = cfg();
      if (quitDone || skipQuit || !c.enabled || !c.onAppClose || !dec(c.key)) return false;
      quitDone = true;
      Promise.race([run('close'), new Promise((r) => setTimeout(r, 30_000))]).finally(quit);
      return true;
    },
    /** ติดตั้งอัปเดต → ไม่ต้องสำรองตอนปิด */
    skipOnQuit() {
      skipQuit = true;
    },
  };
}

module.exports = { createAutoBackup, sanitizeAutoBackup, AUTO_BACKUP_DEFAULTS: DEFAULTS };
