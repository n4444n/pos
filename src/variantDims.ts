import type { Product, Variant } from './types';

/** มิติของตัวเลือกสินค้า: สี / ไซซ์ / คุณสมบัติที่ 3 */
export type DimKey = 'color' | 'size' | 'extra';
export interface Dim {
  key: DimKey;
  name: string;
  isColor: boolean;
  options: { value: string; hex?: string }[];
}
export type DimPick = Partial<Record<DimKey, string | null>>;

export const valueOf = (v: Variant, k: DimKey) => (k === 'extra' ? v.extra : v[k]);

/** สร้างรายการมิติจากสินค้า (ลำดับตามที่ตั้งไว้ในหน้าสต็อก) — ข้ามมิติที่ไม่ได้ใช้ */
export function dimsOf(product: Product, variants: Variant[]): Dim[] {
  const order: { key: DimKey; name: string }[] = [];
  for (const a of product.attrs ?? []) {
    order.push({ key: a.type === 'color' ? 'color' : a.type === 'size' ? 'size' : 'extra', name: a.name });
  }
  for (const k of ['size', 'color', 'extra'] as DimKey[]) {
    if (!order.some((o) => o.key === k)) order.push({ key: k, name: k === 'color' ? 'สี' : k === 'size' ? 'ไซซ์' : 'แบบ' });
  }
  const dims: Dim[] = [];
  for (const o of order) {
    const m = new Map<string, { value: string; hex?: string }>();
    for (const v of variants) {
      const val = valueOf(v, o.key);
      if (!val || val === '-') continue;
      if (!m.has(val)) m.set(val, o.key === 'color' ? { value: val, hex: v.colorHex } : { value: val });
    }
    if (m.size > 0) dims.push({ key: o.key, name: o.name, isColor: o.key === 'color', options: [...m.values()] });
  }
  return dims;
}

/** หา SKU ที่ตรงกับตัวเลือกที่เลือกครบทุกมิติ */
export function findVariant(variants: Variant[], dims: Dim[], pick: DimPick) {
  if (dims.some((d) => !pick[d.key])) return dims.length === 0 ? variants[0] : undefined;
  return variants.find((v) => dims.every((d) => valueOf(v, d.key) === pick[d.key]));
}

/** ค่า val ของมิติ d ยังมีของไหม (ดูเฉพาะมิติอื่นที่เลือกไว้แล้ว) */
export function optionAvailable(variants: Variant[], dims: Dim[], pick: DimPick, d: Dim, val: string, left: (v: Variant) => number) {
  return variants.some(
    (v) => valueOf(v, d.key) === val && dims.every((o) => o.key === d.key || !pick[o.key] || valueOf(v, o.key) === pick[o.key]) && left(v) > 0,
  );
}

/** มิติที่มีตัวเลือกเดียว → เลือกให้อัตโนมัติ */
export function autoPick(dims: Dim[]): DimPick {
  const p: DimPick = {};
  for (const d of dims) if (d.options.length === 1) p[d.key] = d.options[0].value;
  return p;
}
