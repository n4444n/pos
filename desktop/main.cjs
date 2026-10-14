// Clothing POS — แอปเดสก์ท็อป (Electron) แบบเครื่องลูก
// - เปิดหน้า POS จากเซิร์ฟเวอร์กลาง (VPS) · ทุกสาขาใช้ฐานข้อมูลเดียวกัน
// - พิมพ์ใบเสร็จตรงเข้าเครื่องพิมพ์ (ไม่ขึ้นกล่องเลือกเครื่องพิมพ์) · กระดาษ 58/80 มม.
// - อัปเดตตัวเองผ่าน electron-updater (ไฟล์อยู่ที่ <เซิร์ฟเวอร์>/updates/)
// ตั้งค่าของเครื่องนี้เก็บที่ %APPDATA%\Clothing POS\config.json
// พัฒนาต้นแบบโดย n4444n (MIT + Attribution — ดูไฟล์ LICENSE)
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------- ตั้งค่าเครื่องนี้
const DEFAULT_SERVER = 'https://pos.sh0p.tech';
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = {
  serverUrl: DEFAULT_SERVER,
  printer: '', //          '' = เครื่องพิมพ์หลักของ Windows
  paperWidth: null, //     null = ตามตั้งค่าร้าน · 58 / 80 = บังคับเฉพาะเครื่องนี้
  silent: true, //         true = พิมพ์ทันที · false = แสดงกล่องเลือกเครื่องพิมพ์
};
let config = loadConfig();

function loadConfig() {
  try {
    return sanitize({ ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) });
  } catch {
    return { ...DEFAULTS };
  }
}
function sanitize(c) {
  let serverUrl = String(c.serverUrl || DEFAULT_SERVER).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(serverUrl)) serverUrl = DEFAULT_SERVER;
  return {
    serverUrl,
    printer: String(c.printer || ''),
    paperWidth: c.paperWidth === 58 || c.paperWidth === 80 ? c.paperWidth : null,
    silent: c.silent !== false,
  };
}
function saveConfig(next) {
  config = sanitize({ ...config, ...next });
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  return config;
}
const serverOrigin = () => new URL(config.serverUrl).origin;
const updatesUrl = () => `${config.serverUrl}/updates/`;

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
    title: `Clothing POS ${app.getVersion()}`,
    backgroundColor: '#f4f6fb',
    autoHideMenuBar: true,
    show: false,
    webPreferences,
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.on('page-title-updated', (e) => e.preventDefault());
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
    if (url.startsWith('file:') || isServerUrl(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  // เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ → หน้าออฟไลน์ (ลองใหม่อัตโนมัติ)
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ABORTED */ || url.startsWith('file:')) return;
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: config.serverUrl, err: `${desc} (${code})` } });
  });

  win.loadFile(path.join(__dirname, 'splash.html'));
  setTimeout(openServer, 300);
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
    width: 560,
    height: 680,
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
async function printHtml(html, paperWidthFromShop, opts = config) {
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
    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, { type: 'warning', title: 'พิมพ์ไม่สำเร็จ', message: 'พิมพ์ไม่สำเร็จ', detail: `${error}\n\nตั้งค่าเครื่องพิมพ์ได้ที่เมนู ระบบ → ตั้งค่าเครื่องนี้` });
    }
    return { ok: false, error };
  } finally {
    pwin.destroy();
  }
}

const TEST_PAGE = (pw) => `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
  body{font-family:system-ui,sans-serif;font-size:12px;width:${pw === 58 ? 50 : 72}mm;margin:0 auto;color:#000}
  .c{text-align:center} hr{border:0;border-top:1px dashed #000;margin:6px 0} .ruler{display:flex;justify-content:space-between}
</style></head><body>
  <h3 class="c" style="margin:6px 0">ทดสอบเครื่องพิมพ์</h3>
  <div class="c">Clothing POS ${app.getVersion()}</div><hr>
  <div>กระดาษ: ${pw} มม.</div><div>เวลา: ${new Date().toLocaleString('th-TH')}</div>
  <hr><div class="ruler"><span>|ซ้าย</span><span>กลาง</span><span>ขวา|</span></div>
  <div>ภาษาไทย ก ข ค ง · English ABC 123</div><hr><div class="c">— จบการทดสอบ —</div>
</body></html>`;

// ---------------------------------------------------------------- IPC
const fromServer = (e) => isServerUrl(e.senderFrame?.url ?? '');
const fromShell = (e) => (e.senderFrame?.url ?? '').startsWith('file:');

ipcMain.on('pos:sync-config', (e) => {
  e.returnValue = { serverOrigin: serverOrigin(), paperWidth: config.paperWidth, version: app.getVersion() };
});
ipcMain.handle('pos:print', (e, html, opts) => {
  if (!fromServer(e)) return { ok: false, error: 'not allowed' };
  return printHtml(String(html), opts?.paperWidth);
});

