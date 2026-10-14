// แบบร่างสินค้าในหน้าแก้ไข — ตัวเลือกมี id คงที่ เพื่อให้ "เปลี่ยนชื่อสี/ไซซ์" แล้ว SKU เดิม (ราคา/จำนวน) ไม่หาย
import type { AttrType, EditVariant, ProductFull } from './types';
import { getAppSettings } from './appSettings';

export const MAX_SKU = 200;
export const MAX_ATTRS = 3;

export interface DOption { id: string; value: string; hex?: string; /** ผู้ใช้เลือกสีเอง → ไม่เดาสีทับ */ picked?: boolean }
export interface DAttr { id: string; type: AttrType; name: string; options: DOption[] }
export interface DRow {
  /** key = id ตัวเลือกของแต่ละคุณสมบัติต่อกัน เช่น "o1|o5|o9" ('' = ไม่มีคุณสมบัติ) */
  key: string;
  id?: number;
  sku: string;
  /** บาร์โค้ด (กำหนดเอง) — แก้ได้ที่หน้า สต็อกสินค้า (คุณสมบัติ) */
  barcode?: string | null;
  cost: string;
  price: string;
  stock: string;
  stockBase?: number;
  active: boolean;
}
export interface Draft {
  id: number | null;
  /** รหัสสินค้า */
  code: string;
  name: string;
  categoryId: string;
  barcode: string;
  imageUrl: string | null;
  art: string;
  tint: string;
  active: boolean;
  lowStock: number;
  note: string;
  attrs: DAttr[];
  rows: DRow[];
}

let seq = 0;
export const uid = () => `o${Date.now().toString(36)}${(seq++).toString(36)}`;

export const ATTR_PRESETS: Record<AttrType, string> = { color: 'สี', size: 'ไซซ์', custom: 'ดีไซน์' };
export const COLOR_SWATCHES = [
  '#F4F4F2', '#232326', '#9AA0A8', '#24345C', '#4F6D96', '#9CC3E6', '#C8443E', '#EBB3C2',
  '#D9C6A5', '#EFE6D2', '#8A5A3B', '#6B7444', '#A9B99C', '#D5A23B', '#7A4FE0', '#16946A',
];
/** เดาสีจากชื่อที่พิมพ์ (ช่วยตั้งจุดสีอัตโนมัติ) */
const COLOR_NAMES: [RegExp, string][] = [
  [/^(ขาว|white|ออฟไวท์|off ?white)/i, '#F4F4F2'], [/^(ดำ|black)/i, '#232326'], [/^(เทา|grey|gray)/i, '#9AA0A8'],
  [/^(กรม|navy)/i, '#24345C'], [/^(ฟ้า|sky|light ?blue)/i, '#9CC3E6'], [/^(น้ำเงิน|blue|ยีนส์|denim)/i, '#4F6D96'],
  [/^(แดง|red)/i, '#C8443E'], [/^(ชมพู|pink)/i, '#EBB3C2'], [/^(เบจ|beige|ครีม|cream)/i, '#EFE6D2'],
  [/^(กากี|khaki|ทราย|sand)/i, '#D9C6A5'], [/^(น้ำตาล|brown)/i, '#8A5A3B'], [/^(เขียวขี้ม้า|olive|army)/i, '#6B7444'],
  [/^(เขียว|green)/i, '#16946A'], [/^(มิ้นท์|mint|sage)/i, '#A9B99C'], [/^(เหลือง|มัสตาร์ด|yellow|mustard)/i, '#D5A23B'],
  [/^(ม่วง|purple)/i, '#7A4FE0'],
];
export const guessHex = (name: string) => COLOR_NAMES.find(([re]) => re.test(name.trim()))?.[1];

export const SIZE_PRESETS: { label: string; values: string[] }[] = [
  { label: 'S–2XL', values: ['S', 'M', 'L', 'XL', '2XL'] },
  { label: 'XS–XL', values: ['XS', 'S', 'M', 'L', 'XL'] },
  { label: 'เอว 28–36', values: ['28', '30', '32', '34', '36'] },
  { label: 'Free Size', values: ['FREE'] },
];

