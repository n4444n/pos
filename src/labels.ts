// พิมพ์ป้ายบาร์โค้ดสินค้า (สติ๊กเกอร์ม้วน / กระดาษ A4) — เปิดหน้าต่างพิมพ์ของระบบ ให้เลือกเครื่องพิมพ์ป้ายเอง
// ใช้ได้ทั้งเบราว์เซอร์และแอปเดสก์ท็อป (แอปไม่พิมพ์ตรงเข้าเครื่องพิมพ์ใบเสร็จ เพราะป้ายมักใช้เครื่องพิมพ์คนละตัว)
import { Platform } from 'react-native';
import { getAppSettings } from './appSettings';
import { code128, ean13 } from './components/stock/Barcode';

export interface LabelItem {
  key: string;
  /** ชื่อสินค้า */
  name: string;
  /** สี / ไซซ์ / แบบ */
  variant: string;
  /** รหัสบนบาร์โค้ด (บาร์โค้ดกำหนดเอง หรือรหัส SKU) */
  code: string;
  price: number;
  stock: number;
}

export type LabelPaper = 'r50x30' | 'r40x30' | 'r32x25' | 'r60x40' | 'a4x24' | 'a4x65';
export const LABEL_PAPERS: { id: LabelPaper; label: string; hint: string }[] = [
  { id: 'r50x30', label: '50 × 30 มม.', hint: 'สติ๊กเกอร์ม้วน (นิยมสุด)' },
  { id: 'r40x30', label: '40 × 30 มม.', hint: 'สติ๊กเกอร์ม้วน' },
  { id: 'r32x25', label: '32 × 25 มม.', hint: 'สติ๊กเกอร์ม้วนเล็ก' },
  { id: 'r60x40', label: '60 × 40 มม.', hint: 'สติ๊กเกอร์ม้วนใหญ่' },
  { id: 'a4x24', label: 'A4 · 24 ดวง', hint: '3 × 8 (70 × 37 มม.)' },
  { id: 'a4x65', label: 'A4 · 65 ดวง', hint: '5 × 13 (38 × 21 มม.)' },
];

export interface LabelOptions {
  paper: LabelPaper;
  showName: boolean;
  showVariant: boolean;
  showPrice: boolean;
  showShop: boolean;
}
export const DEFAULT_LABEL_OPTIONS: LabelOptions = { paper: 'r50x30', showName: true, showVariant: true, showPrice: true, showShop: false };