ipcMain.handle('shell:get-config', (e) => (fromShell(e) ? { ...config, version: app.getVersion(), defaultServer: DEFAULT_SERVER } : null));
ipcMain.handle('shell:list-printers', async (e) => {
  if (!fromShell(e)) return [];
  const list = await e.sender.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
});
ipcMain.handle('shell:test-print', (e, c) => {
  if (!fromShell(e)) return { ok: false, error: 'not allowed' };
  const opts = sanitize({ ...config, ...c });
  return printHtml(TEST_PAGE(opts.paperWidth || 80), 80, opts);
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
ipcMain.on('shell:retry', (e) => fromShell(e) && openServer());
ipcMain.on('shell:open-settings', (e) => fromShell(e) && openSettings());
ipcMain.on('shell:close-settings', (e) => fromShell(e) && settingsWin?.close());

// ---------------------------------------------------------------- อัปเดตอัตโนมัติ
// ปกติ: ดาวน์โหลดเบื้องหลัง → ถาม "รีสตาร์ตตอนนี้ / ภายหลัง" (ภายหลัง = ติดตั้งตอนปิดโปรแกรม)
// บังคับ: วาง <เซิร์ฟเวอร์>/updates/min-version.json  {"minVersion":"1.2.0","message":"..."}
//         เครื่องที่เก่ากว่า minVersion จะติดตั้งทันทีเมื่อดาวน์โหลดเสร็จ
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
let manualCheck = false;
let promptOpen = false;

const cmpVer = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};
async function minVersionPolicy() {
  try {
    const res = await net.fetch(`${updatesUrl()}min-version.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.minVersion ? { minVersion: String(j.minVersion), message: String(j.message || '') } : null;
  } catch {
    return null;
  }
}

function setupUpdater() {
  if (!app.isPackaged) return; // โหมดพัฒนาไม่อัปเดต
  autoUpdater.setFeedURL({ provider: 'generic', url: updatesUrl() });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', title: 'อัปเดต', message: `ใช้เวอร์ชันล่าสุดอยู่แล้ว (${app.getVersion()})` });
    manualCheck = false;
  });
  autoUpdater.on('update-available', (info) => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', title: 'อัปเดต', message: `พบเวอร์ชัน ${info.version} กำลังดาวน์โหลด…`, detail: 'ดาวน์โหลดเสร็จแล้วจะแจ้งให้ติดตั้ง ใช้งานต่อได้ตามปกติ' });
    manualCheck = false;
  });
  autoUpdater.on('download-progress', (p) => win?.setProgressBar(p.percent / 100));
  autoUpdater.on('error', (err) => {
    win?.setProgressBar(-1);
    if (manualCheck) dialog.showMessageBox(win, { type: 'warning', title: 'อัปเดต', message: 'ตรวจสอบอัปเดตไม่สำเร็จ', detail: String(err?.message ?? err) });
    manualCheck = false;
  });
  autoUpdater.on('update-downloaded', async (info) => {
    win?.setProgressBar(-1);
    if (promptOpen) return;
    promptOpen = true;
    const policy = await minVersionPolicy();
    const forced = !!policy && cmpVer(app.getVersion(), policy.minVersion) < 0;
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, '').trim() : '';
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'มีอัปเดตใหม่',
      message: `Clothing POS เวอร์ชัน ${info.version} พร้อมติดตั้ง`,
      detail: [
        `เวอร์ชันปัจจุบัน ${app.getVersion()}`,
        forced ? policy.message || 'อัปเดตนี้จำเป็น ต้องติดตั้งก่อนใช้งานต่อ' : 'ถ้าเลือก "ภายหลัง" จะติดตั้งให้อัตโนมัติตอนปิดโปรแกรม',
        notes,
      ].filter(Boolean).join('\n\n'),
      buttons: forced ? ['ติดตั้งตอนนี้'] : ['รีสตาร์ตและติดตั้งตอนนี้', 'ภายหลัง'],
      defaultId: forced ? 0 : 1,
      cancelId: forced ? 0 : 1,
      noLink: true,
    });
    promptOpen = false;
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15_000);
  setInterval(check, CHECK_EVERY_MS);
}
function checkNow() {
  if (!app.isPackaged) return dialog.showMessageBox(win, { type: 'info', message: 'โหมดพัฒนา — ไม่ตรวจอัปเดต' });
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

// ---------------------------------------------------------------- เมนู
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: 'ระบบ',
      submenu: [
        { label: 'ตั้งค่าเครื่องนี้ (เครื่องพิมพ์ / กระดาษ / เซิร์ฟเวอร์)', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { label: 'โหลดหน้าใหม่', accelerator: 'F5', click: openServer },
        { label: 'ตรวจสอบอัปเดต', click: checkNow },
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
  createWindow();
  setupUpdater();
});
app.on('window-all-closed', () => app.quit());
