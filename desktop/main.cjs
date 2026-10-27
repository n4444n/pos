// Clothing POS — แอปเดสก์ท็อป (Electron) แบบเครื่องลูก
// - เปิดหน้า POS จากเซิร์ฟเวอร์กลาง (VPS) · ทุกสาขาใช้ฐานข้อมูลเดียวกัน
// - พิมพ์ใบเสร็จตรงเข้าเครื่องพิมพ์ (ไม่ขึ้นกล่องเลือกเครื่องพิมพ์) · กระดาษ 58/80 มม.
// - อัปเดตตัวเองผ่าน electron-updater (ไฟล์อยู่ที่ <เซิร์ฟเวอร์>/updates/)
// ตั้งค่าของเครื่องนี้เก็บที่ %APPDATA%\Clothing POS\config.json
// พัฒนาต้นแบบโดย n4444n (MIT + Attribution — ดูไฟล์ LICENSE)
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, net, session, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const os = require('node:os');
const escpos = require('./escpos.cjs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// ---------------------------------------------------------------- license
// ตัวติดตั้งเดียวใช้ได้ทุกร้าน: เปิดครั้งแรกขึ้นหน้า "เปิดใช้งาน" ให้กรอก license
// → ได้ชื่อย่อร้าน (route) ที่แอปแนบไปกับทุกคำขอ (X-POS-Shop) → ประตูของเซิร์ฟเวอร์ส่งต่อไปร้านที่ถูกต้อง
// เซิร์ฟเวอร์ license = เซิร์ฟเวอร์เดียวกับที่ตั้งไว้ในแอป (config.serverUrl เช่น https://pos.sh0p.tech)
const licenseServer = () => String(config.serverUrl || '').replace(/\/+$/, '');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------- ตั้งค่าเครื่องนี้
const DEFAULT_SERVER = 'https://pos.sh0p.tech';
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = {
  serverUrl: DEFAULT_SERVER,
  // วิธีพิมพ์: 'raster' = ESC/POS แบบรูปภาพ ส่งตรงเข้าเครื่องพิมพ์ใบเสร็จ (แนะนำ) · 'driver' = ผ่านไดรเวอร์ Windows (แบบเดิม)
  printMode: 'raster',
  connection: 'usb', //   ESC/POS: 'usb' = เครื่องพิมพ์ใน Windows (ส่งแบบ RAW) · 'network' = LAN/WiFi · 'bluetooth' = พอร์ต COM
  printer: '', //          ชื่อเครื่องพิมพ์ใน Windows ('' = เครื่องหลัก — ใช้ได้เฉพาะโหมดไดรเวอร์)
  host: '', //             ESC/POS LAN: IP เครื่องพิมพ์
  port: 9100,
  comPort: '', //          Bluetooth: พอร์ต COM เสมือนของเครื่องพิมพ์ที่จับคู่แล้ว (เช่น COM5)
  baud: 9600, //           Bluetooth ไม่สนใจค่านี้ · สาย Serial ต้องตรงกับเครื่องพิมพ์
  paperWidth: null, //     null = ตามตั้งค่าร้าน · 58 / 80 = บังคับเฉพาะเครื่องนี้
  dots: 0, //              ความกว้างพิมพ์ (จุด) · 0 = อัตโนมัติ (58 → 384, 80 → 576)
  threshold: 160, //       ความเข้ม 80–230 (มาก = เข้ม)
  cut: true, //            ตัดกระดาษหลังพิมพ์
  feedTop: 0, //           เว้นหัว (มม.)
  feedBottom: 4, //        เว้นท้ายก่อนตัด (มม.)
  drawer: 'off', //        เปิดลิ้นชัก: 'off' · 'cash' = ขายด้วยเงินสด · 'sale' = ทุกการขาย
  drawerPin: 0, //         0 = ขา 2 (ทั่วไป) · 1 = ขา 5
  silent: true, //         โหมดไดรเวอร์: true = พิมพ์ทันที · false = แสดงกล่องเลือกเครื่องพิมพ์
  // ---- เครื่องพิมพ์บาร์โค้ด (ป้ายติดสินค้า) — แยกจากเครื่องพิมพ์ใบเสร็จ
  labelPrinter: '', //     ชื่อเครื่องพิมพ์ป้ายใน Windows ('' = ถามทุกครั้ง)
  labelSilent: true, //    true = พิมพ์ทันทีไม่ถาม (เมื่อเลือกเครื่องไว้แล้ว)
  // ---- ชุดทดลอง
  license: null, //        { code, shop, expiresAt, route } หลังเปิดใช้งานสำเร็จ (route = ชื่อร้านหลังประตูเดียวของโหมดทดสอบ)
  machineId: '', //        รหัสเครื่อง (สำรอง เมื่ออ่าน MachineGuid ของ Windows ไม่ได้)
};

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // เครื่องที่ตั้งค่าไว้ก่อนมีโหมด ESC/POS → ใช้แบบเดิม (ไดรเวอร์) ต่อจนกว่าจะเปลี่ยนเอง
    if (!saved.printMode) saved.printMode = 'driver';
    return sanitize({ ...DEFAULTS, ...saved });
  } catch {
    return { ...DEFAULTS };
  }
}
const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
function sanitize(c) {
  let serverUrl = String(c.serverUrl || DEFAULT_SERVER).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(serverUrl)) serverUrl = DEFAULT_SERVER;
  const dots = num(c.dots, 0, 1024, 0);
  return {
    serverUrl,
    printMode: c.printMode === 'driver' ? 'driver' : 'raster',
    connection: c.connection === 'network' || c.connection === 'bluetooth' ? c.connection : 'usb',
    printer: String(c.printer || ''),
    host: String(c.host || '').trim().slice(0, 100),
    port: num(c.port, 1, 65535, 9100),
    comPort: /^COM\d{1,3}$/i.test(String(c.comPort || '')) ? String(c.comPort).toUpperCase() : '',
    baud: [9600, 19200, 38400, 57600, 115200].includes(Number(c.baud)) ? Number(c.baud) : 9600,
    paperWidth: c.paperWidth === 58 || c.paperWidth === 80 ? c.paperWidth : null,
    dots: dots && dots < 200 ? 200 : dots - (dots % 8), // ทวีคูณของ 8
    threshold: num(c.threshold, 80, 230, 160),
    cut: c.cut !== false,
    feedTop: num(c.feedTop, 0, 30, 0),
    feedBottom: num(c.feedBottom, 0, 50, 4),
    drawer: c.drawer === 'cash' || c.drawer === 'sale' ? c.drawer : 'off',
    drawerPin: c.drawerPin === 1 ? 1 : 0,
    silent: c.silent !== false,
    labelPrinter: String(c.labelPrinter || '').slice(0, 200),
    labelSilent: c.labelSilent !== false,
    license:
      c.license && /^POS-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c.license.code)
        ? {
            code: c.license.code,
            shop: String(c.license.shop || '').slice(0, 80),
            expiresAt: c.license.expiresAt ? String(c.license.expiresAt).slice(0, 19) : null,
            route: /^[a-z0-9-]{1,30}$/.test(String(c.license.route || '')) ? String(c.license.route) : '',
          }
        : null,
    machineId: /^[\w-]{8,128}$/.test(String(c.machineId || '')) ? String(c.machineId) : '',
  };
}
function saveConfig(next) {
  config = sanitize({ ...config, ...next });
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  return config;
}
// โหลดหลังประกาศ num/sanitize แล้ว — เดิมเรียกก่อน `const num` → ReferenceError ถูกกลืนใน catch
// ทำให้ทุกครั้งที่เปิดโปรแกรมได้ค่าเริ่มต้นเสมอ (ลืมเครื่องพิมพ์/เซิร์ฟเวอร์ที่ตั้งไว้)
let config = loadConfig();
const serverOrigin = () => new URL(config.serverUrl).origin;

