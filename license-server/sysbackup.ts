// ระบบสำรองข้อมูลทั้งระบบ — 1 ครั้ง = 1 ไฟล์ zip ที่มีข้อมูล license + ทุกร้าน (ใช้กู้คืนเมื่อเซิร์ฟเวอร์ล่ม/โดนแฮก)
//
//   backup_09_11_2026_1430_0012.zip   (วันทำการ_เวลาที่สำรอง_ครั้งที่ — เลขครั้งที่กระโดด = มีรอบที่หายไป)
//   ├── manifest.json                 ข้อมูลไฟล์: folder ไหนเป็นร้านไหน (เปลี่ยนชื่อร้านทีหลังก็กู้คืนเข้าร้านเดิมได้)
//   ├── license/license.db            license ทั้งหมด · เครื่องที่ลงทะเบียน · ประวัติ (+ internal-secret.txt)
//   ├── <ชื่อร้าน>/pos.db              ข้อมูลทุกสาขาของร้าน (+ .pin-secret · uploads/ = รูปสินค้า เฉพาะรอบปิดวัน/ด้วยมือ/ก่อนกู้คืน)
//   └── ...
//
// ตารางเวลา (เวลาไทยเสมอ) · วันทำการจบตี 3 → วันที่ของวันทำการ = วันที่ของ (เวลาตอนนี้ − 3 ชม.)
//   ทุก 30 นาที    สำรองระหว่างวัน — ข้ามถ้าฐานข้อมูลทุกไฟล์ไม่ถูกแก้หลังการสำรองครั้งล่าสุด (ดูเวลาแก้ไข .db และ -wal)
//   02:50–02:59    รอบปิดวัน (ไม่ข้าม · มีรูปสินค้า) ลองทุก 2 นาทีจนกว่าจะสำเร็จ
//   หลัง 03:00     ปิดวัน: เก็บรอบปิดวันที่สำเร็จ (ไม่มี → ไฟล์ล่าสุดที่สำเร็จ) เป็นไฟล์รายวัน แล้วลบไฟล์ระหว่างวันของวันนั้น
//                  วันที่ 1 ของเดือน = ไฟล์รายเดือน (เก็บ 12 เดือน)
//   เก็บไฟล์รายวัน 35 วัน · เก่ากว่านั้นลบเฉพาะไฟล์ที่ดาวน์โหลดแล้ว · ด้วยมือ/ก่อนกู้คืน/อัปโหลด 14 วัน
//
// รายการไฟล์สำรองเก็บแยกใน <โฟลเดอร์สำรอง>/backups.db (ไม่อยู่ใน license.db — กู้คืน license แล้วรายการไม่ย้อนตาม)
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';
import { db, DB_PATH } from './store.ts';
import { ZipReader, ZipWriter, zipToFile } from './zip.ts';
import { makeDataOps, MAIN_TARGET, type DataOps } from './dataops.ts';

// ---------------------------------------------------------------- ตั้งค่า
const env = process.env;
const num = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== undefined ? Math.min(max, Math.max(min, Math.round(n))) : d;
};
const hm = (v: string | undefined, d: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? '');
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : d;
};
const CUTOFF = hm(env.BACKUP_DAY_CUTOFF, 180);
export const CFG = {
  interval: num(env.BACKUP_INTERVAL_MIN, 30, 5, 720),
  cutoff: CUTOFF,
  finalStart: (hm(env.BACKUP_FINAL_START, CUTOFF - 10) + 1440) % 1440,
  finalEnd: (hm(env.BACKUP_FINAL_END, CUTOFF - 1) + 1440) % 1440,
  finalEvery: 2,
  dailyKeep: num(env.BACKUP_DAILY_KEEP_DAYS, 35, 1, 3650),
  monthlyKeep: num(env.BACKUP_MONTHLY_KEEP_MONTHS, 12, 0, 120),
  shortKeep: num(env.BACKUP_PRERESTORE_KEEP_DAYS, 14, 1, 365),
  diskWarn: num(env.BACKUP_DISK_WARN_PCT, 20, 1, 90),
  uploadMax: num(env.BACKUP_UPLOAD_MAX_MB, 2048, 10, 20_000) * 1024 * 1024,
};