const field = (t: AttrType) => (t === 'color' ? 'color' : t === 'size' ? 'size' : 'extra') as 'color' | 'size' | 'extra';

/** ชุดตัวเลือกทั้งหมด (cartesian product) ตามลำดับคุณสมบัติ */
export function combos(attrs: DAttr[]): DOption[][] {
  return attrs.reduce<DOption[][]>((acc, a) => acc.flatMap((c) => a.options.map((o) => [...c, o])), [[]]);
}
export const comboCount = (attrs: DAttr[]) => attrs.reduce((n, a) => n * Math.max(1, a.options.length), 1);

export function rowLabel(attrs: DAttr[], key: string) {
  if (!key) return 'ปกติ (ไม่มีตัวเลือก)';
  const ids = key.split('|');
  return attrs.map((a, i) => a.options.find((o) => o.id === ids[i])?.value.trim() || '(ว่าง)').join(' / ');
}

/** สร้างแถว SKU ใหม่ตามคุณสมบัติ — แถวเดิมที่ key ตรงกันคงค่าไว้ */
export function syncRows(attrs: DAttr[], rows: DRow[], defaults: { cost: string; price: string }): DRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const list = combos(attrs).slice(0, MAX_SKU);
  return list.map((c) => {
    const key = c.map((o) => o.id).join('|');
    return byKey.get(key) ?? { key, sku: '', cost: defaults.cost, price: defaults.price, stock: '0', active: true };
  });
}

/** เมื่อเพิ่ม/ลบคุณสมบัติ ลำดับ id ใน key เปลี่ยน → จับคู่แถวเดิมด้วย "ชุดตัวเลือกที่เหมือนกัน" */
export function remapRows(oldAttrs: DAttr[], newAttrs: DAttr[], rows: DRow[]): DRow[] {
  const sameShape = oldAttrs.length === newAttrs.length && oldAttrs.every((a, i) => a.id === newAttrs[i].id);
  if (sameShape) return rows;
  const out: DRow[] = [];
  for (const r of rows) {
    const ids = r.key ? r.key.split('|') : [];
    const map = new Map(oldAttrs.map((a, i) => [a.id, ids[i]]));
    const newIds = newAttrs.map((a) => map.get(a.id) ?? a.options[0]?.id);
    if (newIds.some((x) => !x)) continue;
    const key = newIds.join('|');
    if (!out.some((o) => o.key === key)) out.push({ ...r, key });
  }
  return out;
}

export function emptyDraft(categoryId: string): Draft {
  return {
    id: null, code: '', name: '', categoryId, barcode: '', imageUrl: null, art: 'tshirt', tint: '#E8EEF9', active: true,
    lowStock: getAppSettings().stock.lowStockDefault, note: '', attrs: [], rows: [{ key: '', sku: '', cost: '0', price: '', stock: '0', active: true }],
  };
}

/** แปลงข้อมูลจาก server → แบบร่าง */
export function toDraft(p: ProductFull): Draft {
  const attrs: DAttr[] = p.attrs.map((a) => ({ id: uid(), type: a.type, name: a.name, options: a.options.map((o) => ({ id: uid(), value: o.value, hex: o.hex, picked: true })) }));
  const rows: DRow[] = p.variants.map((v) => {
    const ids = attrs.map((a) => a.options.find((o) => o.value === v[field(a.type)])?.id ?? '');
    return {
      key: ids.join('|'), id: v.id, sku: v.sku, barcode: v.barcode ?? null, cost: String(v.cost ?? 0), price: String(v.price), stock: String(v.stock),
      stockBase: v.stock, active: v.active,
    };
  });
  return {
    id: p.id, code: p.sku, name: p.name, categoryId: p.categoryId, barcode: p.barcode ?? '', imageUrl: p.imageUrl, art: p.art, tint: p.tint,
    active: p.active, lowStock: p.lowStock, note: p.note ?? '', attrs, rows: syncRows(attrs, rows, { cost: '0', price: rows[0]?.price ?? '' }),
  };
}

