// สะพานระหว่างหน้าเว็บกับแอป — เปิดเฉพาะสิ่งที่จำเป็น
// - หน้า POS จากเซิร์ฟเวอร์ที่ตั้งไว้ → window.posDesktop (พิมพ์ตรง + ขนาดกระดาษของเครื่องนี้)
// - หน้าภายในแอป (file://: ตั้งค่า / ออฟไลน์) → window.desktopShell
const { contextBridge, ipcRenderer } = require('electron');

const cfg = ipcRenderer.sendSync('pos:sync-config');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('desktopShell', {
    version: cfg.version,
    getConfig: () => ipcRenderer.invoke('shell:get-config'),
    saveConfig: (c) => ipcRenderer.invoke('shell:save-config', c),
    listPrinters: () => ipcRenderer.invoke('shell:list-printers'),
    testPrint: (c) => ipcRenderer.invoke('shell:test-print', c),
    retry: () => ipcRenderer.send('shell:retry'),
    openSettings: () => ipcRenderer.send('shell:open-settings'),
    closeSettings: () => ipcRenderer.send('shell:close-settings'),
  });
} else if (location.origin === cfg.serverOrigin) {
  contextBridge.exposeInMainWorld('posDesktop', {
    version: cfg.version,
    paperWidth: () => cfg.paperWidth,
    print: (html, opts) => ipcRenderer.invoke('pos:print', String(html), { paperWidth: opts && opts.paperWidth === 58 ? 58 : 80 }),
  });
}