// ---------------------------------------------------------------- เวลาไทย (UTC+7 ไม่มีเวลาออมแสง) — ไม่ขึ้นกับเวลาของเครื่อง
const TZ = 7 * 3600_000;
const p2 = (n: number) => String(n).padStart(2, '0');
const bk = (ms: number) => {
  const d = new Date(ms + TZ);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
};
export const stampTh = (ms = Date.now()) => {
  const t = bk(ms);
  return `${t.y}-${p2(t.mo)}-${p2(t.d)} ${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}`;
};
/** วันทำการ YYYY-MM-DD (ก่อนตี 3 = ของเมื่อวาน) */
export const businessDate = (ms = Date.now()) => stampTh(ms - CFG.cutoff * 60_000).slice(0, 10);
const minuteOfDay = (ms: number) => {
  const t = bk(ms);
  return t.h * 60 + t.mi;
};
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (ymd: string, n: number) => {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const inWindow = (m: number, a: number, b: number) => (a <= b ? m >= a && m <= b : m >= a || m <= b);

// ---------------------------------------------------------------- ชนิดข้อมูล
export type Kind = 'intraday' | 'final' | 'manual' | 'daily' | 'monthly' | 'pre-restore' | 'uploaded';
const FOLDER: Record<Kind, string> = {
  intraday: 'intraday', final: 'intraday', manual: 'manual', daily: 'daily', monthly: 'monthly', 'pre-restore': 'pre-restore', uploaded: 'uploaded',
};
export const KIND_LABEL: Record<Kind, string> = {
  intraday: 'ระหว่างวัน', final: 'รอบปิดวัน', manual: 'ด้วยมือ', daily: 'รายวัน', monthly: 'รายเดือน', 'pre-restore': 'ก่อนกู้คืน', uploaded: 'อัปโหลด',
};

export interface ShopRef { slug: string; name: string; isMain: boolean; port: number; licenseId: number }

interface ShopSummary {
  slug: string; name: string; folder: string; isMain: boolean; ok: boolean; error: string;
  schema: number; branches: number; bills: number; lastBillAt: string | null; files: number; withFiles: boolean;
}
interface Manifest {
  format: string; version: number; seq: number; kind: Kind; businessDate: string; createdAt: string; withFiles: boolean;
  license: { folder: string; ok: boolean; error: string; licenses: number; secret: boolean };
  shops: ShopSummary[];
}
export interface SnapshotRow {
  id: number; seq: number; kind: Kind; business_date: string; created_at: string; created_ms: number; file: string; size: number;
  sha256: string; status: 'ok' | 'partial' | 'failed'; error: string; with_files: number; shops: string; note: string;
  downloaded_at: string | null; deleted_at: string | null;
}

const FORMAT = 'clothing-pos-system-backup';
const NO_COMPRESS = /\.(jpe?g|png|webp|gif|zip|gz|mp4)$/i;

export interface Deps {
  mode: 'systemd' | 'local';
  /** ร้านทั้งหมดที่มีระบบร้าน (มีแถวใน instances) */
  shops(): ShopRef[];
  /** local: หยุดร้าน (คืน true = เดิมเปิดอยู่) / เปิดร้าน */
  stopShop(slug: string): Promise<boolean>;
  startShop(slug: string): Promise<void>;
  /** ร้านทดลองที่ยังไม่มีบนเครื่องนี้ (กู้คืนลงเซิร์ฟเวอร์ใหม่) → สร้างระบบร้านก่อน */
  createShop(slug: string): Promise<void>;
  waitHealthy(port: number, ms: number): Promise<void>;
  /** หลังกู้คืน license.db: ตั้งค่าร้านหลักใหม่ · needRestart = ไฟล์ความลับเปลี่ยน ต้องเริ่มระบบ license ใหม่ */
  afterLicenseRestore(needRestart: boolean): void;
  logEvent(licenseId: number | null, kind: string, detail: string): void;
}

class BusyError extends Error {}
const LOCAL_MAIN = 'โหมดทดสอบ: ร้านหลักรันแยกหน้าต่าง (run-test) — กู้คืนจากแผงควบคุมไม่ได้ ทดสอบกู้คืนกับร้านทดลองแทน';

// ---------------------------------------------------------------- ระบบสำรองข้อมูล
export class SystemBackup {
  readonly root: string;
  private ops: DataOps;
  private deps: Deps;
  private idx!: DatabaseSync;
  ready = false;
  initError = '';
  busy: string | null = null;
  private lastSlot = -1;
  private lastFinalTry = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: Deps) {
    this.deps = deps;
    this.root = resolve(env.SYSTEM_BACKUP_DIR ?? (deps.mode === 'systemd' ? '/var/lib/pos-backups' : join(dirname(DB_PATH), 'system-backups')));
    this.ops = makeDataOps(deps.mode, this.root, {
      stop: async (t) => {
        if (t === MAIN_TARGET) throw new Error(LOCAL_MAIN);
        return deps.stopShop(t);
      },
      start: (t) => deps.startShop(t),
    });
  }

  // ---------------------------------------------------------------- เริ่มระบบ
  async init() {
    try {
      await this.ops.init();
      for (const k of new Set(Object.values(FOLDER))) mkdirSync(join(this.root, k), { recursive: true, mode: 0o700 });
      mkdirSync(this.ops.stage, { recursive: true, mode: 0o700 });
      this.idx = new DatabaseSync(join(this.root, 'backups.db'));
      this.idx.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS snapshots (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          seq           INTEGER NOT NULL DEFAULT 0,
          kind          TEXT NOT NULL,
          business_date TEXT NOT NULL,
          created_at    TEXT NOT NULL,
          created_ms    INTEGER NOT NULL,
          file          TEXT NOT NULL DEFAULT '',
          size          INTEGER NOT NULL DEFAULT 0,
          sha256        TEXT NOT NULL DEFAULT '',
          status        TEXT NOT NULL,
          error         TEXT NOT NULL DEFAULT '',
          with_files    INTEGER NOT NULL DEFAULT 0,
          shops         TEXT NOT NULL DEFAULT '[]',
          note          TEXT NOT NULL DEFAULT '',
          downloaded_at TEXT,
          deleted_at    TEXT
        );
        CREATE INDEX IF NOT EXISTS snapshots_day ON snapshots (business_date, kind);
        CREATE TABLE IF NOT EXISTS runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, result TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, key TEXT NOT NULL DEFAULT '', dismissed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      if (!this.meta('closed_through')) this.setMeta('closed_through', addDays(businessDate(), -1));
      this.ready = true;
      this.cleanStage(0);
    } catch (e) {
      this.initError = (e as Error).message;
      console.error('[system-backup] เริ่มระบบสำรองข้อมูลไม่สำเร็จ:', this.initError);
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((e) => console.error('[system-backup]', e)), 20_000);
    this.timer.unref?.();
    setTimeout(() => this.tick().catch((e) => console.error('[system-backup]', e)), 5000).unref?.();
  }

  private meta(key: string) {
    return (this.idx.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? '';
  }
  private setMeta(key: string, value: string) {
    this.idx.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  private logRun(kind: string, result: string, detail = '') {
    this.idx.prepare('INSERT INTO runs (at, kind, result, detail) VALUES (?, ?, ?, ?)').run(stampTh(), kind, result, detail.slice(0, 500));
  }
  /** แจ้งเตือนบนแผงควบคุม (LINE: เพิ่มทีหลังที่ฟังก์ชันนี้) · key = ไม่แจ้งซ้ำ */
  alert(level: 'info' | 'warn' | 'urgent', message: string, key = '') {
    if (key && this.idx.prepare('SELECT 1 FROM alerts WHERE key = ?').get(key)) return;
    this.idx.prepare('INSERT INTO alerts (at, level, message, key) VALUES (?, ?, ?, ?)').run(stampTh(), level, message.slice(0, 500), key);
    console.log(`[system-backup] ${level}: ${message}`);
  }
  dismissAlert(id: number) {
    this.idx.prepare('UPDATE alerts SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL').run(stampTh(), id);
  }

  private async exclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.ready) throw new Error(`ระบบสำรองข้อมูลยังไม่พร้อม: ${this.initError || 'กำลังเริ่มระบบ'}`);
    if (this.busy) throw new BusyError(`กำลัง${this.busy}อยู่ — รอสักครู่แล้วลองใหม่`);
    this.busy = label;
    try {
      return await fn();
    } finally {
      this.busy = null;
    }
  }

  // ---------------------------------------------------------------- ตัวตั้งเวลา
  async tick(now = Date.now()) {
    if (!this.ready || this.busy) return;
    const bd = businessDate(now);
    // ปิดวันที่ค้าง (หลังตี 3 · หรือเซิร์ฟเวอร์ปิดไปหลายวัน)
    if (this.meta('closed_through') < addDays(bd, -1)) {
      await this.exclusive('ปิดวัน', async () => this.closeDays(bd));
      return;
    }
    if (this.meta('pruned_for') !== bd) {
      this.prune(now);
      this.setMeta('pruned_for', bd);
    }
    const m = minuteOfDay(now);
    if (inWindow(m, CFG.finalStart, CFG.finalEnd)) {
      const done = this.idx.prepare("SELECT 1 FROM snapshots WHERE business_date = ? AND kind IN ('final','daily','monthly') AND status = 'ok' AND deleted_at IS NULL").get(bd);
      if (!done && now - this.lastFinalTry >= CFG.finalEvery * 60_000 - 5000) {
        this.lastFinalTry = now;
        await this.exclusive('สำรองรอบปิดวัน', () => this.snapshot('final', true, true)).catch((e) => console.error('[system-backup] final', e));
      }
      return;
    }
    const slot = Math.floor((now + TZ) / 60_000 / CFG.interval);
    if (slot !== this.lastSlot) {
      this.lastSlot = slot;
      await this.exclusive('สำรองข้อมูล', () => this.snapshot('intraday', false, false)).catch((e) => console.error('[system-backup] intraday', e));
    }
  }

  /** เวลาที่จะสำรองรอบถัดไป (เวลาไทย HH:MM) */
  private nextRun(now = Date.now()) {
    const m = minuteOfDay(now);
    if (inWindow(m, CFG.finalStart, CFG.finalEnd)) return 'รอบปิดวัน (กำลังทำ)';
    const next = (Math.floor((now + TZ) / 60_000 / CFG.interval) + 1) * CFG.interval * 60_000 - TZ;
    const t = bk(next);
    return `${p2(t.h)}:${p2(t.mi)}`;
  }

  // ---------------------------------------------------------------- สำรอง
  /** สำรองตอนนี้ (ปุ่มในแผงควบคุม) — มีรูปสินค้า · ไม่ข้าม */
  backupNow() {
    return this.exclusive('สำรองข้อมูล', async () => {
      const r = await this.snapshot('manual', true, true);
      if ('skipped' in r) return r;
      if (r.status === 'failed') throw new Error(`สำรองข้อมูลไม่สำเร็จ: ${r.error}`);
      return view(r);
    });
  }

  private lastSuccessMs() {
    return (this.idx.prepare("SELECT MAX(created_ms) AS t FROM snapshots WHERE status IN ('ok','partial') AND kind IN ('intraday','final','manual','daily','monthly','pre-restore')").get() as { t: number | null }).t ?? 0;
  }

  /** สร้างไฟล์สำรองทั้งระบบ 1 ไฟล์ · force = ไม่ข้ามแม้ข้อมูลไม่เปลี่ยน */
  private async snapshot(kind: Kind, withFiles: boolean, force: boolean): Promise<SnapshotRow | { skipped: true }> {
    const startMs = Date.now();
    const shops = this.deps.shops();
    if (!force) {
      const last = this.lastSuccessMs();
      if (last) {
        let changed = 0;
        for (const f of [DB_PATH, `${DB_PATH}-wal`]) if (existsSync(f)) changed = Math.max(changed, statSync(f).mtimeMs);
        for (const s of shops) changed = Math.max(changed, (await this.ops.stat(s.isMain ? MAIN_TARGET : s.slug).catch(() => Date.now())) ?? 0);
        const known = new Set((JSON.parse((this.idx.prepare("SELECT shops FROM snapshots WHERE status IN ('ok','partial') ORDER BY created_ms DESC LIMIT 1").get() as { shops: string } | undefined)?.shops ?? '[]') as ShopSummary[]).map((s) => s.slug));
        const newShop = shops.some((s) => !known.has(s.slug));
        if (changed <= last && !newShop) {
          this.logRun(kind, 'skipped', 'ข้อมูลไม่เปลี่ยนตั้งแต่การสำรองครั้งล่าสุด');
          return { skipped: true };
        }
      }
    }
    const seq = Number(this.meta('seq') || 0) + 1;
    this.setMeta('seq', String(seq));
    const bd = businessDate(startMs);
    const t = bk(startMs);
    const name = `backup_${bd.slice(8, 10)}_${bd.slice(5, 7)}_${bd.slice(0, 4)}_${p2(t.h)}${p2(t.mi)}_${String(seq).padStart(4, '0')}.zip`;
    const rel = `${FOLDER[kind]}/${name}`;
    const job = `snap-${startMs}-${randomBytes(3).toString('hex')}`;
    const stageDirs: string[] = [];
    const insert = (status: string, extra: Partial<SnapshotRow>) => {
      const r = this.idx.prepare(
        `INSERT INTO snapshots (seq, kind, business_date, created_at, created_ms, file, size, sha256, status, error, with_files, shops, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(seq, kind, bd, stampTh(startMs), startMs, extra.file ?? '', extra.size ?? 0, extra.sha256 ?? '', status, (extra.error ?? '').slice(0, 1000),
        withFiles ? 1 : 0, extra.shops ?? '[]', extra.note ?? '');
      return this.idx.prepare('SELECT * FROM snapshots WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as SnapshotRow;
    };
    try {
      // ---- license.db (ระบบ license เป็นเจ้าของไฟล์เอง)
      const lic = { folder: 'license', ok: false, error: '', licenses: 0, secret: false };
      const licDir = join(this.ops.stage, `${job}-license`);
      stageDirs.push(licDir);
      try {
        mkdirSync(licDir, { recursive: true });
        db.exec(`VACUUM INTO '${join(licDir, 'license.db').replace(/'/g, "''")}'`);
        lic.licenses = checkLicenseDb(join(licDir, 'license.db'));
        const secret = join(dirname(DB_PATH), 'internal-secret.txt');
        if (existsSync(secret)) { copyFileSync(secret, join(licDir, 'internal-secret.txt')); lic.secret = true; }
        lic.ok = true;
      } catch (e) {
        lic.error = (e as Error).message;
      }
      // ---- ทุกร้าน
      const used = new Set<string>(['license', 'manifest.json']);
      const summaries: (ShopSummary & { dir: string })[] = [];
      for (const [i, s] of shops.entries()) {
        const folder = folderName(s, used);
        const sum: ShopSummary & { dir: string } = {
          slug: s.slug, name: s.name, folder, isMain: s.isMain, ok: false, error: '', schema: 0, branches: 0, bills: 0, lastBillAt: null, files: 0, withFiles, dir: '',
        };
        const sub = `${job}-s${i}`;
        stageDirs.push(join(this.ops.stage, sub));
        try {
          const target = s.isMain ? MAIN_TARGET : s.slug;
          if ((await this.ops.stat(target)) === null) throw new Error('ยังไม่มีฐานข้อมูล (ร้านยังไม่เคยเปิด)');
          sum.dir = await this.ops.snap(target, sub, withFiles);
          Object.assign(sum, preparePosDb(join(sum.dir, 'pos.db')));
          sum.ok = true;
        } catch (e) {
          sum.error = (e as Error).message;
        }
        summaries.push(sum);
      }
      const okCount = summaries.filter((s) => s.ok).length + (lic.ok ? 1 : 0);
      const errors = [lic.ok ? '' : `license: ${lic.error}`, ...summaries.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`)].filter(Boolean);
      const shopsJson = JSON.stringify(summaries.map(({ dir: _d, ...x }) => x));
      if (!okCount) {
        const row = insert('failed', { error: errors.join(' · ') || 'ไม่มีข้อมูลให้สำรอง', shops: shopsJson });
        this.afterFail(kind, row.error);
        return row;
      }
      for (const s of summaries) if (s.ok) s.files = listFiles(s.dir).length;
      // ---- เขียน zip (ไฟล์ชั่วคราว → เปลี่ยนชื่อครั้งเดียว ไม่มีไฟล์ครึ่ง ๆ)
      const manifest: Manifest = {
        format: FORMAT, version: 1, seq, kind, businessDate: bd, createdAt: stampTh(startMs), withFiles,
        license: lic, shops: summaries.map(({ dir: _d, ...x }) => x),
      };
      const tmp = join(this.root, FOLDER[kind], `.${name}.tmp`);
      const out = zipToFile(tmp);
      let size = 0;
      try {
        await out.zip.add('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
        if (lic.ok) await addDir(out.zip, licDir, 'license');
        for (const s of summaries) if (s.ok) await addDir(out.zip, s.dir, s.folder);
        size = await out.close();
      } catch (e) {
        out.abort();
        rmSync(tmp, { force: true });
        throw e;
      }
      const sha256 = await sha256Of(tmp);
      renameSync(tmp, join(this.root, rel));
      const status = errors.length ? 'partial' : 'ok';
      const row = insert(status, { file: rel, size, sha256, error: errors.join(' · '), shops: JSON.stringify(manifest.shops) });
      this.logRun(kind, status, `${name} · ${Math.round(size / 1024)} KB${errors.length ? ` · ${errors.join(' · ')}` : ''}`);
      if (status === 'partial') this.alert('warn', `สำรองข้อมูลบางร้านไม่สำเร็จ (${name}): ${errors.join(' · ')}`, `partial-${bd}`);
      this.checkDisk();
      return row;
    } catch (e) {
      const msg = (e as Error).message;
      const row = insert('failed', { error: msg });
      this.afterFail(kind, msg);
      return row;
    } finally {
      for (const d of stageDirs) rmSync(d, { recursive: true, force: true });
    }
  }

  private afterFail(kind: Kind, msg: string) {
    this.logRun(kind, 'failed', msg);
    const last = this.idx.prepare("SELECT result FROM runs WHERE result <> 'skipped' ORDER BY id DESC LIMIT 3").all() as { result: string }[];
    if (last.length === 3 && last.every((r) => r.result === 'failed')) this.alert('urgent', `สำรองข้อมูลล้มเหลว 3 รอบติดกัน — ล่าสุด: ${msg}`, `fail3-${businessDate()}`);
  }

  private checkDisk() {
    const d = this.disk();
    if (d && d.freePct < CFG.diskWarn) this.alert('warn', `พื้นที่ดิสก์เหลือ ${d.freePct}% (${fmtSize(d.free)}) — ต่ำกว่า ${CFG.diskWarn}%`, `disk-${businessDate()}`);
  }

  disk() {
    try {
      const s = statfsSync(this.root);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      const used = (this.idx.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM snapshots WHERE deleted_at IS NULL').get() as { n: number }).n;
      return { total, free, freePct: total ? Math.round((free / total) * 100) : 0, backups: used };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- ปิดวัน + เก็บ/ลบไฟล์
  private async closeDays(today: string) {
    let d = addDays(this.meta('closed_through'), 1);
    for (let i = 0; i < 60 && d < today; i++, d = addDays(d, 1)) {
      this.closeDay(d);
      this.setMeta('closed_through', d);
    }
    if (d < today) this.setMeta('closed_through', addDays(today, -1)); // ปิดไปนานเกิน 60 วัน
    this.prune(Date.now());
    this.setMeta('pruned_for', today);
  }

  private closeDay(d: string) {
    if (this.idx.prepare("SELECT 1 FROM snapshots WHERE business_date = ? AND kind IN ('daily','monthly') AND deleted_at IS NULL").get(d)) return;
    const rows = this.idx.prepare(
      "SELECT * FROM snapshots WHERE business_date = ? AND kind IN ('intraday','final','manual') AND deleted_at IS NULL AND file <> '' ORDER BY created_ms DESC",
    ).all(d) as unknown as SnapshotRow[];
    const usable = rows.filter((r) => existsSync(join(this.root, r.file)));
    const pick =
      usable.find((r) => r.kind === 'final' && r.status === 'ok') ??
      usable.find((r) => r.status === 'ok') ??
      usable.find((r) => r.status === 'partial');
    const dest: Kind = d.endsWith('-01') ? 'monthly' : 'daily';
    if (!pick) {
      this.alert('urgent', `ไม่มีไฟล์สำรองที่สำเร็จของวันที่ ${thDate(d)} เลย — ตรวจระบบสำรองข้อมูล`, `none-${d}`);
      this.idx.prepare("INSERT INTO snapshots (kind, business_date, created_at, created_ms, status, error) VALUES (?, ?, ?, ?, 'failed', ?)")
        .run(dest, d, stampTh(), Date.now(), 'ไม่มีไฟล์สำรองที่สำเร็จของวันนี้');
      return;
    }
    if (pick.kind !== 'final') {
      this.alert('warn', `ปิดวัน ${thDate(d)}: รอบปิดวันไม่สำเร็จ — ใช้ไฟล์${KIND_LABEL[pick.kind]} ${pick.created_at.slice(11, 16)} น. แทน`, `fallback-${d}`);
    }
    const file = `${FOLDER[dest]}/${pick.file.split('/').pop()}`;
    const note = `จาก${KIND_LABEL[pick.kind]} ${pick.created_at.slice(11, 16)} น.`;
    if (pick.kind === 'manual') {
      copyFileSync(join(this.root, pick.file), join(this.root, file)); // ไฟล์ด้วยมือเก็บไว้ตามเดิม
      this.idx.prepare(
        `INSERT INTO snapshots (seq, kind, business_date, created_at, created_ms, file, size, sha256, status, error, with_files, shops, note)
         SELECT seq, ?, business_date, created_at, created_ms, ?, size, sha256, status, error, with_files, shops, ? FROM snapshots WHERE id = ?`,
      ).run(dest, file, note, pick.id);
    } else {
      renameSync(join(this.root, pick.file), join(this.root, file));
      this.idx.prepare('UPDATE snapshots SET kind = ?, file = ?, note = ? WHERE id = ?').run(dest, file, note, pick.id);
    }
    // ลบไฟล์ระหว่างวันของวันนั้น (หลังได้ไฟล์รายวันที่ผ่านการตรวจแล้วเท่านั้น)
    for (const r of rows) {
      if (r.id === pick.id || r.kind === 'manual') continue;
      this.deleteFile(r);
    }
    this.logRun('close', 'ok', `${thDate(d)} → ${file}`);
  }

  private deleteFile(r: SnapshotRow) {
    if (r.file) rmSync(join(this.root, r.file), { force: true });
    this.idx.prepare('UPDATE snapshots SET deleted_at = ? WHERE id = ?').run(stampTh(), r.id);
  }

  /** ลบไฟล์ตามกฎการเก็บ · ไฟล์รายวัน/รายเดือนที่หมดอายุ ลบเฉพาะที่ดาวน์โหลดแล้ว */
  prune(now: number) {
    const today = businessDate(now);
    const live = (where: string, ...args: (string | number)[]) =>
      this.idx.prepare(`SELECT * FROM snapshots WHERE deleted_at IS NULL AND file <> '' AND ${where}`).all(...args) as unknown as SnapshotRow[];
    for (const r of live("kind = 'daily' AND business_date < ?", addDays(today, -CFG.dailyKeep))) if (r.downloaded_at) this.deleteFile(r);
    for (const r of live("kind = 'monthly' AND business_date < ?", addMonths(today, -CFG.monthlyKeep))) if (r.downloaded_at) this.deleteFile(r);
    for (const r of live("kind IN ('manual','pre-restore','uploaded') AND created_ms < ?", now - CFG.shortKeep * 86_400_000)) this.deleteFile(r);
    // ไฟล์ระหว่างวันที่หลงเหลือจากวันที่ปิดไปแล้ว
    for (const r of live("kind IN ('intraday','final') AND business_date <= ?", this.meta('closed_through'))) this.deleteFile(r);
    this.idx.prepare("DELETE FROM snapshots WHERE status = 'failed' AND file = '' AND business_date < ?").run(addDays(today, -CFG.dailyKeep));
    this.idx.prepare('DELETE FROM runs WHERE id <= (SELECT MAX(id) FROM runs) - 3000').run();
    this.idx.prepare('DELETE FROM alerts WHERE dismissed_at IS NOT NULL AND dismissed_at < ?').run(stampTh(now - 90 * 86_400_000));
    const overdue = this.overdue(today);
    if (overdue.length) this.alert('info', `มีไฟล์สำรองเกินกำหนด ${overdue.length} ไฟล์ที่ยังไม่ได้ดาวน์โหลด — ดาวน์โหลด zip รายเดือนเก็บไว้ แล้วระบบจะลบให้`, `overdue-${today}`);
    this.cleanStage(86_400_000);
  }

  private overdue(today = businessDate()) {
    return this.idx.prepare(
      `SELECT id, business_date FROM snapshots WHERE deleted_at IS NULL AND file <> '' AND downloaded_at IS NULL
       AND ((kind = 'daily' AND business_date < ?) OR (kind = 'monthly' AND business_date < ?))`,
    ).all(addDays(today, -CFG.dailyKeep), addMonths(today, -CFG.monthlyKeep)) as { id: number; business_date: string }[];
  }

  /** ไฟล์พักที่ค้าง (งานที่ล้มกลางทาง) */
  private cleanStage(olderMs: number) {
    try {
      for (const f of readdirSync(this.ops.stage)) {
        const p = join(this.ops.stage, f);
        if (Date.now() - statSync(p).mtimeMs >= olderMs) rmSync(p, { recursive: true, force: true });
      }
      for (const k of new Set(Object.values(FOLDER))) {
        for (const f of readdirSync(join(this.root, k))) {
          if (f.endsWith('.tmp') && Date.now() - statSync(join(this.root, k, f)).mtimeMs >= Math.max(olderMs, 3600_000)) rmSync(join(this.root, k, f), { force: true });
        }
      }
    } catch { /* ไม่มีโฟลเดอร์ */ }
  }

  // ---------------------------------------------------------------- ข้อมูลสำหรับแผงควบคุม
  status() {
    if (!this.ready) return { ready: false, error: this.initError || 'กำลังเริ่มระบบ', root: this.root };
    const today = businessDate();
    const last = this.idx.prepare("SELECT * FROM snapshots WHERE status IN ('ok','partial') AND file <> '' ORDER BY created_ms DESC LIMIT 1").get() as unknown as SnapshotRow | undefined;
    const lastRun = this.idx.prepare("SELECT * FROM runs WHERE kind <> 'close' ORDER BY id DESC LIMIT 1").get() as { at: string; kind: string; result: string; detail: string } | undefined;
    const lastAttempt = this.idx.prepare("SELECT * FROM runs WHERE kind <> 'close' AND result <> 'skipped' ORDER BY id DESC LIMIT 1").get() as { at: string; result: string; detail: string } | undefined;
    const alerts = this.idx.prepare('SELECT id, at, level, message FROM alerts WHERE dismissed_at IS NULL ORDER BY id DESC LIMIT 30').all();
    const months = this.idx.prepare(
      `SELECT substr(business_date, 1, 7) AS month, COUNT(*) AS files, SUM(size) AS size, SUM(downloaded_at IS NULL) AS notDownloaded
       FROM snapshots WHERE kind IN ('daily','monthly') AND deleted_at IS NULL AND file <> '' GROUP BY month ORDER BY month DESC`,
    ).all();
    const counts = Object.fromEntries((['today', 'daily', 'other'] as const).map((t) => [t, this.list(t).length]));
    return {
      ready: true, root: this.root, mode: this.ops.mode, busy: this.busy, businessDate: today, nextRun: this.nextRun(),
      config: { ...CFG, uploadMax: undefined, uploadMaxMb: Math.round(CFG.uploadMax / 1048576), finalStart: hhmm(CFG.finalStart), finalEnd: hhmm(CFG.finalEnd), cutoff: hhmm(CFG.cutoff) },
      last: last ? view(last) : null, lastRun: lastRun ?? null, lastAttempt: lastAttempt ?? null,
      disk: this.disk(), alerts, overdue: this.overdue(today).length, months, counts,
    };
  }

  /** today = ไฟล์ของวันทำการนี้ · daily = รายวัน/รายเดือน · other = ด้วยมือ/ก่อนกู้คืน/อัปโหลด */
  list(tab: 'today' | 'daily' | 'other') {
    const sql =
      tab === 'today'
        ? "kind IN ('intraday','final') AND business_date = ? ORDER BY created_ms DESC"
        : tab === 'daily'
          ? "kind IN ('daily','monthly') ORDER BY business_date DESC, created_ms DESC LIMIT 500"
          : "kind IN ('manual','pre-restore','uploaded') ORDER BY created_ms DESC LIMIT 200";
    const rows = this.idx.prepare(`SELECT * FROM snapshots WHERE deleted_at IS NULL AND ${sql}`).all(...(tab === 'today' ? [businessDate()] : [])) as unknown as SnapshotRow[];
    return rows.map(view);
  }

  private row(id: number) {
    const r = this.idx.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as unknown as SnapshotRow | undefined;
    if (!r || r.deleted_at || !r.file) throw Object.assign(new Error('ไม่พบไฟล์สำรองนี้ (อาจถูกลบไปแล้ว)'), { status: 404 });
    const path = join(this.root, r.file);
    if (!existsSync(path)) throw Object.assign(new Error('ไฟล์สำรองหายจากดิสก์'), { status: 404 });
    return { r, path };
  }

  /** ดาวน์โหลด 1 ไฟล์ (บันทึกว่าดาวน์โหลดแล้ว) */
  download(id: number) {
    const { r, path } = this.row(id);
    this.idx.prepare('UPDATE snapshots SET downloaded_at = ? WHERE id = ?').run(stampTh(), id);
    return { path, name: r.file.split('/').pop()!, size: statSync(path).size };
  }

  /** ไฟล์รายวัน/รายเดือนทั้งเดือน (YYYY-MM) */
  monthFiles(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw Object.assign(new Error('เดือนไม่ถูกต้อง'), { status: 400 });
    const rows = this.idx.prepare(
      "SELECT * FROM snapshots WHERE kind IN ('daily','monthly') AND deleted_at IS NULL AND file <> '' AND substr(business_date, 1, 7) = ? ORDER BY business_date",
    ).all(month) as unknown as SnapshotRow[];
    const files = rows.map((r) => ({ id: r.id, path: join(this.root, r.file), name: r.file.split('/').pop()! })).filter((f) => existsSync(f.path));
    if (!files.length) throw Object.assign(new Error('ไม่มีไฟล์ของเดือนนี้'), { status: 404 });
    return {
      name: `backup_month_${month.slice(5, 7)}_${month.slice(0, 4)}.zip`,
      files,
      markDownloaded: () => {
        const up = this.idx.prepare('UPDATE snapshots SET downloaded_at = ? WHERE id = ?');
        const at = stampTh();
        for (const f of files) up.run(at, f.id);
      },
    };
  }

  /** รับไฟล์ zip ที่อัปโหลด (สตรีมลงดิสก์) → ตรวจ → เพิ่มในรายการ (ชนิด "อัปโหลด") */
  async receiveUpload(req: IncomingMessage) {
    if (!this.ready) throw new Error(`ระบบสำรองข้อมูลยังไม่พร้อม: ${this.initError}`);
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > CFG.uploadMax) throw Object.assign(new Error(`ไฟล์ใหญ่เกิน ${Math.round(CFG.uploadMax / 1048576)} MB`), { status: 413 });
    const tmp = join(this.root, 'uploaded', `.upload-${randomBytes(6).toString('hex')}.tmp`);
    await new Promise<void>((ok, fail) => {
      const out = createWriteStream(tmp, { mode: 0o600 });
      let got = 0;
      req.on('data', (c: Buffer) => {
        got += c.length;
        if (got > CFG.uploadMax) {
          req.destroy();
          out.destroy();
          fail(Object.assign(new Error(`ไฟล์ใหญ่เกิน ${Math.round(CFG.uploadMax / 1048576)} MB`), { status: 413 }));
        }
      });
      req.on('error', fail);
      out.on('error', fail);
      out.on('finish', () => ok());
      req.pipe(out);
    }).catch((e) => {
      rmSync(tmp, { force: true });
      throw e;
    });
    try {
      const m = readManifest(tmp);
      const sha256 = await sha256Of(tmp);
      const base = `backup_${m.businessDate.slice(8, 10)}_${m.businessDate.slice(5, 7)}_${m.businessDate.slice(0, 4)}_${m.createdAt.slice(11, 13)}${m.createdAt.slice(14, 16)}_${String(m.seq).padStart(4, '0')}`;
      const rel = `uploaded/${base}_upload-${randomBytes(2).toString('hex')}.zip`;
      renameSync(tmp, join(this.root, rel));
      const now = Date.now();
      const status = m.license.ok && m.shops.every((s) => s.ok) ? 'ok' : 'partial';
      const r = this.idx.prepare(
        `INSERT INTO snapshots (seq, kind, business_date, created_at, created_ms, file, size, sha256, status, with_files, shops, note)
         VALUES (?, 'uploaded', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(m.seq, m.businessDate, stampTh(now), now, rel, statSync(join(this.root, rel)).size, sha256, status, m.withFiles ? 1 : 0, JSON.stringify(m.shops), `ไฟล์เดิมสร้างเมื่อ ${m.createdAt}`);
      return view(this.idx.prepare('SELECT * FROM snapshots WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as SnapshotRow);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw Object.assign(new Error(`ไฟล์นี้ใช้กู้คืนไม่ได้: ${(e as Error).message}`), { status: 400 });
    }
  }

  /** ข้อมูลในไฟล์สำรอง (ก่อนกู้คืน) — ร้านในไฟล์ + เทียบกับข้อมูลที่สำรองล่าสุด */
  async inspect(id: number) {
    const { r, path } = this.row(id);
    if (r.sha256 && (await sha256Of(path)) !== r.sha256) throw new Error('ไฟล์สำรองถูกแก้ไขหรือเสีย (SHA-256 ไม่ตรง) — ใช้ไฟล์อื่น');
    const m = readManifest(path);
    const latest = this.idx.prepare("SELECT created_at, shops FROM snapshots WHERE status IN ('ok','partial') AND kind <> 'uploaded' AND deleted_at IS NULL ORDER BY created_ms DESC LIMIT 1").get() as { created_at: string; shops: string } | undefined;
    const latestShops = new Map(((latest ? JSON.parse(latest.shops) : []) as ShopSummary[]).map((s) => [s.slug, s]));
    const current = new Map(this.deps.shops().map((s) => [s.slug, s]));
    return {
      snapshot: view(r),
      manifest: { seq: m.seq, kind: m.kind, businessDate: m.businessDate, createdAt: m.createdAt, withFiles: m.withFiles, license: m.license },
      latestAt: latest?.created_at ?? null,
      shops: m.shops.map((s) => {
        const now = current.get(s.slug);
        const l = latestShops.get(s.slug);
        return {
          ...s, existsNow: !!now, currentName: now?.name ?? null,
          latest: l && l.ok ? { bills: l.bills, lastBillAt: l.lastBillAt } : null,
          confirmText: now?.name ?? s.name,
        };
      }),
    };
  }

  // ---------------------------------------------------------------- กู้คืน
  /**
   * กู้คืนจากไฟล์สำรอง · target = 'all' (ทั้งระบบ) | 'license' | ชื่อย่อร้าน
   * ขั้นตอน: ตรวจไฟล์ → สำรองสถานะปัจจุบัน (ก่อนกู้คืน) → license (ถ้าเลือก) → ร้าน (หยุด → สลับไฟล์ → เปิด → เช็ก → ย้อนกลับถ้าไม่ขึ้น)
   */
  restore(id: number, target: string, confirm: string, by: string) {
    return this.exclusive('กู้คืนข้อมูล', async () => {
      const { r, path } = this.row(id);
      if (r.sha256 && (await sha256Of(path)) !== r.sha256) throw new Error('ไฟล์สำรองถูกแก้ไขหรือเสีย (SHA-256 ไม่ตรง) — ยกเลิกการกู้คืน');
      const m = readManifest(path);
      const current = new Map(this.deps.shops().map((s) => [s.slug, s]));
      let shops: ShopSummary[];
      if (target === 'all') {
        if (confirm !== 'กู้คืนทั้งระบบ') throw Object.assign(new Error('พิมพ์คำว่า "กู้คืนทั้งระบบ" ให้ตรงเพื่อยืนยัน'), { status: 400 });
        shops = m.shops.filter((s) => s.ok);
      } else if (target === 'license') {
        if (confirm !== 'license') throw Object.assign(new Error('พิมพ์คำว่า "license" ให้ตรงเพื่อยืนยัน'), { status: 400 });
        shops = [];
      } else {
        const s = m.shops.find((x) => x.slug === target);
        if (!s || !s.ok) throw Object.assign(new Error('ไฟล์นี้ไม่มีข้อมูลของร้านนี้'), { status: 400 });
        const expect = current.get(s.slug)?.name ?? s.name;
        if (confirm.trim() !== expect.trim()) throw Object.assign(new Error(`พิมพ์ชื่อร้าน "${expect}" ให้ตรงเพื่อยืนยัน`), { status: 400 });
        if (!current.has(s.slug)) throw Object.assign(new Error('ยังไม่มี license ของร้านนี้ในระบบ — กู้คืน "ทั้งระบบ" หรือ "license" ก่อน'), { status: 400 });
        if (s.isMain && this.deps.mode === 'local') throw Object.assign(new Error(LOCAL_MAIN), { status: 400 });
        shops = [s];
      }
      if ((target === 'all' || target === 'license') && !m.license.ok) throw Object.assign(new Error('ไฟล์นี้ไม่มีข้อมูล license ที่ใช้ได้'), { status: 400 });

      // 1) สำรองสถานะปัจจุบันก่อนเสมอ (ย้อนกลับได้ถ้ากู้คืนผิดไฟล์)
      const pre = await this.snapshot('pre-restore', true, true);
      if ('skipped' in pre || pre.status === 'failed') {
        const hasData = this.deps.shops().length > 0;
        if (hasData) throw new Error(`สำรองข้อมูลปัจจุบันไม่สำเร็จ — ยกเลิกการกู้คืน (${'skipped' in pre ? '' : pre.error})`);
      }
      const preRow = 'skipped' in pre ? null : pre;
      const results: { target: string; name: string; ok: boolean; message: string }[] = [];
      const from = `${r.file.split('/').pop()} (${KIND_LABEL[r.kind]} ${r.created_at})`;

      const zip = new ZipReader(path);
      try {
        // 2) license
        if (target === 'all' || target === 'license') {
          try {
            const restart = this.restoreLicense(zip);
            results.push({ target: 'license', name: 'ข้อมูล license', ok: true, message: !restart ? 'สำเร็จ' : this.deps.mode === 'local' ? 'สำเร็จ — ไฟล์ความลับเปลี่ยน: ปิดหน้าต่างระบบ license แล้วเปิด run-test ใหม่' : 'สำเร็จ — ระบบ license จะเริ่มใหม่เองใน 2 วินาที' });
            this.deps.logEvent(null, 'backup.restore', `license ← ${from} · โดย ${by}`);
            this.deps.afterLicenseRestore(restart);
          } catch (e) {
            results.push({ target: 'license', name: 'ข้อมูล license', ok: false, message: (e as Error).message });
            if (target === 'all') shops = []; // license ไม่สำเร็จ → ไม่กู้คืนร้าน (ร้านอาจไม่ตรงกับ license)
          }
        }
        // 3) ร้าน
        const preZip = preRow?.file ? new ZipReader(join(this.root, preRow.file)) : null;
        try {
          for (const s of shops) {
            if (s.isMain && this.deps.mode === 'local') {
              results.push({ target: s.slug, name: s.name, ok: true, message: `ข้าม — ${LOCAL_MAIN}` });
              continue;
            }
            const res = await this.restoreShop(zip, s, preZip, preRow).catch((e: Error) => ({ ok: false, message: e.message }));
            results.push({ target: s.slug, name: s.name, ...res });
            const lic = this.deps.shops().find((x) => x.slug === s.slug);
            this.deps.logEvent(lic?.licenseId ?? null, res.ok ? 'backup.restore' : 'backup.restore-failed', `${s.name} ← ${from} · ${res.message} · โดย ${by}`);
          }
        } finally {
          preZip?.close();
        }
      } finally {
        zip.close();
      }
      const okAll = results.every((x) => x.ok);
      this.logRun('restore', okAll ? 'ok' : 'failed', `${target} ← ${from}: ${results.map((x) => `${x.name} ${x.ok ? '✓' : `✗ ${x.message}`}`).join(' · ')}`);
      this.alert(okAll ? 'info' : 'urgent', `กู้คืนข้อมูล${okAll ? 'สำเร็จ' : 'ไม่สำเร็จบางส่วน'}: ${results.map((x) => `${x.name} ${x.ok ? '✓' : '✗'}`).join(', ')} ← ${from}`);
      return { ok: okAll, results, preRestore: preRow ? view(preRow) : null };
    });
  }

  /** แทนที่ข้อมูลในฐานข้อมูล license ที่เปิดอยู่ด้วยข้อมูลจากไฟล์ (ทำใน transaction เดียว) · คืน true = ต้องเริ่มระบบ license ใหม่ */
  private restoreLicense(zip: ZipReader): boolean {
    const e = zip.find('license/license.db');
    if (!e) throw new Error('ไม่มีไฟล์ license.db ในไฟล์สำรอง');
    const dir = join(this.ops.stage, `rst-lic-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const file = join(dir, 'license.db');
      writeFileSync(file, zip.extract(e), { mode: 0o600 });
      checkLicenseDb(file);
      db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS r`);
      try {
        const tables = (sql: string) => new Set((db.prepare(sql).all() as { name: string }[]).map((x) => x.name));
        const mine = tables("SELECT name FROM main.sqlite_master WHERE type = 'table'");
        const theirs = tables("SELECT name FROM r.sqlite_master WHERE type = 'table'");
        const cols = (schema: string, t: string) => (db.prepare(`PRAGMA ${schema}.table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
        db.exec('PRAGMA foreign_keys = OFF');
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const t of mine) {
            if (t === 'sqlite_sequence' || !theirs.has(t)) continue;
            const theirCols = new Set(cols('r', t));
            const both = cols('main', t).filter((c) => theirCols.has(c)).map((c) => `"${c}"`).join(', ');
            db.exec(`DELETE FROM main."${t}"`);
            db.exec(`INSERT INTO main."${t}" (${both}) SELECT ${both} FROM r."${t}"`);
          }
          if (mine.has('sqlite_sequence') && theirs.has('sqlite_sequence')) {
            db.exec('DELETE FROM main.sqlite_sequence');
            db.exec('INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM r.sqlite_sequence');
          }
          const bad = db.prepare('PRAGMA main.foreign_key_check').all();
          if (bad.length) throw new Error(`ข้อมูลในไฟล์ไม่สอดคล้องกัน (${bad.length} แถว)`);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        } finally {
          db.exec('PRAGMA foreign_keys = ON');
        }
      } finally {
        db.exec('DETACH DATABASE r');
      }
      // ไฟล์ความลับ (ลายเซ็น token ของร้าน) — ต่างจากเดิม = เซิร์ฟเวอร์ใหม่ ต้องเริ่มระบบ license ใหม่ให้ใช้ค่าจากไฟล์สำรอง
      const s = zip.find('license/internal-secret.txt');
      const secretFile = join(dirname(DB_PATH), 'internal-secret.txt');
      if (s) {
        const want = zip.extract(s).toString('utf8').trim();
        const have = existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : '';
        if (/^[a-f0-9]{64}$/.test(want) && want !== have) {
          writeFileSync(secretFile, `${want}\n`, { mode: 0o600 });
          return true;
        }
      }
      return false;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async restoreShop(zip: ZipReader, s: ShopSummary, preZip: ZipReader | null, preRow: SnapshotRow | null) {
    const shop = this.deps.shops().find((x) => x.slug === s.slug);
    if (!shop) throw new Error('ไม่มี license ของร้านนี้ในระบบ');
    const target = shop.isMain ? MAIN_TARGET : shop.slug;
    const job = `rst-${Date.now()}-${randomBytes(3).toString('hex')}`;
    const dir = join(this.ops.stage, job);
    mkdirSync(dir, { recursive: true });
    try {
      // แตกไฟล์ของร้านนี้ลงโฟลเดอร์พัก
      const prefix = `${s.folder}/`;
      let n = 0;
      for (const e of zip.entries) {
        if (!e.name.startsWith(prefix) || e.name.endsWith('/')) continue;
        const rel = e.name.slice(prefix.length);
        if (rel.split('/').some((x) => x === '..' || x === '' || x.includes('\\')) || !/^(pos\.db|\.pin-secret|uploads\/[^/]+)$/.test(rel)) continue;
        const out = join(dir, ...rel.split('/'));
        if (!out.startsWith(dir + sep)) continue;
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, zip.extract(e), { mode: 0o600 });
        n++;
      }
      const dbFile = join(dir, 'pos.db');
      if (!existsSync(dbFile)) throw new Error('ไม่มีไฟล์ pos.db ของร้านนี้ในไฟล์สำรอง');
      const info = preparePosDb(dbFile);
      // เทียบกับข้อมูลปัจจุบัน (จากไฟล์ก่อนกู้คืน): โครงสร้างฐานข้อมูลต้องไม่ใหม่กว่า + เลขที่เอกสารรันต่อ ไม่ซ้ำกับที่ออกไปแล้ว
      let lost = 0;
      const curSum = preRow ? (JSON.parse(preRow.shops) as ShopSummary[]).find((x) => x.slug === s.slug && x.ok) : undefined;
      const curEntry = curSum && preZip?.find(`${curSum.folder}/pos.db`);
      if (curEntry) {
        const curFile = join(dir, '.current.db');
        writeFileSync(curFile, preZip!.extract(curEntry), { mode: 0o600 });
        try {
          if (info.schema > curSum!.schema && curSum!.schema > 0) throw new Error(`ไฟล์นี้มาจากระบบร้านรุ่นใหม่กว่า (โครงสร้าง ${info.schema} > ${curSum!.schema}) — อัปเดตระบบก่อนกู้คืน`);
          lost = carryDocNumbers(dbFile, curFile, info.lastBillAt);
        } finally {
          rmSync(curFile, { force: true });
        }
      }
      // วางไฟล์ (สร้างระบบร้านก่อน ถ้าเครื่องนี้ยังไม่มีร้านนี้ — เช่นกู้คืนลงเซิร์ฟเวอร์ใหม่)
      if (!shop.isMain && (await this.ops.stat(target)) === null) await this.deps.createShop(shop.slug);
      let started = await this.ops.restore(target, job);
      if (!started && !shop.isMain && this.deps.mode === 'local') {
        await this.deps.startShop(shop.slug).then(() => (started = true)).catch(() => {});
      }
      if (started) {
        try {
          await this.deps.waitHealthy(shop.port, 30_000);
        } catch (e) {
          const back = await this.ops.rollback(target).then(() => 'ย้อนกลับไปใช้ข้อมูลเดิมแล้ว').catch((x: Error) => `ย้อนกลับไม่สำเร็จ: ${x.message}`);
          if (back.startsWith('ย้อนกลับไปใช้')) await this.deps.waitHealthy(shop.port, 30_000).catch(() => {});
          throw new Error(`ร้านไม่ตอบภายใน 30 วินาทีหลังกู้คืน — ${back} (${(e as Error).message})`);
        }
      }
      const lostTxt = lost ? ` · บิลหลังเวลาในไฟล์ ${lost} บิลหายไป (เลขบิลใหม่รันต่อ ไม่ซ้ำ)` : '';
      return {
        ok: true,
        message: `สำเร็จ — บิลล่าสุดในไฟล์ ${info.lastBillAt ?? '-'} · ${info.bills.toLocaleString('th-TH')} บิล · ${n} ไฟล์${lostTxt}${started ? '' : ' · ร้านปิดอยู่ (ไม่ได้เปิดให้)'}`,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------- ตัวช่วย
const hhmm = (m: number) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDate = (ymd: string) => `${+ymd.slice(8, 10)} ${TH_MONTH[+ymd.slice(5, 7) - 1]} ${+ymd.slice(0, 4) + 543}`;
export const fmtSize = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function view(r: SnapshotRow) {
  const shops = JSON.parse(r.shops || '[]') as ShopSummary[];
  return {
    id: r.id, seq: r.seq, kind: r.kind, kindLabel: KIND_LABEL[r.kind] ?? r.kind, businessDate: r.business_date, createdAt: r.created_at,
    name: r.file ? r.file.split('/').pop() : '', size: r.size, status: r.status, error: r.error, withFiles: !!r.with_files, note: r.note,
    downloadedAt: r.downloaded_at, shops: shops.map((s) => ({ slug: s.slug, name: s.name, ok: s.ok, bills: s.bills, lastBillAt: s.lastBillAt, error: s.error })),
  };
}

/** ชื่อ folder ในไฟล์ zip = ชื่อร้านตามแผงควบคุม (ตัดตัวอักษรที่ Windows ใช้ไม่ได้ · ชื่อซ้ำ → ต่อท้ายชื่อย่อ) */
function folderName(s: ShopRef, used: Set<string>) {
  let n = s.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 60) || s.slug;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `${n}-${s.slug}`;
  if (used.has(n.toLowerCase())) n = `${n} (${s.slug})`;
  used.add(n.toLowerCase());
  return n;
}

/** ไฟล์ทั้งหมดในโฟลเดอร์ (ตำแหน่งแบบ a/b.jpg) — ไม่รวม -wal/-shm */
function listFiles(dir: string) {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.isFile() && !/-(wal|shm|journal)$/.test(f.name)) out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** ใส่ทุกไฟล์ในโฟลเดอร์ลง zip ใต้ prefix (อ่านทีละไฟล์) */
async function addDir(zip: ZipWriter, dir: string, prefix: string) {
  for (const rel of listFiles(dir)) {
    const p = join(dir, ...rel.split('/'));
    await zip.add(`${prefix}/${rel}`, readFileSync(p), !NO_COMPRESS.test(rel), statSync(p).mtimeMs);
  }
}

function sha256Of(path: string) {
  return new Promise<string>((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (c) => h.update(c)).on('error', fail).on('end', () => ok(h.digest('hex')));
  });
}

function isSqlite(path: string) {
  const fd = openSync(path, 'r');
  try {
    const b = Buffer.alloc(16);
    readSync(fd, b, 0, 16, 0);
    return b.toString('latin1').startsWith('SQLite format 3');
  } finally {
    closeSync(fd);
  }
}

function integrity(c: DatabaseSync) {
  const r = c.prepare('PRAGMA integrity_check').get() as Record<string, string> | undefined;
  const v = r ? Object.values(r)[0] : '';
  if (v !== 'ok') throw new Error(`ตรวจความสมบูรณ์ไม่ผ่าน (${String(v).slice(0, 80)})`);
}
const tableSet = (c: DatabaseSync) => new Set((c.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));

/** ตรวจ license.db ที่สำเนาแล้ว · คืนจำนวน license */
function checkLicenseDb(path: string) {
  if (!isSqlite(path)) throw new Error('ไฟล์ license ไม่ใช่ฐานข้อมูล SQLite');
  const c = new DatabaseSync(path);
  try {
    c.exec('PRAGMA journal_mode = DELETE');
    integrity(c);
    const t = tableSet(c);
    for (const n of ['licenses', 'instances', 'machines', 'events']) if (!t.has(n)) throw new Error('ไม่ใช่ฐานข้อมูล license ของระบบนี้');
    return (c.prepare('SELECT COUNT(*) AS n FROM licenses').get() as { n: number }).n;
  } finally {
    c.close();
  }
}

/**
 * ตรวจ + เตรียมฐานข้อมูลร้านที่สำเนาแล้ว (ไฟล์ในโฟลเดอร์พักเท่านั้น):
 * integrity_check · เป็นฐานข้อมูล POS · ลบ session ที่เข้าระบบค้าง (กู้คืนแล้วต้องเข้าระบบใหม่) · โหมดไฟล์เดียว (ไม่มี -wal)
 */
function preparePosDb(path: string) {
  if (!isSqlite(path)) throw new Error('ไม่ใช่ฐานข้อมูล SQLite');
  const c = new DatabaseSync(path);
  try {
    c.exec('PRAGMA journal_mode = DELETE');
    integrity(c);
    const t = tableSet(c);
    if (!t.has('staff') || !t.has('products') || !(t.has('orders_all') || t.has('orders'))) throw new Error('ไม่ใช่ฐานข้อมูลของระบบ POS นี้');
    if (t.has('sessions')) c.exec('DELETE FROM sessions');
    const orders = t.has('orders_all') ? 'orders_all' : 'orders';
    const o = c.prepare(`SELECT COUNT(*) AS n, MAX(created_at) AS last FROM ${orders} WHERE status <> 'void'`).get() as { n: number; last: string | null };
    let branches = 1;
    if (t.has('branches')) {
      try { branches = (c.prepare('SELECT COUNT(*) AS n FROM branches WHERE deleted_at IS NULL').get() as { n: number }).n; }
      catch { branches = (c.prepare('SELECT COUNT(*) AS n FROM branches').get() as { n: number }).n; }
    }
    const schema = (c.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    return { schema, branches, bills: o.n, lastBillAt: o.last };
  } finally {
    c.close();
  }
}

/**
 * เลขที่เอกสารรันต่อ: จำเลขสูงสุดที่ร้านเคยออกจริง (จากข้อมูลปัจจุบัน) ลงตาราง doc_floor ของไฟล์ที่จะกู้คืน
 * → บิล/ใบกำกับ/ใบลดหนี้ใหม่หลังกู้คืนไม่ซ้ำกับใบที่ลูกค้าได้ไปแล้ว · คืนจำนวนบิลที่จะหายไป (หลังบิลล่าสุดในไฟล์)
 */
function carryDocNumbers(restoreFile: string, currentFile: string, lastBillAt: string | null) {
  const cur = new DatabaseSync(currentFile, { readOnly: true });
  const nos: string[] = [];
  let lost = 0;
  try {
    const t = tableSet(cur);
    const orders = t.has('orders_all') ? 'orders_all' : t.has('orders') ? 'orders' : '';
    if (orders) {
      for (const r of cur.prepare(`SELECT order_no AS no FROM ${orders}`).all() as { no: string }[]) nos.push(r.no);
      lost = (cur.prepare(`SELECT COUNT(*) AS n FROM ${orders} WHERE status <> 'void' AND created_at > ?`).get(lastBillAt ?? '0000') as { n: number }).n;
    }
    for (const x of ['tax_invoices', 'credit_notes']) if (t.has(x)) for (const r of cur.prepare(`SELECT doc_no AS no FROM ${x}`).all() as { no: string }[]) nos.push(r.no);
    if (t.has('doc_floor')) for (const r of cur.prepare('SELECT prefix, n FROM doc_floor').all() as { prefix: string; n: number }[]) nos.push(`${r.prefix}${r.n}`);
  } finally {
    cur.close();
  }
  const max = new Map<string, number>();
  for (const no of nos) {
    const m = /^(.*-)(\d+)$/.exec(String(no ?? ''));
    if (m) max.set(m[1], Math.max(max.get(m[1]) ?? 0, Number(m[2])));
  }
  if (!max.size) return lost;
  const c = new DatabaseSync(restoreFile);
  try {
    c.exec('CREATE TABLE IF NOT EXISTS doc_floor (prefix TEXT PRIMARY KEY, n INTEGER NOT NULL)');
    const up = c.prepare('INSERT INTO doc_floor (prefix, n) VALUES (?, ?) ON CONFLICT (prefix) DO UPDATE SET n = MAX(n, excluded.n)');
    c.exec('BEGIN');
    for (const [p, n] of max) up.run(p, n);
    c.exec('COMMIT');
  } finally {
    c.close();
  }
  return lost;
}

/** อ่าน + ตรวจ manifest ของไฟล์สำรอง */
function readManifest(path: string): Manifest {
  const z = new ZipReader(path);
  try {
    const e = z.find('manifest.json');
    if (!e) throw new Error('ไม่มี manifest.json — ไม่ใช่ไฟล์สำรองทั้งระบบของ POS');
    const m = JSON.parse(z.extract(e).toString('utf8')) as Manifest;
    if (m.format !== FORMAT || !Array.isArray(m.shops) || !m.license) throw new Error('ไม่ใช่ไฟล์สำรองทั้งระบบของ POS');
    if (m.version > 1) throw new Error('ไฟล์สำรองมาจากระบบรุ่นใหม่กว่า — อัปเดตระบบก่อน');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.businessDate) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(m.createdAt)) throw new Error('ข้อมูลวันที่ในไฟล์ไม่ถูกต้อง');
    for (const s of m.shops) {
      if (!/^[a-z0-9-]{1,30}$/.test(String(s.slug)) || typeof s.folder !== 'string') throw new Error('ข้อมูลร้านในไฟล์ไม่ถูกต้อง');
      if (s.ok && !z.find(`${s.folder}/pos.db`)) throw new Error(`ไฟล์ไม่ครบ: ไม่มีข้อมูลของ ${s.name}`);
    }
    if (m.license.ok && !z.find('license/license.db')) throw new Error('ไฟล์ไม่ครบ: ไม่มี license.db');
    return m;
  } finally {
    z.close();
  }
}

export { BusyError, ZipWriter, thDate };