const OPT_KEY = 'pos.labelOptions';
export function loadLabelOptions(): LabelOptions {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(OPT_KEY) ?? 'null');
    return v && LABEL_PAPERS.some((p) => p.id === v.paper) ? { ...DEFAULT_LABEL_OPTIONS, ...v } : DEFAULT_LABEL_OPTIONS;
  } catch {
    return DEFAULT_LABEL_OPTIONS;
  }
}
export function saveLabelOptions(o: LabelOptions) {
  try {
    globalThis.localStorage?.setItem(OPT_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** ความกว้างแท่งบาร์โค้ดตามตั้งค่าร้าน (EAN-13 เมื่อรหัสถูกต้อง ไม่งั้น Code 128) */
export function barcodeWidths(code: string): number[] | null {
  const sym = getAppSettings().barcode.symbology;
  return (sym === 'ean13' && ean13(code)) || code128(code);
}

function barsSvg(code: string) {
  const w = barcodeWidths(code);
  if (!w) return '<div class="bad">รหัสมีตัวอักษรที่พิมพ์เป็นบาร์โค้ดไม่ได้</div>';
  const quiet = 8;
  let x = quiet;
  const bars: string[] = [];
  w.forEach((n, i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${n}" height="40"/>`);
    x += n;
  });
  return `<svg class="bars" viewBox="0 0 ${x + quiet} 40" preserveAspectRatio="none">${bars.join('')}</svg>`;
}

/** ขนาดดวง (มม.) + การจัดหน้า */
interface Layout { w: number; h: number; sheet: boolean; fs: number; cols?: number; rows?: number; top?: number; left?: number; gapX?: number }
function layout(paper: LabelPaper): Layout {
  switch (paper) {
    case 'r40x30': return { w: 40, h: 30, sheet: false, fs: 7 };
    case 'r32x25': return { w: 32, h: 25, sheet: false, fs: 6 };
    case 'r60x40': return { w: 60, h: 40, sheet: false, fs: 9 };
    case 'a4x24': return { w: 70, h: 37.1, sheet: true, cols: 3, rows: 8, fs: 9 };
    case 'a4x65': return { w: 38.1, h: 21.2, sheet: true, cols: 5, rows: 13, fs: 6, top: 10.7, left: 4.7, gapX: 2.5 };
    default: return { w: 50, h: 30, sheet: false, fs: 8 };
  }
}

/** ขยายรายการตามจำนวนดวงของแต่ละ SKU */
export function expandLabels(items: LabelItem[], copies: Map<string, number>) {
  const out: LabelItem[] = [];
  for (const it of items) for (let i = 0; i < (copies.get(it.key) ?? 0); i++) out.push(it);
  return out;
}

/** แบ่งป้ายเป็นแผ่น A4 */
const sheets = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** เปิดหน้าพิมพ์ป้ายบาร์โค้ด (ต้องเรียกจากการกดปุ่มโดยตรง ไม่งั้นเบราว์เซอร์บล็อกหน้าต่างใหม่) */
export function printLabels(labels: LabelItem[], o: LabelOptions) {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !labels.length) return false;
  const w = window.open('', '_blank', 'width=760,height=900');
  if (!w) return false;
  const L = layout(o.paper);
  const shop = getAppSettings().shop.name;
  const price = (n: number) => `฿${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const one = (it: LabelItem) => `<div class="lbl">
    ${o.showShop && shop ? `<div class="shop">${esc(shop)}</div>` : ''}
    ${o.showName ? `<div class="name">${esc(it.name)}</div>` : ''}
    ${o.showVariant || o.showPrice ? `<div class="meta"><span>${o.showVariant ? esc(it.variant) : ''}</span>${o.showPrice ? `<b>${price(it.price)}</b>` : ''}</div>` : ''}
    <div class="code-wrap">${barsSvg(it.code)}</div>
    <div class="code">${esc(it.code)}</div>
  </div>`;

  const page = L.sheet
    ? `@page { size: A4; margin: 0 } .sheet { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; display: grid; align-content: start; grid-template-columns: repeat(${L.cols}, ${L.w}mm); grid-auto-rows: ${L.h}mm; column-gap: ${L.gapX ?? 0}mm; padding: ${L.top ?? 0}mm 0 0 ${L.left ?? 0}mm; }`
    : `@page { size: ${L.w}mm ${L.h}mm; margin: 0 } .lbl { page-break-after: always; break-after: page; } .lbl:last-child { page-break-after: auto; break-after: auto; }`;

  const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>พิมพ์บาร์โค้ด ${labels.length} ดวง</title>
<style>
  ${page}
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { background: #fff; color: #000; font-family: 'Sarabun', 'Tahoma', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .lbl { width: ${L.w}mm; height: ${L.h}mm; padding: 1.2mm 1.6mm; display: flex; flex-direction: column; overflow: hidden; font-size: ${L.fs}pt; line-height: 1.15 }
  .shop { font-size: ${L.fs - 1}pt; text-align: center; font-weight: 700 }
  .name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center }
  .meta { display: flex; justify-content: space-between; gap: 2mm; white-space: nowrap }
  .meta span { overflow: hidden; text-overflow: ellipsis }
  .code-wrap { flex: 1 1 0; min-height: 0; position: relative; margin-top: .6mm }
  .bars { position: absolute; inset: 0; width: 100%; height: 100% }
  .code { margin-top: .4mm; text-align: center; font-family: 'Consolas', 'Courier New', monospace; font-size: ${L.fs}pt; letter-spacing: .5px }
  .bad { font-size: ${L.fs - 1}pt; color: #c00; margin: auto; text-align: center }
  @media screen {
    body { background: #e9edf3; padding: 16px }
    .lbl { background: #fff; outline: 1px dashed #b8c2d0; margin: 0 auto 8px }
    .sheet { background: #fff; margin: 0 auto 16px; box-shadow: 0 2px 10px rgba(0,0,0,.15) }
    .sheet .lbl { margin: 0 }
    .bar { position: sticky; top: 0; background: #1b1f27; color: #fff; padding: 10px 14px; border-radius: 10px; margin: 0 auto 14px; max-width: 520px; display: flex; gap: 10px; align-items: center; font: 14px Tahoma, sans-serif }
    .bar button { margin-left: auto; background: #2f6bff; color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font: 600 14px Tahoma, sans-serif; cursor: pointer }
  }
  @media print { .bar { display: none } }
</style></head><body>
<div class="bar">ป้ายบาร์โค้ด ${labels.length} ดวง · ${esc(LABEL_PAPERS.find((p) => p.id === o.paper)?.label ?? '')} — ในหน้าต่างพิมพ์ เลือก<b>เครื่องพิมพ์ป้าย</b> และขนาดกระดาษให้ตรง<button onclick="window.print()">พิมพ์</button></div>
${L.sheet ? sheets(labels, (L.cols ?? 1) * (L.rows ?? 1)).map((g) => `<div class="sheet">${g.map(one).join('')}</div>`).join('') : labels.map(one).join('')}
<script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body></html>`;
  w.document.open();
  w.document.write(doc);
  w.document.close();
  return true;
}