/** แบบร่าง → ข้อมูลส่งให้ server */
export function fromDraft(d: Draft) {
  const variants: EditVariant[] = d.rows.map((r) => {
    const ids = r.key ? r.key.split('|') : [];
    const v: EditVariant = {
      id: r.id, sku: r.sku.trim(), barcode: r.barcode, color: '-', size: '-', extra: '', cost: Number(r.cost) || 0, price: Number(r.price),
      // ยอดเดิมที่ติดลบ (ขายได้แม้สต็อกหมด) ส่งกลับตามเดิม → ไม่ถูกปัดเป็น 0 ตอนบันทึกสินค้า
      stock: Number(r.stock) === r.stockBase ? r.stockBase! : Math.max(0, Math.floor(Number(r.stock) || 0)), stockBase: r.stockBase, active: r.active,
    };
    d.attrs.forEach((a, i) => {
      const o = a.options.find((x) => x.id === ids[i]);
      if (o) (v as unknown as Record<string, string>)[field(a.type)] = o.value;
    });
    return v;
  });
  return {
    code: d.code.trim(), name: d.name.trim(), categoryId: d.categoryId, barcode: d.barcode.trim(), imageUrl: d.imageUrl, art: d.art, tint: d.tint,
    active: d.active, lowStock: d.lowStock, note: d.note,
    attrs: d.attrs.map((a) => ({ type: a.type, name: a.name.trim(), options: a.options.map((o) => ({ value: o.value.trim(), hex: o.hex })) })),
    variants,
  };
}

/** ตรวจความถูกต้องฝั่งหน้าเว็บ (ข้อความแรกที่เจอ) */
export function validate(d: Draft): string | null {
  if (d.code.trim() && !/^[0-9A-Za-z\-_.]+$/.test(d.code.trim())) return 'รหัสสินค้าใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .';
  if (!d.name.trim()) return 'กรุณาระบุชื่อสินค้า';
  if (!d.categoryId) return 'กรุณาเลือกหมวดหมู่';
  for (const a of d.attrs) {
    if (!a.name.trim()) return 'กรุณาตั้งชื่อคุณสมบัติ';
    if (a.options.length === 0) return `กรุณาเพิ่มตัวเลือกของ "${a.name}"`;
    const vals = a.options.map((o) => o.value.trim());
    if (vals.some((v) => !v)) return `มีตัวเลือกของ "${a.name}" ที่ยังว่างอยู่`;
    if (new Set(vals).size !== vals.length) return `ตัวเลือกของ "${a.name}" ซ้ำกัน`;
  }
  if (comboCount(d.attrs) > MAX_SKU) return `SKU ได้สูงสุด ${MAX_SKU} รายการ (ตอนนี้ ${comboCount(d.attrs)})`;
  for (const r of d.rows) {
    const label = rowLabel(d.attrs, r.key);
    if (r.price.trim() === '' || !(Number(r.price) >= 0)) return `กรุณาระบุราคาขายของ ${label}`;
    if (!(Number(r.cost || 0) >= 0)) return `ต้นทุนของ ${label} ไม่ถูกต้อง`;
    if (!Number.isInteger(Number(r.stock || 0)) || Number(r.stock) < 0) return `จำนวนของ ${label} ต้องเป็นจำนวนเต็ม 0 ขึ้นไป`;
  }
  return null;
}

/** บาร์โค้ด EAN-13 สำหรับใช้ภายในร้าน (ขึ้นต้นด้วย 2) */
export function randomBarcode() {
  const d = [2, ...Array.from({ length: 11 }, () => Math.floor(Math.random() * 10))];
  const sum = d.reduce((a, n, i) => a + n * (i % 2 === 0 ? 1 : 3), 0);
  return d.join('') + ((10 - (sum % 10)) % 10);
}
