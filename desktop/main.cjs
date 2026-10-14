// Clothing POS — แอปเดสก์ท็อป (Electron)
// เปิดเซิร์ฟเวอร์ POS (server/*.ts) ด้วย Node ที่แนบมากับแอป แล้วแสดงหน้าเว็บในหน้าต่างของแอป
// ข้อมูลร้าน (ฐานข้อมูล + รูป) เก็บที่ %APPDATA%\Clothing POS\data — ถอนการติดตั้ง/อัปเดตแอปแล้วข้อมูลยังอยู่
// พัฒนาต้นแบบโดย n4444n (MIT + Attribution — ดูไฟล์ LICENSE)
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const DEV = !app.isPackaged;
const RES = DEV ? path.join(__dirname, '..') : process.resourcesPath;
const SERVER_ENTRY = DEV ? path.join(RES, 'server', 'index.ts') : path.join(RES, 'server', 'index.ts');
const WEB_DIR = DEV ? path.join(RES, 'dist') : path.join(RES, 'web');
const NODE_BIN = DEV ? process.env.POS_NODE || 'node' : path.join(RES, 'runtime', 'node.exe');
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const LOG_FILE = path.join(app.getPath('userData'), 'server.log');

let win = null;
let server = null;
let port = 0;
let quitting = false;

/** หาพอร์ตว่าง เริ่มที่ 3100 (ไม่ชนกับเซิร์ฟเวอร์ที่รันด้วย start-ngrok.bat ซึ่งใช้ 3000) */
function freePort(start) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(freePort(start + 1)));
    s.once('listening', () => s.close(() => resolve(start)));
    s.listen(start, '127.0.0.1');
  });
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/auth/config', timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  port = await freePort(3100);
  const log = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  log.write(`\n===== ${new Date().toISOString()} · port ${port} =====\n`);
  server = spawn(
    NODE_BIN,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', SERVER_ENTRY],
    {
      cwd: app.getPath('userData'),
      env: { ...process.env, PORT: String(port), DB_PATH: path.join(DATA_DIR, 'pos.db'), WEB_DIR, NODE_ENV: 'production' },
      windowsHide: true,
    },
  );
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on('exit', (code) => {
    log.write(`[server exited ${code}]\n`);
    server = null;
    if (!quitting) {
      dialog.showErrorBox('Clothing POS', `เซิร์ฟเวอร์ของระบบหยุดทำงาน (รหัส ${code})\nดูรายละเอียดได้ที่:\n${LOG_FILE}`);
      app.quit();
    }
  });
  server.on('error', (e) => {
    log.write(`[spawn error] ${e.message}\n`);
  });
  for (let i = 0; i < 120; i++) {
    if (await ping()) return true;
    if (!server) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

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
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.loadFile(path.join(__dirname, 'splash.html'));
  // หน้าพิมพ์ใบเสร็จ/ใบส่งของ (window.open) เปิดในแอป · ลิงก์ภายนอกเปิดในเบราว์เซอร์
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(`http://127.0.0.1:${port}`)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 980, height: 900 } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => (win = null));
}

Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: 'ระบบ',
      submenu: [
        { label: 'โหลดหน้าใหม่', accelerator: 'F5', role: 'reload' },
        { label: 'เปิดโฟลเดอร์ข้อมูลร้าน', click: () => shell.openPath(DATA_DIR) },
        { label: 'เปิดไฟล์บันทึกเซิร์ฟเวอร์', click: () => shell.openPath(LOG_FILE) },
        { type: 'separator' },
        { label: 'เครื่องมือนักพัฒนา', accelerator: 'F12', role: 'toggleDevTools' },
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

app.whenReady().then(async () => {
  createWindow();
  const ok = await startServer();
  if (!ok) {
    if (!quitting) {
      dialog.showErrorBox('Clothing POS', `เริ่มระบบไม่สำเร็จ\nดูรายละเอียดได้ที่:\n${LOG_FILE}`);
      app.quit();
    }
    return;
  }
  if (win) win.loadURL(`http://127.0.0.1:${port}/`);
});

app.on('before-quit', () => {
  quitting = true;
  if (server) server.kill();
});
app.on('window-all-closed', () => app.quit());
