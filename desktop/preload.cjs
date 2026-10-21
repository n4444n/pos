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
    listPorts: () => ipcRenderer.invoke('shell:list-ports'),
    testPrint: (c) => ipcRenderer.invoke('shell:test-print', c),
    preview: (c) => ipcRenderer.invoke('shell:preview', c),
    testDrawer: (c) => ipcRenderer.invoke('shell:test-drawer', c),
    retry: () => ipcRenderer.send('shell:retry'),
    openSettings: () => ipcRenderer.send('shell:open-settings'),
    closeSettings: () => ipcRenderer.send('shell:close-settings'),
  });
} else if (location.origin === cfg.serverOrigin) {
  let paper = cfg.paperWidth; // ขนาดกระดาษของเครื่องนี้ (อัปเดตเมื่อบันทึกจากหน้า ตั้งค่า → ใบเสร็จ)
  contextBridge.exposeInMainWorld('posDesktop', {
    version: cfg.version,
    paperWidth: () => paper,
    // ตั้งค่าเครื่องพิมพ์ของเครื่องนี้จากหน้า ตั้งค่า → ใบเสร็จ (มีตั้งแต่ 1.0.4)
    printer: {
      get: () => ipcRenderer.invoke('pos:printer-get'),
      list: () => ipcRenderer.invoke('pos:printer-list'),
      ports: () => ipcRenderer.invoke('pos:printer-ports'),
      test: (c) => ipcRenderer.invoke('pos:printer-test', c),
      preview: (c) => ipcRenderer.invoke('pos:printer-preview', c),
      testDrawer: (c) => ipcRenderer.invoke('pos:printer-drawer', c),
      save: async (c) => {
        const saved = await ipcRenderer.invoke('pos:printer-save', c);
        if (saved) paper = saved.paperWidth;
        return saved;
      },
    },
    // เครื่องพิมพ์บาร์โค้ด (ป้ายติดสินค้า) แยกจากเครื่องพิมพ์ใบเสร็จ — หน้า ตั้งค่า → ตั้งค่าเครื่องพิมพ์บาร์โค้ด
    labels: {
      get: () => ipcRenderer.invoke('pos:label-get'),
      save: (c) => ipcRenderer.invoke('pos:label-save', c),
      list: () => ipcRenderer.invoke('pos:printer-list'),
      print: (html, page, c) =>
        ipcRenderer.invoke('pos:label-print', String(html), { width: Number(page && page.width) || 0, height: Number(page && page.height) || 0 }, c || null),
    },
    // ชื่อร้าน/สาขาบนหัวหน้าต่างโปรแกรม (มีตั้งแต่ 1.0.3)
    setTitleInfo: (info) => ipcRenderer.send('pos:title-info', { shop: String(info?.shop ?? ''), branch: String(info?.branch ?? '') }),
    print: (html, opts) =>
      ipcRenderer.invoke('pos:print', String(html), { paperWidth: opts && opts.paperWidth === 58 ? 58 : 80, kind: String((opts && opts.kind) || '') }),
    // ขายเสร็จ → เปิดลิ้นชักเงินตามตั้งค่าเครื่องนี้ (มีตั้งแต่ 1.0.4)
    openDrawer: (info) => ipcRenderer.send('pos:open-drawer', { cash: !!(info && info.cash) }),
    // อัปเดตแอป → ปุ่ม "อัปเดต vX.Y.Z" ในหน้า POS
    update: {
      get: () => ipcRenderer.invoke('pos:update-state'),
      install: () => ipcRenderer.invoke('pos:update-install'),
      check: () => ipcRenderer.invoke('pos:update-check'),
      onChange: (cb) => {
        const h = (_e, state) => cb(state);
        ipcRenderer.on('pos:update', h);
        return () => ipcRenderer.removeListener('pos:update', h);
      },
    },
  });
}
