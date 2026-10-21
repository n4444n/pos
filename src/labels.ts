// พิมพ์ป้ายบาร์โค้ดสินค้า (สติ๊กเกอร์ม้วน / กระดาษ A4) ตามโปรไฟล์ใน ตั้งค่า → กระดาษบาร์โค้ด
// เปิดหน้าต่างพิมพ์ของระบบ ให้เลือกเครื่องพิมพ์ป้ายเอง (ป้ายมักใช้เครื่องพิมพ์คนละตัวกับใบเสร็จ)
import { Platform } from 'react-native';
import { DEFAULT_LABEL_PROFILE, getAppSettings, type LabelProfile } from './appSettings';
import { encodeBarcode, SYMBOLOGIES, type Symbology } from './barcodeEncode';
import { desktop, type LabelPrinterConfig, type PrinterResult } from './desktop';

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

/** ตัวอย่างสินค้าสำหรับดูตัวอย่างป้าย */
export const SAMPLE_LABEL: LabelItem = { key: 'sample', name: 'เข็มขัดหนัง', variant: 'น้ำตาล / 90', code: 'AC-004-BROWN-90', price: 590, stock: 1 };

/** ขนาดกระดาษสำเร็จรูป (กดแล้วกรอกขนาด/จำนวนดวงให้) */
export const LABEL_PRESETS: { id: string; label: string; hint: string; apply: Partial<LabelProfile> }[] = [
  { id: 'r30x20', label: '30 × 20 มม.', hint: 'ม้วน · 1 ดวง/แถว', apply: { paper: 'roll', width: 30, height: 20, cols: 1, rows: 1, gapX: 2, marginLeft: 0, marginTop: 0, padding: 0.8, barHeight: 7, nameSize: 6, codeSize: 6, priceSize: 6 } },
  { id: 'r32x25', label: '32 × 25 มม.', hint: 'ม้วน · 1 ดวง/แถว', apply: { paper: 'roll', width: 32, height: 25, cols: 1, rows: 1, gapX: 2, marginLeft: 0, marginTop: 0, padding: 1, barHeight: 9, nameSize: 6, codeSize: 6, priceSize: 6 } },
  { id: 'r40x30', label: '40 × 30 มม.', hint: 'ม้วน · 1 ดวง/แถว', apply: { paper: 'roll', width: 40, height: 30, cols: 1, rows: 1, gapX: 2, marginLeft: 0, marginTop: 0, padding: 1.2, barHeight: 10, nameSize: 7, codeSize: 7, priceSize: 7 } },
  { id: 'r50x30old', label: '50 × 30 แบบเดิม', hint: 'ชื่อ+สีไซซ์ · รหัสตัวหนา · ราคาล่าง', apply: { paper: 'roll', width: 50, height: 30, cols: 1, rows: 1, gapX: 2, marginLeft: 0, marginTop: 0, padding: 1.2, layout: 'classic', align: 'center', bold: false, italic: false, showName: true, showVariant: true, showPrice: true, showCode: true, barHeight: 8, barWidth: 70, barModule: 0, textGap: 0.3, nameGap: 1, nameSize: 8, codeSize: 7, priceSize: 10 } },
  { id: 'r50x30', label: '50 × 30 มม.', hint: 'ม้วน · 1 ดวง/แถว (นิยม)', apply: { paper: 'roll', width: 50, height: 30, cols: 1, rows: 1, gapX: 2, marginLeft: 0, marginTop: 0, padding: 1.2, barHeight: 10, nameSize: 8, codeSize: 8, priceSize: 8 } },
  { id: 'r60x40', label: '60 × 40 มม.', hint: 'ม้วน · 1 ดวง/แถว', apply: { paper: 'roll', width: 60, height: 40, cols: 1, rows: 1, gapX: 2, marginLeft: 0, marginTop: 0, padding: 1.5, barHeight: 14, nameSize: 9, codeSize: 9, priceSize: 10 } },
  { id: 'r33x25x3', label: '33 × 25 มม. × 3', hint: 'ม้วน 105 มม. · 3 ดวง/แถว', apply: { paper: 'roll', width: 33, height: 25, cols: 3, rows: 1, gapX: 2, marginLeft: 1, marginTop: 0, padding: 1, barHeight: 9, nameSize: 6, codeSize: 6, priceSize: 6 } },
  { id: 'r50x30x2', label: '50 × 30 มม. × 2', hint: 'ม้วน 104 มม. · 2 ดวง/แถว', apply: { paper: 'roll', width: 50, height: 30, cols: 2, rows: 1, gapX: 2, marginLeft: 1, marginTop: 0, padding: 1.2, barHeight: 10, nameSize: 8, codeSize: 8, priceSize: 8 } },
  { id: 'a4x24', label: 'A4 · 24 ดวง', hint: '3 × 8 (70 × 37 มม.)', apply: { paper: 'a4', width: 70, height: 37.1, cols: 3, rows: 8, gapX: 0, gapY: 0, marginLeft: 0, marginTop: 0, padding: 2, barHeight: 12, nameSize: 9, codeSize: 9, priceSize: 9 } },
  { id: 'a4x65', label: 'A4 · 65 ดวง', hint: '5 × 13 (38 × 21 มม.)', apply: { paper: 'a4', width: 38.1, height: 21.2, cols: 5, rows: 13, gapX: 2.5, gapY: 0, marginLeft: 4.7, marginTop: 10.7, padding: 1, barHeight: 7, nameSize: 6, codeSize: 6, priceSize: 6 } },
];

