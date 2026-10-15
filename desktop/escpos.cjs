// ESC/POS — พิมพ์ใบเสร็จเป็น "รูปภาพ" ส่งตรงเข้าเครื่องพิมพ์ใบเสร็จ (ไม่ผ่านไดรเวอร์ Windows)
// - ภาษาไทยออกถูกทุกตัว (ส่งเป็นภาพ ไม่ใช้ตารางอักษรของเครื่องพิมพ์)
// - ตัดกระดาษ (GS V) · เปิดลิ้นชักเงิน (ESC p) · เว้นระยะหัว/ท้าย (ESC J)
// - ส่งทาง LAN/WiFi (TCP 9100) หรือ USB (Windows spooler แบบ RAW)
// ไม่พึ่ง Electron — ทดสอบด้วย node ได้ และใช้ร่วมกับตัวจำลองเครื่องพิมพ์ (tools/printer-emulator.cjs)
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const DOTS_PER_MM = 8; // เครื่องพิมพ์ใบเสร็จทั่วไป 203 dpi
/** ความกว้างพิมพ์มาตรฐาน (จุด): 58 มม. → 384 · 80 มม. → 576 */
const defaultDots = (paper) => (paper === 58 ? 384 : 576);

/**
 * ภาพสี BGRA/RGBA → ภาพขาวดำ 1 บิต (แถวละ widthBytes ไบต์ บิตซ้ายสุด = MSB)
 * @param {Uint8Array} px ข้อมูลพิกเซล 4 ไบต์/จุด
 * @param {'bgra'|'rgba'} order
 * @param {number} threshold 0–255 · มากขึ้น = เข้มขึ้น (จุดสีเทาอ่อนกลายเป็นดำ)
 */
function toMono(px, width, height, threshold = 160, order = 'bgra') {
  const widthBytes = Math.ceil(width / 8);
  const out = new Uint8Array(widthBytes * height);
  const [ri, bi] = order === 'bgra' ? [2, 0] : [0, 2];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = px[i + 3] / 255;
      // พื้นโปร่งใส = ขาว
      const lum = (0.299 * px[i + ri] + 0.587 * px[i + 1] + 0.114 * px[i + bi]) * a + 255 * (1 - a);
      if (lum < threshold) out[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bits: out, width, widthBytes, height };
}

/** ต่อภาพขาวดำหลายชิ้นในแนวตั้ง (ความกว้างเท่ากัน) */
function concatMono(parts) {
  if (!parts.length) return { bits: new Uint8Array(0), width: 0, widthBytes: 0, height: 0 };
  const { width, widthBytes } = parts[0];
  const height = parts.reduce((s, p) => s + p.height, 0);
  const bits = new Uint8Array(widthBytes * height);
  let off = 0;
  for (const p of parts) {
    bits.set(p.bits, off);
    off += p.bits.length;
  }
  return { bits, width, widthBytes, height };
}

/** ตัดภาพตามแถว [y0, y1) */
function sliceMono(img, y0, y1) {
  y0 = Math.max(0, Math.min(img.height, y0));
  y1 = Math.max(y0, Math.min(img.height, y1));
  return { ...img, bits: img.bits.subarray(y0 * img.widthBytes, y1 * img.widthBytes), height: y1 - y0 };
}

/** ตัดแถวขาวล้วนท้ายภาพ (ไม่เปลืองกระดาษ) */
function trimBottom(img) {
  let h = img.height;
  const w = img.widthBytes;
  while (h > 0 && img.bits.subarray((h - 1) * w, h * w).every((b) => b === 0)) h--;
  return sliceMono(img, 0, h);
}

const BAND = 255; // บางรุ่นรับภาพทีละไม่เกิน 255 แถว → ส่งเป็นช่วง ๆ
const feedDots = (dots) => {
  const out = [];
  for (let d = Math.round(dots); d > 0; d -= 255) out.push(0x1b, 0x4a, Math.min(255, d)); // ESC J n
  return out;
};

/**
 * สร้างคำสั่ง ESC/POS
 * @param {object} job
 * @param {Array<{bits:Uint8Array,widthBytes:number,height:number}>} job.pages ภาพแต่ละสำเนา (ตัดกระดาษคั่น)
 * @param {number} [job.feedTopMm] เว้นหัว · [job.feedBottomMm] เว้นท้ายก่อนตัด
 * @param {boolean} [job.cut] ตัดกระดาษหลังแต่ละสำเนา
 * @param {boolean} [job.drawer] เปิดลิ้นชัก · [job.drawerPin] 0 = ขา 2 (ทั่วไป) · 1 = ขา 5
 */