// ---------------------------------------------------------------- กุญแจแอป (ใช้ได้เฉพาะโปรแกรมนี้)
// เซิร์ฟเวอร์ (Caddy) รับเฉพาะคำขอที่มี header X-POS-App ตรงกับกุญแจ → เปิด URL ในเบราว์เซอร์ไม่ได้
// กุญแจอยู่ในไฟล์ desktop/app-key.txt (ไม่อยู่ใน git) ใส่ตอน build — ดู deploy/README.md หัวข้อ "ล็อกให้ใช้ได้เฉพาะแอป"
const APP_KEY = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'app-key.txt'), 'utf8').trim();
  } catch {
    return '';
  }
})();
const appHeaders = () => (APP_KEY ? { 'X-POS-App': APP_KEY } : {});
// ngrok (ทดสอบ) แทรกหน้าเตือนก่อนเข้าเว็บ — header นี้ข้ามหน้าเตือน
const NGROK_HOST = /\.ngrok(-free)?\.(app|dev|io)$/i;
const NGROK_HEADERS = { 'ngrok-skip-browser-warning': '1' };
/** ทุกคำขอไปยังเซิร์ฟเวอร์ร้าน (หน้าเว็บ API รูป หน้าพิมพ์) แนบกุญแจแอป + ชื่อร้าน (ชุดทดลองผ่านประตูเดียว) */
function installRequestHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*/*', 'http://*/*'] }, (d, cb) => {
    let u = null;
    try {
      u = new URL(d.url);
    } catch {}
    if (u && u.origin === serverOrigin()) {
      if (APP_KEY) d.requestHeaders['X-POS-App'] = APP_KEY;
      if (config.license?.route) {
        d.requestHeaders['X-POS-Shop'] = config.license.route;
        d.requestHeaders['X-POS-Machine'] = machineId(); // ประตูของร้านทดลองตรวจว่าเครื่องนี้ยังลงทะเบียนอยู่ทุกคำขอ
      }
    }
    if (u && NGROK_HOST.test(u.hostname)) Object.assign(d.requestHeaders, NGROK_HEADERS);
    cb({ requestHeaders: d.requestHeaders });
  });
  // ประตูตอบว่า license/เครื่องใช้ไม่ได้แล้ว (เช่น ผู้ดูแลลบเครื่องนี้) → ตรวจ license แล้วพากลับหน้าเปิดใช้งาน
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*/*', 'http://*/*'] }, (d, cb) => {
    const h = d.responseHeaders || {};
    if (Object.keys(h).some((k) => k.toLowerCase() === 'x-pos-license')) recheckLicense();
    cb({});
  });
}
const updatesUrl = () => `${config.serverUrl}/updates/`;

// ---------------------------------------------------------------- license (ชุดทดลอง)
/** รหัสเครื่อง: MachineGuid ของ Windows (คงที่แม้ลงโปรแกรมใหม่) → hash · อ่านไม่ได้ → สุ่มแล้วจำไว้ */
function machineId() {
  let raw = '';
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      raw = (/MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(out) || [])[1] || '';
    } catch {}
  }
  if (raw) return crypto.createHash('sha256').update(`clothing-pos:${raw}`).digest('hex').slice(0, 40);
  if (!config.machineId) saveConfig({ machineId: crypto.randomUUID() });
  return config.machineId;
}
const machineName = () => os.hostname().slice(0, 80);

