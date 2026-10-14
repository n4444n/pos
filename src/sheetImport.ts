// อ่านไฟล์นำเข้า (.xlsx / .csv / .txt) → ข้อความ "รหัส จำนวน" บรรทัดละรายการ — ไม่ต้องติดตั้งไลบรารีเพิ่ม
// .xlsx = zip ของไฟล์ XML: อ่าน central directory แล้วแตกไฟล์ด้วย DecompressionStream('deflate-raw') ของเบราว์เซอร์

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: new (f: string) => TransformStream }).DecompressionStream;
  if (!DS) throw new Error('เบราว์เซอร์นี้อ่านไฟล์ .xlsx ไม่ได้ — บันทึกเป็น .csv แล้วนำเข้าแทน');
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DS('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ไฟล์ .xlsx ไม่ถูกต้อง');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!wanted(name)) continue;
    const lnlen = dv.getUint16(local + 26, true);
    const lelen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lelen;
    const raw = u8.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (data) out.set(name, dec.decode(data));
  }
  return out;
}

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0) - 1;
};

async function xlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sheetName = [...files.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort()[0];
  if (!sheetName) throw new Error('ไม่พบชีตในไฟล์');
  const parser = new DOMParser();
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) {
    const doc = parser.parseFromString(ss, 'application/xml');
    for (const si of Array.from(doc.getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
    }
  }
  const doc = parser.parseFromString(files.get(sheetName)!, 'application/xml');
  const rows: string[][] = [];
  for (const row of Array.from(doc.getElementsByTagName('row'))) {
    const cells: string[] = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const text = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('') : v;
      cells[colIndex(c.getAttribute('r') ?? 'A')] = text;
    }
    rows.push(Array.from(cells, (x) => (x ?? '').trim()));
  }
  return rows;
}

function csvRows(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.split(/[,;\t]/).map((x) => x.trim().replace(/^"(.*)"$/, '$1')));
}

/** อ่านไฟล์ (.xlsx / .csv) → ตาราง (แถว × คอลัมน์) */
export async function fileToRows(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  return name.endsWith('.xlsx') ? xlsxRows(await file.arrayBuffer()) : csvRows(await file.text());
}

/** อ่านไฟล์ที่เลือก → ข้อความคำสั่ง (2 คอลัมน์แรก: รหัส, จำนวน) */
export async function fileToCommandText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const rows = name.endsWith('.xlsx') ? await xlsxRows(await file.arrayBuffer()) : csvRows(await file.text());
  return rows
    .map((r) => r.filter((x) => x !== undefined))
    .filter((r) => r[0])
    .map((r) => (r[1] ? `${r[0]} ${r[1]}` : r[0]))
    .join('\n');
}

/** เปิดหน้าต่างเลือกไฟล์ (เว็บ) */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