/** ขนาดโดยย่อ เช่น "50×30 มม. · 2 ดวง/แถว" */
export const profileSummary = (p: LabelProfile) =>
  p.paper === 'a4' ? `A4 · ${p.cols}×${p.rows} (${p.width}×${p.height} มม.)` : `${p.width}×${p.height} มม. · ${p.cols} ดวง/แถว`;

/** โปรไฟล์ทั้งหมดของร้าน (อย่างน้อย 1) */
export function labelProfiles(): LabelProfile[] {
  const list = getAppSettings().barcode.labelProfiles;
  return list?.length ? list : [DEFAULT_LABEL_PROFILE];
}
const LAST_KEY = 'pos.labelProfile';
/** โปรไฟล์ที่ใช้ล่าสุดบนเครื่องนี้ → ไม่มี = ค่าเริ่มต้นของร้าน */
export function lastLabelProfile(): LabelProfile {
  const list = labelProfiles();
  let id = '';
  try {
    id = globalThis.localStorage?.getItem(LAST_KEY) ?? '';
  } catch {
    /* ignore */
  }
  return list.find((p) => p.id === id) ?? list.find((p) => p.id === getAppSettings().barcode.labelProfile) ?? list[0];
}
export function rememberLabelProfile(id: string) {
  try {
    globalThis.localStorage?.setItem(LAST_KEY, id);
  } catch {
    /* ignore */
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** ประเภทที่ใช้จริง: auto = ตามเมนู บาร์โค้ด ของร้าน */
export const resolveSymbology = (sym: Symbology = 'auto'): Exclude<Symbology, 'auto'> =>
  sym === 'auto' ? (getAppSettings().barcode.symbology === 'ean13' ? 'ean13' : 'code128') : sym;

/** ความกว้างแท่งบาร์โค้ด (รหัสที่ใช้กับประเภทที่เลือกไม่ได้ → Code 128 อัตโนมัติ) */
export function barcodeWidths(code: string, symbology: Symbology = 'auto'): number[] | null {
  return encodeBarcode(code, resolveSymbology(symbology))?.widths ?? null;
}

/** ชื่อประเภทบาร์โค้ด (ไว้แสดงในหน้าตั้งค่า) */
export const symbologyLabel = (sym: Exclude<Symbology, 'auto'>) => SYMBOLOGIES.find((x) => x.id === sym)?.label ?? sym;

/** ช่องว่างหัว-ท้ายบาร์โค้ด (หน่วยแท่งแคบ) ให้เครื่องสแกนจับขอบได้ */
const QUIET = 8;

/** แท่งบาร์โค้ด (SVG) + ความกว้างรวมเป็นหน่วยแท่งแคบ */
function barsSvg(code: string, sym: Symbology): { svg: string; modules: number } {
  const w = barcodeWidths(code, sym);
  if (!w) return { svg: '<div class="bad">รหัสมีตัวอักษรที่พิมพ์เป็นบาร์โค้ดไม่ได้</div>', modules: 0 };
  let x = QUIET;
  const bars: string[] = [];
  w.forEach((n, i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${n}" height="40"/>`);
    x += n;
  });
  const total = x + QUIET;
  return { svg: `<svg class="bars" viewBox="0 0 ${total} 40" preserveAspectRatio="none" shape-rendering="crispEdges">${bars.join('')}</svg>`, modules: total };
}

/** ขยายรายการตามจำนวนดวงของแต่ละ SKU */
export function expandLabels(items: LabelItem[], copies: Map<string, number>) {
  const out: LabelItem[] = [];
  for (const it of items) for (let i = 0; i < (copies.get(it.key) ?? 0); i++) out.push(it);
  return out;
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const price = (n: number) => `฿${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** CSS ของป้าย (ใช้ทั้งพิมพ์จริงและตัวอย่าง) */
function labelCss(p: LabelProfile) {
  const just = p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center';
  const rowW = p.marginLeft + p.cols * p.width + (p.cols - 1) * p.gapX;
  const page =
    p.paper === 'a4'
      ? `@page { size: A4; margin: 0 }
         .sheet { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; display: grid; align-content: start;
           grid-template-columns: repeat(${p.cols}, ${p.width}mm); grid-auto-rows: ${p.height}mm; column-gap: ${p.gapX}mm; row-gap: ${p.gapY}mm;
           padding: ${p.marginTop}mm 0 0 ${p.marginLeft}mm }
         .sheet:last-child { page-break-after: auto; break-after: auto }`
      : `@page { size: ${rowW}mm ${p.height}mm; margin: 0 }
         .row { width: ${rowW}mm; height: ${p.height}mm; display: flex; gap: ${p.gapX}mm; padding: ${p.marginTop}mm 0 0 ${p.marginLeft}mm; overflow: hidden; page-break-after: always; break-after: page }
         .row:last-child { page-break-after: auto; break-after: auto }`;
  const tw = `${p.bold ? 'font-weight: 700;' : ''}${p.italic ? 'font-style: italic;' : ''}`;
  return `${page}
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { background: #fff; color: #000; font-family: 'Sarabun', 'Tahoma', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .lbl { width: ${p.width}mm; height: ${p.height}mm; padding: ${p.padding}mm; display: flex; flex-direction: column; justify-content: center; overflow: hidden; line-height: 1.15; text-align: ${p.align}; flex: none }
  /* ชื่อยาว/ตัวใหญ่ → ขึ้นบรรทัดใหม่ (สูงสุด 2 บรรทัด) แทนการตัดเป็น … */
  .shop { font-size: ${Math.max(4, p.nameSize - 1)}pt; ${tw} white-space: normal; overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; flex: none }
  .name { font-size: ${p.nameSize}pt; ${tw} white-space: normal; overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; flex: none }
  .meta { display: flex; justify-content: ${just}; gap: 2mm; white-space: nowrap; font-size: ${p.nameSize}pt }
  .meta.both { justify-content: space-between }
  .meta span { overflow: hidden; text-overflow: ellipsis; ${p.italic ? 'font-style: italic;' : ''} }
  .meta b { font-size: ${p.priceSize}pt; ${p.italic ? 'font-style: italic;' : ''} ${p.bold ? '' : 'font-weight: 400;'} }
  .code-wrap { height: ${p.barHeight}mm; width: ${p.barWidth}%; flex: none; margin: ${p.nameGap ?? 0.5}mm 0 0; align-self: ${just}; position: relative }
  .bars { position: absolute; inset: 0; width: 100%; height: 100% }
  .code { margin-top: ${p.textGap}mm; font-family: 'Consolas', 'Courier New', monospace; font-size: ${p.codeSize}pt; letter-spacing: .4px; white-space: nowrap; overflow: hidden }
  .bad { font-size: ${Math.max(4, p.codeSize - 1)}pt; color: #c00; text-align: center }
  /* แบบเดิม: รหัสตัวหนาใต้บาร์โค้ด ราคาอยู่ล่างสุด */
  .classic .code { font-weight: 700 }
  .classic .price { margin-top: .3mm; font-size: ${p.priceSize}pt; ${tw} white-space: nowrap }`;
}

function oneLabel(it: LabelItem, p: LabelProfile, shop: string) {
  const meta = p.showVariant || p.showPrice;
  const bc = barsSvg(it.code, p.symbology);
  // ความหนาแท่งคงที่: กว้าง = จำนวนแท่ง × ความหนา (ไม่เกินความกว้างในดวง) · ไม่งั้นยืดตาม % ที่ตั้งไว้
  const inner = Math.max(1, p.width - p.padding * 2);
  const fixedW = p.barModule > 0 && bc.modules ? Math.min(inner, bc.modules * p.barModule) : 0;
  const bars = `<div class="code-wrap"${fixedW ? ` style="width:${Math.round(fixedW * 100) / 100}mm"` : ''}>${bc.svg}</div>`;
  const code = p.showCode ? `<div class="code">${esc(it.code)}</div>` : '';
  const shopLine = p.showShop && shop ? `<div class="shop">${esc(shop)}</div>` : '';
  if (p.layout === 'compact') return `<div class="lbl">${bars}${code}</div>`;
  if (p.layout === 'classic') {
    // ชื่อ สี / ไซซ์ เช่น "T-SHIRT Black / 2XL" (สินค้าไม่มีตัวเลือก "ปกติ" → แสดงแค่ชื่อ)
    const v = it.variant.trim();
    const title = [p.showName ? it.name : '', p.showVariant && v && v !== 'ปกติ' ? v.replace(/\s*\/\s*/g, ' / ') : ''].filter(Boolean).join(' ');
    return `<div class="lbl classic">
    ${shopLine}
    ${title ? `<div class="name">${esc(title)}</div>` : ''}
    ${bars}${code}
    ${p.showPrice ? `<div class="price">${price(it.price)}</div>` : ''}
  </div>`;
  }
  return `<div class="lbl">
    ${shopLine}
    ${p.showName ? `<div class="name">${esc(it.name)}</div>` : ''}
    ${meta ? `<div class="meta${p.showVariant && p.showPrice ? ' both' : ''}">${p.showVariant ? `<span>${esc(it.variant)}</span>` : ''}${p.showPrice ? `<b>${price(it.price)}</b>` : ''}</div>` : ''}
    ${bars}${code}
  </div>`;
}

function labelBody(labels: LabelItem[], p: LabelProfile) {
  const shop = getAppSettings().shop.name;
  return p.paper === 'a4'
    ? chunk(labels, Math.max(1, p.cols * p.rows)).map((g) => `<div class="sheet">${g.map((it) => oneLabel(it, p, shop)).join('')}</div>`).join('')
    : chunk(labels, Math.max(1, p.cols)).map((g) => `<div class="row">${g.map((it) => oneLabel(it, p, shop)).join('')}</div>`).join('');
}

/** หน้าตัวอย่างป้าย (ใส่ใน iframe ของหน้าตั้งค่า) — แสดง 1 แถว (ม้วน) หรือ 2 แถวแรก (A4) ขยายให้เห็นชัด */
export function labelPreviewHtml(p: LabelProfile, sample: LabelItem = SAMPLE_LABEL, zoom = 2) {
  const n = p.paper === 'a4' ? p.cols * Math.min(2, p.rows) : p.cols;
  const items = Array.from({ length: n }, () => sample);
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
  ${labelCss(p)}
  html, body { background: transparent }
  body { padding: 10px; display: flex; justify-content: center }
  .zoom { zoom: ${zoom} }
  .row, .sheet { background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.18) }
  .sheet { height: auto; padding-bottom: 2mm }
  .lbl { outline: 1px dashed #9aa6b8 }
</style></head><body><div class="zoom">${labelBody(items, p)}</div></body></html>`;
}

/** ขนาดกระดาษ 1 หน้า (มม.) ตามโปรไฟล์ — ม้วน: 1 แถวต่อหน้า · A4: 210×297 */
export function labelPageSize(p: LabelProfile) {
  if (p.paper === 'a4') return { width: 210, height: 297 };
  return { width: p.marginLeft + p.cols * p.width + (p.cols - 1) * p.gapX, height: p.height };
}

/** เอกสารสำหรับส่งเข้าเครื่องพิมพ์บาร์โค้ดโดยตรง (ไม่มีแถบคำแนะนำ / ไม่สั่งพิมพ์เอง) */
function labelPrintDoc(labels: LabelItem[], p: LabelProfile) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ป้ายบาร์โค้ด</title><style>${labelCss(p)}</style></head><body>${labelBody(labels, p)}</body></html>`;
}

/**
 * พิมพ์ป้ายบาร์โค้ด
 * - แอป Clothing POS ที่รองรับ: ส่งตรงเข้า "เครื่องพิมพ์บาร์โค้ด" ที่ตั้งไว้ (ตั้งค่า → ตั้งค่าเครื่องพิมพ์บาร์โค้ด) แยกจากเครื่องพิมพ์ใบเสร็จ
 * - เบราว์เซอร์ / แอปรุ่นเก่า: เปิดหน้าพิมพ์ให้เลือกเครื่องพิมพ์ป้ายเอง (ต้องเรียกจากการกดปุ่มโดยตรง ไม่งั้นเบราว์เซอร์บล็อกหน้าต่างใหม่)
 * cfg = ค่าเครื่องพิมพ์บาร์โค้ดที่ยังไม่บันทึก (ปุ่มทดสอบพิมพ์ในหน้าตั้งค่า)
 */
export function printLabels(labels: LabelItem[], p: LabelProfile, cfg?: Partial<LabelPrinterConfig>, onResult?: (r: PrinterResult) => void) {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !labels.length) return false;
  const direct = desktop()?.labels;
  if (direct) {
    direct.print(labelPrintDoc(labels, p), labelPageSize(p), cfg).then((r) => onResult?.(r), (e) => onResult?.({ ok: false, error: String(e) }));
    return true;
  }
  const w = window.open('', '_blank', 'width=760,height=900');
  if (!w) return false;
  const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>พิมพ์บาร์โค้ด ${labels.length} ดวง</title>
<style>
  ${labelCss(p)}
  @media screen {
    body { background: #e9edf3; padding: 16px }
    .row, .sheet { background: #fff; margin: 0 auto 10px; box-shadow: 0 2px 10px rgba(0,0,0,.12) }
    .lbl { outline: 1px dashed #b8c2d0 }
    .bar { position: sticky; top: 0; background: #1b1f27; color: #fff; padding: 10px 14px; border-radius: 10px; margin: 0 auto 14px; max-width: 560px; display: flex; gap: 10px; align-items: center; font: 14px Tahoma, sans-serif; z-index: 1 }
    .bar button { margin-left: auto; background: #2f6bff; color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font: 600 14px Tahoma, sans-serif; cursor: pointer }
  }
  @media print { .bar { display: none } }
</style></head><body>
<div class="bar">ป้ายบาร์โค้ด ${labels.length} ดวง · ${esc(p.name)} (${esc(profileSummary(p))}) — ในหน้าต่างพิมพ์ เลือก<b>เครื่องพิมพ์บาร์โค้ด</b> ขนาดกระดาษให้ตรง และระยะขอบ: ไม่มี<button onclick="window.print()">พิมพ์</button></div>
${labelBody(labels, p)}
<script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body></html>`;
  w.document.open();
  w.document.write(doc);
  w.document.close();
  return true;
}