async function licenseCall(endpoint, code) {
  if (!licenseServer()) return { ok: false, error: 'ยังไม่ได้ตั้งที่อยู่เซิร์ฟเวอร์ (ตั้งค่าเครื่องนี้)', code: 'CONFIG' };
  try {
    const res = await net.fetch(`${licenseServer()}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...NGROK_HEADERS },
      body: JSON.stringify({ code, machineId: machineId(), machineName: machineName() }),
      signal: AbortSignal.timeout(endpoint === 'activate' ? 150_000 : 10_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) return { ok: false, error: j.error || `เซิร์ฟเวอร์ license ตอบ ${res.status}`, code: j.code || `HTTP${res.status}` };
    return j;
  } catch (e) {
    return { ok: false, error: `ติดต่อเซิร์ฟเวอร์ license ไม่ได้ — ตรวจอินเทอร์เน็ต (${e.message})`, code: 'NETWORK' };
  }
}
/** ได้คำตอบจาก license → จำที่อยู่ระบบของร้าน (แอปเปิดหน้า PIN ของร้านนี้ทุกครั้ง) */
function rememberLicense(r) {
  saveConfig({ serverUrl: r.url, license: { code: r.code || config.license?.code, shop: r.shop, expiresAt: r.expiresAt, route: r.route || '' } });
  refreshTitle();
}
function showActivate(reason = '') {
  if (win) win.loadFile(path.join(__dirname, 'activate.html'), { query: reason ? { reason } : {} });
}
// หมดอายุ / ระงับ / ไม่รู้จักเครื่อง → กลับไปหน้าเปิดใช้งาน · เน็ตหลุด → ใช้ต่อ (หน้าออฟไลน์จัดการเอง)
const LICENSE_BLOCKING = new Set(['EXPIRED', 'REVOKED', 'NOT_FOUND', 'MACHINE_UNKNOWN', 'MACHINE_LIMIT']);
/** ตรวจ license อีกครั้ง (ระหว่างใช้งาน) — ถูกระงับ/หมดอายุ/ลบเครื่อง → หน้าเปิดใช้งานทันที · เน็ตหลุด = ใช้ต่อ */
let rechecking = false;
async function recheckLicense() {
  if (!config.license || rechecking) return;
  rechecking = true;
  try {
    const r = await licenseCall('check', config.license.code);
    if (r.ok) rememberLicense(r);
    else if (LICENSE_BLOCKING.has(r.code) && win && !win.webContents.getURL().startsWith('file:')) showActivate(r.error);
  } finally {
    rechecking = false;
  }
}
async function startShop() {
  if (!config.license) return showActivate();
  const r = await licenseCall('check', config.license.code);
  if (r.ok) rememberLicense(r);
  else if (LICENSE_BLOCKING.has(r.code)) return showActivate(r.error);
  openServer();
}

// ---------------------------------------------------------------- หน้าต่างหลัก
let win = null;
let settingsWin = null;
const PRELOAD = path.join(__dirname, 'preload.cjs');
const webPreferences = { contextIsolation: true, sandbox: true, preload: PRELOAD };

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: windowTitle(),
    backgroundColor: '#f4f6fb',
    autoHideMenuBar: true,
    show: false,
    webPreferences,
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // หัวหน้าต่างกำหนดเองด้านล่าง (windowTitle)
  win.on('closed', () => (win = null));

  const wc = win.webContents;
  // หน้าต่างย่อย (เช่น ใบส่งสินค้า A4) เปิดในแอป · ลิงก์ภายนอกเปิดในเบราว์เซอร์
  wc.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || isServerUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 980, height: 900, webPreferences } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isAppFile(url) || isServerUrl(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  // เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ → หน้าออฟไลน์ (ลองใหม่อัตโนมัติ)
  // ชุดทดลอง: ระบบร้านถูกปิดเพราะหมดอายุ/ระงับ → แจ้งเรื่อง license แทนหน้าออฟไลน์
  const showOffline = async (err) => {
    if (config.license) {
      const r = await licenseCall('check', config.license.code);
      if (!r.ok && LICENSE_BLOCKING.has(r.code)) return showActivate(r.error);
    }
    win?.loadFile(path.join(__dirname, 'offline.html'), { query: { url: config.serverUrl, err } });
  };
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ABORTED */ || url.startsWith('file:')) return;
    showOffline(`${desc} (${code})`);
  });
  // ชุดทดลองผ่านประตูเดียว / ngrok: ร้านปิดอยู่ตอบเป็นหน้า 502–504 แทนการเชื่อมต่อไม่ได้
  wc.on('did-navigate', (_e, url, status) => {
    if (status >= 502 && status <= 504 && isServerUrl(url)) showOffline(`HTTP ${status}`);
  });

  win.loadFile(path.join(__dirname, 'splash.html'));
  setTimeout(() => startShop(), 300);
}
/** หน้าภายในแอปเท่านั้น (ไฟล์ในโฟลเดอร์โปรแกรม) — หน้าเว็บจากเซิร์ฟเวอร์พาไปไฟล์อื่นในเครื่องไม่ได้ */
function isAppFile(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && path.resolve(require('url').fileURLToPath(u)).startsWith(path.resolve(__dirname) + path.sep);
  } catch {
    return false;
  }
}
function isServerUrl(url) {
  try {
    return new URL(url).origin === serverOrigin();
  } catch {
    return false;
  }
}
function openServer() {
  if (win) win.loadURL(`${config.serverUrl}/`).catch(() => {}); // ล้มเหลว → did-fail-load แสดงหน้าออฟไลน์
}

function openSettings() {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    parent: win ?? undefined,
    modal: !!win,
    width: 580,
    height: 760,
    resizable: false,
    minimizable: false,
    title: 'ตั้งค่าเครื่องนี้',
    autoHideMenuBar: true,
    backgroundColor: '#f4f6fb',
    webPreferences,
  });
  settingsWin.removeMenu();
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => (settingsWin = null));
}

// ---------------------------------------------------------------- พิมพ์กระดาษม้วน
/** พิมพ์ HTML ด้วยหน้าต่างซ่อน → ส่งเข้าเครื่องพิมพ์ที่ตั้งไว้ · ความยาวกระดาษ = ความยาวเนื้อหา */
async function printHtml(html, paperWidthFromShop, opts = config, { notify = true } = {}) {
  const pw = opts.paperWidth || (paperWidthFromShop === 58 ? 58 : 80);
  const pwin = new BrowserWindow({
    show: false,
    width: 420,
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: true },
  });
  try {
    await pwin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // รอรูป/ฟอนต์ แล้ววัดความยาวเนื้อหา (หลายสำเนา → ใช้สำเนาที่ยาวที่สุด 1 หน้า/สำเนา)
    const px = await pwin.webContents.executeJavaScript(`(async () => {
      try { await document.fonts.ready } catch {}
      await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r })));
      const secs = [...document.querySelectorAll('body > section')];
      const h = secs.length ? Math.max(...secs.map((s) => s.getBoundingClientRect().height)) : document.body.getBoundingClientRect().height;
      return Math.ceil(h);
    })()`);
    const marginMm = pw === 58 ? 2 : 4;
    const heightMm = Math.max(40, (px * 25.4) / 96 + marginMm * 2 + 6);
    const devices = await pwin.webContents.getPrintersAsync();
    const deviceName = opts.printer && devices.some((d) => d.name === opts.printer) ? opts.printer : undefined;
    if (opts.printer && !deviceName) throw new Error(`ไม่พบเครื่องพิมพ์ "${opts.printer}" — ตรวจว่าเปิดเครื่องและต่อสายอยู่ หรือเลือกเครื่องใหม่ในตั้งค่าเครื่องนี้`);
    await new Promise((resolve, reject) => {
      pwin.webContents.print(
        {
          silent: opts.silent,
          deviceName,
          printBackground: true,
          color: false,
          margins: { marginType: 'none' }, // ระยะขอบอยู่ใน CSS ของเอกสารแล้ว (เนื้อหาจัดกึ่งกลาง)
          pageSize: { width: pw * 1000, height: Math.round(heightMm * 1000) }, // ไมครอน
        },
        (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(reason || 'พิมพ์ไม่สำเร็จ'))),
      );
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (notify && win && !win.isDestroyed()) {
      dialog.showMessageBox(win, { type: 'warning', title: 'พิมพ์ไม่สำเร็จ', message: 'พิมพ์ไม่สำเร็จ', detail: `${error}\n\nตั้งค่าเครื่องพิมพ์ได้ที่เมนู ระบบ → ตั้งค่าเครื่องนี้` });
    }
    return { ok: false, error };
  } finally {
    pwin.destroy();
  }
}

// ---------------------------------------------------------------- พิมพ์ป้ายบาร์โค้ด
/**
 * พิมพ์ป้ายบาร์โค้ดเข้า "เครื่องพิมพ์บาร์โค้ด" (แยกจากเครื่องพิมพ์ใบเสร็จ) ผ่านไดรเวอร์ Windows
 * page = ขนาดกระดาษ 1 หน้า (มม.) ตามโปรไฟล์ป้าย — ม้วน: 1 แถวต่อหน้า · A4: 210×297
 * ยังไม่ได้เลือกเครื่อง / ปิด "พิมพ์ทันที" → แสดงกล่องเลือกเครื่องพิมพ์ของ Windows
 */
async function printLabelDoc(html, page, opts = config) {
  const w = Math.max(10, Math.min(400, Number(page?.width) || 50));
  const h = Math.max(10, Math.min(400, Number(page?.height) || 30));
  const pwin = new BrowserWindow({ show: false, width: 800, height: 800, webPreferences: { sandbox: true, contextIsolation: true, javascript: true } });
  try {
    await pwin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await pwin.webContents.executeJavaScript(`(async () => {
      try { await document.fonts.ready } catch {}
      await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r })));
      return true;
    })()`);
    const devices = await pwin.webContents.getPrintersAsync();
    const deviceName = opts.labelPrinter && devices.some((d) => d.name === opts.labelPrinter) ? opts.labelPrinter : undefined;
    if (opts.labelPrinter && !deviceName) throw new Error(`ไม่พบเครื่องพิมพ์บาร์โค้ด "${opts.labelPrinter}" — ตรวจว่าเปิดเครื่องและต่อสายอยู่ หรือเลือกเครื่องใหม่ที่ ตั้งค่า → ตั้งค่าเครื่องพิมพ์บาร์โค้ด`);
    await new Promise((resolve, reject) => {
      pwin.webContents.print(
        {
          silent: !!deviceName && opts.labelSilent,
          deviceName,
          printBackground: true,
          color: false,
          landscape: false,
          margins: { marginType: 'none' }, // ระยะขอบอยู่ในโปรไฟล์ป้ายแล้ว
          pageSize: { width: Math.round(w * 1000), height: Math.round(h * 1000) }, // ไมครอน
        },
        (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(reason || 'พิมพ์ไม่สำเร็จ'))),
      );
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    pwin.destroy();
  }
}

// ---------------------------------------------------------------- ESC/POS แบบรูปภาพ
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const paperOf = (pwShop, opts) => opts.paperWidth || (pwShop === 58 ? 58 : 80);
const dotsOf = (pw, opts) => opts.dots || escpos.defaultDots(pw);

/**
 * HTML → ภาพขาวดำกว้าง `dots` จุด (ซูมให้เนื้อหาเต็มความกว้างพิมพ์)
 * คืน pages: 1 ภาพต่อสำเนา (<section> แต่ละอัน) — ตัดกระดาษคั่นระหว่างสำเนา
 */
async function renderMono(html, pw, opts) {
  const dots = dotsOf(pw, opts);
  const VIEW_H = 1200; // ถ่ายทีละช่วง (หน้ายาวกว่าจอได้)
  const rwin = new BrowserWindow({
    show: false,
    width: dots,
    height: VIEW_H,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: true },
  });
  const run = (js) => rwin.webContents.executeJavaScript(js);
  try {
    await rwin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const bodyW = await run(`(async () => {
      try { await document.fonts.ready } catch {}
      await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r })));
      const st = document.createElement('style');
      st.textContent = 'html,body{background:#fff!important}::-webkit-scrollbar{display:none}';
      document.head.appendChild(st);
      return document.body.getBoundingClientRect().width;
    })()`);
    const Z = dots / Math.max(50, bodyW);
    rwin.webContents.setZoomFactor(Z);
    await sleep(60);
    const m = await run(`(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const secs = [...document.querySelectorAll('body > section')].map((s) => {
        const r = s.getBoundingClientRect();
        return [r.top + scrollY, r.bottom + scrollY];
      });
      return { H: Math.max(document.documentElement.scrollHeight, document.body.getBoundingClientRect().bottom + scrollY), secs };
    })()`);
    const H = Math.ceil(m.H * Z);
    const parts = [];
    for (let y = 0; y < H; y += VIEW_H) {
      const want = Math.min(VIEW_H, H - y);
      const sy = await run(`(async () => {
        window.scrollTo(0, ${y / Z});
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return window.scrollY;
      })()`);
      const off = Math.max(0, Math.min(VIEW_H - want, Math.round(y - sy * Z)));
      rwin.webContents.invalidate(); // offscreen: วาดเฟรมใหม่หลังเลื่อน
      await sleep(40);
      let img = await rwin.webContents.capturePage({ x: 0, y: off, width: dots, height: want });
      const size = img.getSize();
      if (size.width !== dots || size.height !== want) img = img.resize({ width: dots, height: want, quality: 'best' });
      parts.push(escpos.toMono(img.toBitmap(), dots, want, opts.threshold, 'bgra'));
    }
    const all = escpos.concatMono(parts);
    const pages = (m.secs.length ? m.secs : [[0, m.H]]).map(([a, b]) => escpos.trimBottom(escpos.sliceMono(all, Math.round(a * Z), Math.round(b * Z))));
    return { pages: pages.filter((p) => p.height > 0), dots };
  } finally {
    rwin.destroy();
  }
}

/** ภาพขาวดำ → PNG data URL (ดูตัวอย่างในหน้าตั้งค่า) — สำเนาคั่นด้วยเส้นประแดง */
function monoPreview(pages) {
  const width = pages[0]?.width || 384;
  const gap = 10;
  const height = pages.reduce((s, p) => s + p.height + gap, 0) || 1;
  const buf = Buffer.alloc(width * height * 4, 255);
  let y0 = 0;
  for (const p of pages) {
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < width; x++)
        if (p.bits[y * p.widthBytes + (x >> 3)] & (0x80 >> (x & 7))) buf.fill(0, ((y0 + y) * width + x) * 4, ((y0 + y) * width + x) * 4 + 3);
    const cy = y0 + p.height + (gap >> 1);
    for (let x = 0; x < width; x += 1) if ((x >> 3) % 2 === 0) buf.set([30, 30, 220, 255], (cy * width + x) * 4); // BGRA สีแดง
    y0 += p.height + gap;
  }
  return nativeImage.createFromBitmap(buf, { width, height }).toDataURL();
}

/** ส่งข้อมูล ESC/POS ไปยังเครื่องพิมพ์ตามตั้งค่า */
function sendRaw(data, opts) {
  if (opts.connection === 'network') {
    if (!opts.host) throw new Error('ยังไม่ได้ใส่ IP เครื่องพิมพ์ (ตั้งค่าเครื่องนี้ → LAN/WiFi)');
    return escpos.sendNetwork(opts.host, opts.port, data);
  }
  if (opts.connection === 'bluetooth') return escpos.sendSerial(opts.comPort, opts.baud, data);
  return escpos.sendWindowsRaw(opts.printer, data);
}

async function printRaster(html, pwShop, opts) {
  const pw = paperOf(pwShop, opts);
  const { pages } = await renderMono(html, pw, opts);
  if (!pages.length) throw new Error('ไม่มีเนื้อหาให้พิมพ์');
  await sendRaw(escpos.buildJob({ pages, feedTopMm: opts.feedTop, feedBottomMm: opts.feedBottom, cut: opts.cut }), opts);
}

/** พิมพ์ตามวิธีที่ตั้งไว้ · ผิดพลาด → แจ้งบนหน้าจอ */
async function printDoc(html, pwShop, opts = config, { notify = true } = {}) {
  try {
    if (opts.printMode === 'raster') await printRaster(html, pwShop, opts);
    else {
      const r = await printHtml(html, pwShop, opts, { notify: false });
      if (!r.ok) throw new Error(r.error);
    }
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (notify && win && !win.isDestroyed()) {
      dialog.showMessageBox(win, { type: 'warning', title: 'พิมพ์ไม่สำเร็จ', message: 'พิมพ์ไม่สำเร็จ', detail: `${error}\n\nตั้งค่าเครื่องพิมพ์ได้ที่เมนู ระบบ → ตั้งค่าเครื่องนี้` });
    }
    return { ok: false, error };
  }
}

/** เปิดลิ้นชักเงิน (ต่อสายเข้าเครื่องพิมพ์ใบเสร็จ) — ใช้ได้เมื่อพิมพ์แบบ ESC/POS */
async function openDrawer(opts = config) {
  if (opts.printMode !== 'raster') throw new Error('เปิดลิ้นชักได้เฉพาะโหมด ESC/POS');
  await sendRaw(escpos.drawerOnly(opts.drawerPin), opts);
}

const TEST_PAGE = (pw, opts = config) => `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
  body{font-family:system-ui,sans-serif;font-size:12px;width:${pw === 58 ? 50 : 72}mm;margin:0 auto;color:#000}
  .c{text-align:center} hr{border:0;border-top:1px dashed #000;margin:6px 0} .ruler{display:flex;justify-content:space-between}
  .bar{height:6px;background:#000;margin:6px 0} .grey{height:14px;background:linear-gradient(90deg,#fff,#000);margin:4px 0}
</style></head><body>
  <h3 class="c" style="margin:6px 0">ทดสอบเครื่องพิมพ์</h3>
  <div class="c">Clothing POS ${app.getVersion()}</div><hr>
  <div>กระดาษ: ${pw} มม.${opts.printMode === 'raster' ? ` · ESC/POS ${dotsOf(pw, opts)} จุด · ${opts.connection === 'network' ? `LAN ${opts.host}:${opts.port}` : opts.connection === 'bluetooth' ? `Bluetooth ${opts.comPort}` : 'USB'}` : ' · ไดรเวอร์ Windows'}</div>
  <div>เวลา: ${new Date().toLocaleString('th-TH')}</div>
  <div class="bar"></div><div class="ruler"><span>|ซ้าย</span><span>กลาง</span><span>ขวา|</span></div><div class="bar"></div>
  <div>ความเข้ม (ไล่สีขาว → ดำ)</div><div class="grey"></div>
  <div>ภาษาไทย ก่ ก้ กุ้ง ฟ้า ญี่ปุ่น · English ABC 123</div><hr><div class="c">— จบการทดสอบ —</div>
</body></html>`;

// ---------------------------------------------------------------- IPC
const fromServer = (e) => isServerUrl(e.senderFrame?.url ?? '');
const fromShell = (e) => isAppFile(e.senderFrame?.url ?? '');

// ---------------------------------------------------------------- หัวหน้าต่าง
// Clothing POS - Version: 1.0.3 | ร้าน <ชื่อร้าน>, <สาขา> | <IP เครื่องนี้>
let titleInfo = { shop: '', branch: '' };

/** IPv4 ของเครื่องนี้ในวง LAN (ไม่เอา loopback / 169.254 / การ์ดเสมือนของ VirtualBox, VMware, Hyper-V) */
function localIp() {
  const skip = /virtual|vmware|vbox|hyper-v|vethernet|loopback|bluetooth|tailscale|zerotier|wsl/i;
  const cands = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      cands.push({ name, address: a.address, virtual: skip.test(name) });
    }
  }
  const real = cands.find((c) => !c.virtual) || cands[0];
  return real ? real.address : '';
}

function windowTitle() {
  const parts = [`Clothing POS - Version: ${app.getVersion()}`];
  // ชื่อร้านที่ขึ้นต้นด้วย "ร้าน" อยู่แล้ว ไม่ต้องซ้ำ (ร้าน ร้านเสื้อผ้า → ร้าน เสื้อผ้า)
  const shop = [titleInfo.shop.replace(/^ร้าน\s*/, ''), titleInfo.branch].filter(Boolean).join(', ');
  if (shop) parts.push(`ร้าน ${shop}`);
  const ip = localIp();
  if (ip) parts.push(ip);
  if (config.license?.expiresAt) {
    const left = Math.max(0, Math.ceil((new Date(config.license.expiresAt.replace(' ', 'T')) - Date.now()) / 86_400_000));
    parts.push(`ทดลอง เหลือ ${left} วัน`);
  }
  return parts.join(' | ');
}

function refreshTitle() {
  if (win && !win.isDestroyed()) win.setTitle(windowTitle());
}
setInterval(refreshTitle, 60_000); // IP เปลี่ยนได้ (ย้าย Wi-Fi / DHCP)

const clip = (v) => String(v ?? '').replace(/[\r\n|]/g, ' ').trim().slice(0, 60);
ipcMain.on('pos:title-info', (e, info) => {
  if (!fromServer(e)) return;
  titleInfo = { shop: clip(info?.shop), branch: clip(info?.branch) };
  refreshTitle();
});

ipcMain.on('pos:sync-config', (e) => {
  e.returnValue = { serverOrigin: serverOrigin(), paperWidth: config.paperWidth, version: app.getVersion() };
});
ipcMain.handle('pos:print', (e, html, opts) => {
  if (!fromServer(e)) return { ok: false, error: 'not allowed' };
  return printDoc(String(html), opts?.paperWidth);
});
// ขายเสร็จ → เปิดลิ้นชักตามตั้งค่า ('cash' เฉพาะเงินสด · 'sale' ทุกการขาย)
ipcMain.on('pos:open-drawer', (e, info) => {
  if (!fromServer(e) || config.printMode !== 'raster') return;
  if (config.drawer === 'sale' || (config.drawer === 'cash' && info?.cash)) {
    openDrawer().catch((err) => win && !win.isDestroyed() && dialog.showMessageBox(win, { type: 'warning', title: 'ลิ้นชักเงิน', message: 'เปิดลิ้นชักไม่สำเร็จ', detail: err.message }));
  }
});

// ---- เครื่องพิมพ์: ใช้ทั้งหน้าตั้งค่าในแอป (file://) และหน้า ตั้งค่า → ใบเสร็จ ในระบบ POS (เซิร์ฟเวอร์)
const PRINTER_KEYS = ['printMode', 'connection', 'printer', 'host', 'port', 'comPort', 'baud', 'paperWidth', 'dots', 'threshold', 'cut', 'feedTop', 'feedBottom', 'drawer', 'drawerPin', 'silent'];
const pickPrinter = (c) => Object.fromEntries(PRINTER_KEYS.filter((k) => c && k in c).map((k) => [k, c[k]]));
const printerConfig = () => ({ ...pickPrinter(config), version: app.getVersion() });
async function listPrinters(wc) {
  const list = await wc.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
}
function testPrint(c) {
  const opts = sanitize({ ...config, ...pickPrinter(c) });
  const pw = opts.paperWidth || 80;
  return printDoc(TEST_PAGE(pw, opts), pw, opts, { notify: false });
}
async function previewTest(c) {
  const opts = sanitize({ ...config, ...pickPrinter(c), printMode: 'raster' });
  const pw = opts.paperWidth || 80;
  try {
    const { pages, dots } = await renderMono(TEST_PAGE(pw, opts), pw, opts);
    return { ok: true, image: monoPreview(pages), dots };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
async function testDrawer(c) {
  try {
    await openDrawer(sanitize({ ...config, ...pickPrinter(c) }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
const deny = { ok: false, error: 'not allowed' };

ipcMain.handle('shell:get-config', (e) => (fromShell(e) ? { ...config, version: app.getVersion(), defaultServer: DEFAULT_SERVER } : null));
ipcMain.handle('shell:list-printers', (e) => (fromShell(e) ? listPrinters(e.sender) : []));
ipcMain.handle('shell:list-ports', (e) => (fromShell(e) ? escpos.listSerialPorts() : []));
ipcMain.handle('shell:test-print', (e, c) => (fromShell(e) ? testPrint(c) : deny));
ipcMain.handle('shell:preview', (e, c) => (fromShell(e) ? previewTest(c) : deny));
ipcMain.handle('shell:test-drawer', (e, c) => (fromShell(e) ? testDrawer(c) : deny));

// หน้า ตั้งค่า → ใบเสร็จ ในระบบ POS — แก้ได้เฉพาะค่าเครื่องพิมพ์ (ไม่ให้หน้าเว็บเปลี่ยนที่อยู่เซิร์ฟเวอร์)
ipcMain.handle('pos:printer-get', (e) => (fromServer(e) ? printerConfig() : null));
ipcMain.handle('pos:printer-list', (e) => (fromServer(e) ? listPrinters(e.sender) : []));
ipcMain.handle('pos:printer-ports', (e) => (fromServer(e) ? escpos.listSerialPorts() : []));
ipcMain.handle('pos:printer-test', (e, c) => (fromServer(e) ? testPrint(c) : deny));
ipcMain.handle('pos:printer-preview', (e, c) => (fromServer(e) ? previewTest(c) : deny));
ipcMain.handle('pos:printer-drawer', (e, c) => (fromServer(e) ? testDrawer(c) : deny));
ipcMain.handle('pos:printer-save', (e, c) => {
  if (!fromServer(e)) return null;
  saveConfig(pickPrinter(c));
  return printerConfig();
});
// ---- เครื่องพิมพ์บาร์โค้ด (หน้า ตั้งค่า → ตั้งค่าเครื่องพิมพ์บาร์โค้ด) — เก็บแยกจากเครื่องพิมพ์ใบเสร็จ
const LABEL_KEYS = ['labelPrinter', 'labelSilent'];
const pickLabel = (c) => Object.fromEntries(LABEL_KEYS.filter((k) => c && k in c).map((k) => [k, c[k]]));
const labelConfig = () => ({ ...pickLabel(config), version: app.getVersion() });
ipcMain.handle('pos:label-get', (e) => (fromServer(e) ? labelConfig() : null));
ipcMain.handle('pos:label-save', (e, c) => {
  if (!fromServer(e)) return null;
  saveConfig(pickLabel(c));
  return labelConfig();
});
// พิมพ์ป้าย · c = ค่าที่ยังไม่บันทึก (ทดสอบพิมพ์จากหน้าตั้งค่า) — ไม่ส่งมา = ใช้ค่าที่บันทึกไว้
ipcMain.handle('pos:label-print', async (e, html, page, c) => {
  if (!fromServer(e)) return deny;
  const r = await printLabelDoc(String(html), page, c ? sanitize({ ...config, ...pickLabel(c) }) : config);
  if (!r.ok && !c && win && !win.isDestroyed()) {
    dialog.showMessageBox(win, { type: 'warning', title: 'พิมพ์ป้ายไม่สำเร็จ', message: 'พิมพ์ป้ายบาร์โค้ดไม่สำเร็จ', detail: r.error });
  }
  return r;
});

ipcMain.handle('shell:save-config', (e, c) => {
  if (!fromShell(e)) return null;
  const before = config.serverUrl;
  const saved = saveConfig(c);
  if (settingsWin) settingsWin.close();
  if (saved.serverUrl !== before) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updatesUrl() });
  }
  openServer(); // โหลดใหม่ให้หน้า POS ใช้ขนาดกระดาษ/เซิร์ฟเวอร์ใหม่
  return saved;
});
ipcMain.on('shell:retry', (e) => fromShell(e) && startShop());
// ---- หน้าเปิดใช้งาน (ชุดทดลอง)
ipcMain.handle('shell:license-state', (e) => (fromShell(e) ? { code: config.license?.code || '', shop: config.license?.shop || '', machineName: machineName(), licenseServer: licenseServer() } : null));
ipcMain.handle('shell:activate', async (e, code) => {
  if (!fromShell(e)) return deny;
  const r = await licenseCall('activate', String(code || ''));
  if (r.ok) rememberLicense(r);
  return r;
});
ipcMain.on('shell:start-pos', (e) => fromShell(e) && config.license && openServer());
ipcMain.on('shell:open-settings', (e) => fromShell(e) && openSettings());
ipcMain.on('shell:close-settings', (e) => fromShell(e) && settingsWin?.close());

// ---------------------------------------------------------------- อัปเดตอัตโนมัติ
// ดาวน์โหลดเบื้องหลัง → ในหน้า POS ขึ้นปุ่ม "อัปเดต vX.Y.Z" (TopBar + เมนูข้าง) ให้พนักงานกดเมื่อสะดวก
// ไม่กด = ติดตั้งให้ตอนปิดโปรแกรม
// บังคับ: วาง <เซิร์ฟเวอร์>/updates/min-version.json  {"minVersion":"1.2.0","message":"..."}
//         เครื่องที่เก่ากว่า minVersion → ขึ้นกล่องให้ติดตั้งทันที (ไม่มีปุ่มภายหลัง)
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
let manualCheck = false;
let update = { status: 'idle', current: app.getVersion(), version: null, percent: 0, forced: false, notes: [] };

/** รายละเอียดอัปเดตจาก latest.yml (releaseNotes) → รายการข้อสั้น ๆ */
function noteLines(raw) {
  const text = Array.isArray(raw) ? raw.map((r) => r?.note ?? '').join('\n') : String(raw ?? '');
  return text
    .replace(/<\/(p|li|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function setUpdate(patch) {
  update = { ...update, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('pos:update', update);
}

const cmpVer = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};
async function minVersionPolicy() {
  try {
    const res = await net.fetch(`${updatesUrl()}min-version.json`, { cache: 'no-store', headers: appHeaders() });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.minVersion ? { minVersion: String(j.minVersion), message: String(j.message || '') } : null;
  } catch {
    return null;
  }
}
function installNow() {
  if (update.status !== 'ready') return false;
  setImmediate(() => autoUpdater.quitAndInstall(true, true)); // ติดตั้งเงียบ แล้วเปิดโปรแกรมใหม่
  return true;
}

function setupUpdater() {
  if (!app.isPackaged) return; // โหมดพัฒนาไม่อัปเดต
  autoUpdater.setFeedURL({ provider: 'generic', url: updatesUrl() });
  autoUpdater.requestHeaders = appHeaders(); // electron-updater ใช้ session แยก → แนบกุญแจเอง
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', title: 'อัปเดต', message: `ใช้เวอร์ชันล่าสุดอยู่แล้ว (${app.getVersion()})` });
    manualCheck = false;
  });
  autoUpdater.on('update-available', (info) => {
    if (update.status !== 'ready') setUpdate({ status: 'downloading', version: info.version, percent: 0 });
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', title: 'อัปเดต', message: `พบเวอร์ชัน ${info.version} กำลังดาวน์โหลด…`, detail: 'ดาวน์โหลดเสร็จแล้วจะมีปุ่ม "อัปเดต" ขึ้นในหน้าโปรแกรม ใช้งานต่อได้ตามปกติ' });
    manualCheck = false;
  });
  autoUpdater.on('download-progress', (p) => {
    win?.setProgressBar(p.percent / 100);
    if (Math.floor(p.percent) !== Math.floor(update.percent)) setUpdate({ percent: p.percent });
  });
  autoUpdater.on('error', (err) => {
    win?.setProgressBar(-1);
    if (update.status === 'downloading') setUpdate({ status: 'idle', percent: 0 }); // ลองใหม่รอบถัดไป
    if (manualCheck) dialog.showMessageBox(win, { type: 'warning', title: 'อัปเดต', message: 'ตรวจสอบอัปเดตไม่สำเร็จ', detail: String(err?.message ?? err) });
    manualCheck = false;
  });
  autoUpdater.on('update-downloaded', async (info) => {
    win?.setProgressBar(-1);
    const policy = await minVersionPolicy();
    const forced = !!policy && cmpVer(app.getVersion(), policy.minVersion) < 0;
    setUpdate({ status: 'ready', version: info.version, percent: 100, forced, notes: noteLines(info.releaseNotes) });
    if (!forced) return; // ปกติ: แสดงเป็นปุ่มในหน้าโปรแกรม
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'ต้องอัปเดตโปรแกรม',
      message: `Clothing POS เวอร์ชัน ${info.version} พร้อมติดตั้ง`,
      detail: `${policy.message || 'อัปเดตนี้จำเป็น ต้องติดตั้งก่อนใช้งานต่อ'}\n\nเวอร์ชันปัจจุบัน ${app.getVersion()} · โปรแกรมจะปิดแล้วเปิดใหม่เอง`,
      buttons: ['ติดตั้งตอนนี้'],
      noLink: true,
    });
    installNow();
  });

  const check = () => {
    if (update.status === 'idle') autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, 15_000);
  setInterval(check, CHECK_EVERY_MS);
}
function checkNow() {
  if (!app.isPackaged) return dialog.showMessageBox(win, { type: 'info', message: 'โหมดพัฒนา — ไม่ตรวจอัปเดต' });
  if (update.status === 'ready') return dialog.showMessageBox(win, { type: 'info', title: 'อัปเดต', message: `เวอร์ชัน ${update.version} ดาวน์โหลดแล้ว`, detail: 'กดปุ่ม "อัปเดต" สีเขียวในหน้าโปรแกรมเพื่อติดตั้ง' });
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}
ipcMain.handle('pos:update-state', () => update);
ipcMain.handle('pos:update-install', (e) => (fromServer(e) || fromShell(e) ? installNow() : false));
ipcMain.handle('pos:update-check', (e) => {
  if (fromServer(e) && app.isPackaged && update.status === 'idle') autoUpdater.checkForUpdates().catch(() => {});
});

// ---------------------------------------------------------------- เมนู
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: 'ระบบ',
      submenu: [
        { label: 'ตั้งค่าเครื่องนี้ (เครื่องพิมพ์ / กระดาษ / เซิร์ฟเวอร์)', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { label: 'โหลดหน้าใหม่', accelerator: 'F5', click: openServer },
        { label: 'ตรวจสอบอัปเดต', click: checkNow },
        {
          label: 'ข้อมูล license',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'license',
              message: config.license ? `${config.license.shop}` : 'ยังไม่ได้เปิดใช้งาน',
              detail: config.license ? `รหัส: ${config.license.code}\nใช้ได้ถึง: ${config.license.expiresAt || '-'}\nระบบร้าน: ${config.serverUrl}\nเครื่อง: ${machineName()}` : '',
            }),
        },
        { label: 'เปลี่ยน license', click: () => showActivate() },
        { type: 'separator' },
        { label: 'เครื่องมือนักพัฒนา', accelerator: 'F12', role: 'toggleDevTools' },
        { label: `เกี่ยวกับ (เวอร์ชัน ${app.getVersion()})`, click: () => dialog.showMessageBox(win, { type: 'info', title: 'Clothing POS', message: `Clothing POS ${app.getVersion()}`, detail: `เซิร์ฟเวอร์: ${config.serverUrl}\nพัฒนาต้นแบบโดย n4444n` }) },
        { type: 'separator' },
        { label: 'ออก', role: 'quit' },
      ],
    },
    { label: 'มุมมอง', submenu: [{ role: 'zoomIn', label: 'ขยาย' }, { role: 'zoomOut', label: 'ย่อ' }, { role: 'resetZoom', label: 'ขนาดปกติ' }, { role: 'togglefullscreen', label: 'เต็มจอ' }] },
  ]),
);

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(() => {
  installRequestHeaders();
  createWindow();
  setupUpdater();
  setInterval(recheckLicense, 2 * 60_000); // ระงับ/ต่ออายุ/ลบเครื่องในแผงควบคุม มีผลภายใน 2 นาทีแม้เปิดค้างไว้
});
app.on('window-all-closed', () => app.quit());