function buildJob({ pages, feedTopMm = 0, feedBottomMm = 4, cut = true, drawer = false, drawerPin = 0 }) {
  const chunks = [Buffer.from([0x1b, 0x40])]; // ESC @ เริ่มต้นเครื่องพิมพ์
  // เปิดลิ้นชักก่อนพิมพ์ — พนักงานทอนเงินได้ระหว่างรอใบเสร็จ
  if (drawer) chunks.push(Buffer.from([0x1b, 0x70, drawerPin ? 1 : 0, 25, 250])); // ESC p m t1 t2 (50ms on / 500ms off)
  pages.forEach((img) => {
    if (feedTopMm > 0) chunks.push(Buffer.from(feedDots(feedTopMm * DOTS_PER_MM)));
    for (let y = 0; y < img.height; y += BAND) {
      const h = Math.min(BAND, img.height - y);
      const xL = img.widthBytes & 0xff;
      const xH = img.widthBytes >> 8;
      chunks.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, h & 0xff, h >> 8])); // GS v 0
      chunks.push(Buffer.from(img.bits.subarray(y * img.widthBytes, (y + h) * img.widthBytes)));
    }
    if (feedBottomMm > 0) chunks.push(Buffer.from(feedDots(feedBottomMm * DOTS_PER_MM)));
    if (cut) chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // GS V 66 0: เลื่อนถึงใบมีด แล้วตัด
  });
  return Buffer.concat(chunks);
}

/** คำสั่งเปิดลิ้นชักอย่างเดียว */
const drawerOnly = (pin = 0) => Buffer.from([0x1b, 0x40, 0x1b, 0x70, pin ? 1 : 0, 25, 250]);

/** ส่งทาง LAN/WiFi (TCP — เครื่องพิมพ์ใบเสร็จส่วนใหญ่ใช้พอร์ต 9100) */
function sendNetwork(host, port, data, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: Number(port) || 9100 });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      sock.destroy();
      err ? reject(err) : resolve();
    };
    sock.setTimeout(timeoutMs, () => finish(new Error(`เครื่องพิมพ์ ${host}:${port} ไม่ตอบสนอง — ตรวจ IP / สาย LAN / WiFi`)));
    sock.on('error', (e) =>
      finish(new Error(e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT' ? `เชื่อมต่อเครื่องพิมพ์ ${host}:${port} ไม่ได้ (${e.code})` : e.message)),
    );
    sock.on('connect', () => sock.end(data, () => setTimeout(() => finish(), 150)));
  });
}

// USB: ส่งข้อมูลดิบผ่าน Windows spooler (RAW) — ใช้ได้กับเครื่องพิมพ์ใบเสร็จที่ติดตั้งไดรเวอร์แล้ว
// ใช้ PowerShell + winspool.drv (ไม่ต้องมี native module)
const RAW_PS1 = String.raw`param([string]$Printer, [string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter " + Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFO { pDocName = "Clothing POS", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter " + Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int w;
        if (!WritePrinter(h, data, data.Length, out w) || w != data.Length) throw new Exception("WritePrinter " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[PosRawPrinter]::Send($Printer, [System.IO.File]::ReadAllBytes($Path))
`;

function sendWindowsRaw(printerName, data) {
  if (process.platform !== 'win32') return Promise.reject(new Error('ส่งแบบ USB (RAW) ใช้ได้บน Windows เท่านั้น'));
  if (!printerName) return Promise.reject(new Error('ยังไม่ได้เลือกเครื่องพิมพ์ USB'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-print-'));
  const ps1 = path.join(dir, 'raw.ps1');
  const bin = path.join(dir, 'job.bin');
  fs.writeFileSync(ps1, '﻿' + RAW_PS1, 'utf8'); // BOM: ให้ PowerShell 5 อ่าน UTF-8 ถูก
  fs.writeFileSync(bin, data);
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Printer', printerName, '-Path', bin],
      { windowsHide: true, timeout: 30_000 },
      (err, _out, stderr) => {
        fs.rm(dir, { recursive: true, force: true }, () => {});
        if (!err) return resolve();
        const msg = String(stderr || err.message).trim().split(/\r?\n/)[0];
        reject(new Error(/OpenPrinter/.test(msg) ? `ไม่พบเครื่องพิมพ์ "${printerName}" ใน Windows` : `ส่งงานพิมพ์ไม่สำเร็จ: ${msg}`));
      },
    );
  });
}

module.exports = { DOTS_PER_MM, defaultDots, toMono, concatMono, sliceMono, trimBottom, buildJob, drawerOnly, sendNetwork, sendWindowsRaw };
