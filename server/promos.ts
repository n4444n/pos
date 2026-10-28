// โปรโมชั่น / ส่วนลด
//   ส่วนลด (discount)  ลด % หรือลดเป็นบาท เมื่อยอดถึงขั้นต่ำ
//   ของแถม (freebie)   ซื้อครบตามยอด แถมสินค้าให้ฟรี (เพิ่มเป็นรายการราคา 0 ในบิล)
// ใช้โค้ด (ลูกค้า/พนักงานกรอก) หรือใช้อัตโนมัติเมื่อยอดถึงเงื่อนไข (auto = 1)
import { db } from './db.ts';
import { HttpError, round2 } from './common.ts';

// ---------- โครงสร้างข้อมูล (ต่อยอดจากตาราง promos เดิมที่มีแต่ส่วนลด) ----------
const cols = new Set((db.prepare('PRAGMA table_info(promos)').all() as { name: string }[]).map((c) => c.name));
const add = (name: string, def: string) => {
  if (!cols.has(name)) db.exec(`ALTER TABLE promos ADD COLUMN ${name} ${def}`);
};
add('kind', "TEXT NOT NULL DEFAULT 'discount'"); // discount | freebie
add('gift_variant_id', 'INTEGER');               // ของแถม: ตัวเลือกสินค้า (variants_all.id)
add('gift_qty', 'INTEGER NOT NULL DEFAULT 1');
add('auto', 'INTEGER NOT NULL DEFAULT 0');       // 1 = ใช้เองเมื่อยอดถึงขั้นต่ำ (ไม่ต้องกรอกโค้ด)
add('starts_at', 'TEXT');                        // YYYY-MM-DD (ว่าง = ไม่จำกัด)
add('ends_at', 'TEXT');
add('note', "TEXT NOT NULL DEFAULT ''");
add('created_at', 'TEXT');

export type PromoKind = 'discount' | 'freebie';
export interface PromoRow {
  code: string;
  label: string;
  kind: PromoKind;
  /** ส่วนลด: percent | amount (ของแถมไม่ใช้) */
  type: 'percent' | 'amount';
  value: number;
  minTotal: number;
  giftVariantId: number | null;
  giftQty: number;
  auto: boolean;
  startsAt: string | null;
  endsAt: string | null;
  note: string;
  active: boolean;
  /** ของแถม: ชื่อสินค้าไว้แสดงผล */
  giftName?: string | null;
  giftStock?: number | null;
}

const SELECT = `
  SELECT p.code, p.label, p.kind, p.type, p.value, p.min_total AS minTotal,
         p.gift_variant_id AS giftVariantId, p.gift_qty AS giftQty, p.auto,
         p.starts_at AS startsAt, p.ends_at AS endsAt, p.note, p.active,
         pr.name AS giftName, v.sku AS giftSku
    FROM promos p
    LEFT JOIN variants_all v ON v.id = p.gift_variant_id
    LEFT JOIN products pr    ON pr.id = v.product_id`;

const row = (r: Record<string, unknown>): PromoRow => ({
  code: String(r.code),
  label: String(r.label),
  kind: (r.kind === 'freebie' ? 'freebie' : 'discount') as PromoKind,
  type: (r.type === 'amount' ? 'amount' : 'percent') as 'percent' | 'amount',
  value: Number(r.value) || 0,
  minTotal: Number(r.minTotal) || 0,
  giftVariantId: r.giftVariantId == null ? null : Number(r.giftVariantId),
  giftQty: Number(r.giftQty) || 1,
  auto: !!r.auto,
  startsAt: (r.startsAt as string) || null,
  endsAt: (r.endsAt as string) || null,
  note: String(r.note ?? ''),
  active: !!r.active,
  giftName: r.giftName ? `${r.giftName}${r.giftSku ? ` · ${r.giftSku}` : ''}` : null,
});

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD ตามเวลาเครื่อง

/** อยู่ในช่วงวันที่ที่กำหนดหรือไม่ */
export const inPeriod = (p: { startsAt: string | null; endsAt: string | null }, d = today()) =>
  (!p.startsAt || p.startsAt <= d) && (!p.endsAt || p.endsAt >= d);

export const listPromos = (): PromoRow[] =>
  (db.prepare(`${SELECT} ORDER BY p.active DESC, p.kind, p.code`).all() as Record<string, unknown>[]).map(row);

export const getPromo = (code: string): PromoRow | undefined => {
  const r = db.prepare(`${SELECT} WHERE p.code = ?`).get(code) as Record<string, unknown> | undefined;
  return r && row(r);
};

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(b: Record<string, unknown>, cur?: PromoRow) {
  const kind: PromoKind = b.kind === 'freebie' ? 'freebie' : 'discount';
  const label = String(b.label ?? cur?.label ?? '').trim().slice(0, 80);
  if (!label) throw new HttpError(422, 'กรุณาตั้งชื่อโปรโมชั่น');
  const minTotal = Math.max(0, Number(b.minTotal ?? cur?.minTotal ?? 0) || 0);
  const date = (v: unknown, old: string | null | undefined) => {
    if (v === undefined) return old ?? null;
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (!DATE_RE.test(s)) throw new HttpError(422, 'วันที่ต้องอยู่ในรูปแบบ ปปปป-ดด-วว');
    return s;
  };
  const startsAt = date(b.startsAt, cur?.startsAt);
  const endsAt = date(b.endsAt, cur?.endsAt);
  if (startsAt && endsAt && startsAt > endsAt) throw new HttpError(422, 'วันเริ่มต้องไม่เกินวันสิ้นสุด');

  let type: 'percent' | 'amount' = b.type === 'amount' ? 'amount' : 'percent';
  let value = Number(b.value ?? cur?.value ?? 0) || 0;
  let giftVariantId: number | null = null;
  let giftQty = 1;

  if (kind === 'freebie') {
    giftVariantId = Number(b.giftVariantId ?? cur?.giftVariantId ?? 0) || 0;
    if (!giftVariantId) throw new HttpError(422, 'กรุณาเลือกสินค้าที่จะแถม');
    if (!db.prepare('SELECT 1 FROM variants_all WHERE id = ?').get(giftVariantId)) throw new HttpError(404, 'ไม่พบสินค้าที่จะแถม');
    giftQty = Math.min(99, Math.max(1, Math.round(Number(b.giftQty ?? cur?.giftQty ?? 1)) || 1));
    if (minTotal <= 0) throw new HttpError(422, 'ของแถมต้องกำหนดยอดซื้อขั้นต่ำ');
    type = 'amount';
    value = 0;
  } else {
    if (!(value > 0)) throw new HttpError(422, 'กรุณาระบุส่วนลดให้มากกว่า 0');
    if (type === 'percent' && value > 100) throw new HttpError(422, 'ส่วนลดเป็นเปอร์เซ็นต์ต้องไม่เกิน 100');
    value = round2(value);
  }
  return {
    label, kind, type, value, minTotal, giftVariantId, giftQty,
    auto: b.auto === undefined ? (cur?.auto ?? kind === 'freebie') : !!b.auto,
    startsAt, endsAt,
    note: String(b.note ?? cur?.note ?? '').trim().slice(0, 200),
    active: b.active === undefined ? (cur?.active ?? true) : !!b.active,
  };
}

export function createPromo(b: Record<string, unknown>) {
  const code = String(b.code ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new HttpError(422, 'รหัสโปรโมชั่นใช้ได้เฉพาะ A-Z 0-9 _ - (2–20 ตัว)');
  if (getPromo(code)) throw new HttpError(409, `รหัส "${code}" ถูกใช้แล้ว`);
  const v = clean(b);
  db.prepare(
    `INSERT INTO promos (code, label, kind, type, value, min_total, gift_variant_id, gift_qty, auto, starts_at, ends_at, note, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
  ).run(code, v.label, v.kind, v.type, v.value, v.minTotal, v.giftVariantId, v.giftQty, v.auto ? 1 : 0, v.startsAt, v.endsAt, v.note, v.active ? 1 : 0);
  return getPromo(code)!;
}

export function updatePromo(code: string, b: Record<string, unknown>) {
  const cur = getPromo(code);
  if (!cur) throw new HttpError(404, 'ไม่พบโปรโมชั่นนี้');
  const v = clean({ ...b, kind: b.kind ?? cur.kind, type: b.type ?? cur.type }, cur);
  db.prepare(
    `UPDATE promos SET label = ?, kind = ?, type = ?, value = ?, min_total = ?, gift_variant_id = ?, gift_qty = ?,
            auto = ?, starts_at = ?, ends_at = ?, note = ?, active = ? WHERE code = ?`,
  ).run(v.label, v.kind, v.type, v.value, v.minTotal, v.giftVariantId, v.giftQty, v.auto ? 1 : 0, v.startsAt, v.endsAt, v.note, v.active ? 1 : 0, code);
  return getPromo(code)!;
}

export function deletePromo(code: string) {
  if (!getPromo(code)) throw new HttpError(404, 'ไม่พบโปรโมชั่นนี้');
  // บิลเก่าเก็บรหัสไว้เป็นข้อความ ลบแล้วประวัติยังอ่านได้
  db.prepare('DELETE FROM promos WHERE code = ?').run(code);
  return { ok: true };
}

/** โปรโมชั่นอัตโนมัติที่เข้าเงื่อนไขของยอดนี้ (ใช้ทั้งตอนแสดงในตะกร้าและตอนบันทึกบิล) */
export function autoPromos(subtotal: number): PromoRow[] {
  return listPromos().filter((p) => p.active && p.auto && inPeriod(p) && subtotal >= p.minTotal);
}

/** ของแถมที่ได้จากยอดนี้ — รวมจำนวนถ้าแถมสินค้าตัวเดียวกันหลายโปร */
export function giftsFor(subtotal: number) {
  const out = new Map<number, { variantId: number; qty: number; promoCode: string; label: string }>();
  for (const p of autoPromos(subtotal)) {
    if (p.kind !== 'freebie' || !p.giftVariantId) continue;
    const cur = out.get(p.giftVariantId);
    if (cur) cur.qty += p.giftQty;
    else out.set(p.giftVariantId, { variantId: p.giftVariantId, qty: p.giftQty, promoCode: p.code, label: p.label });
  }
  return [...out.values()];
}

/** ส่วนลดอัตโนมัติที่ดีที่สุดสำหรับยอดนี้ (ใช้เมื่อไม่ได้กรอกโค้ดเอง) */
export function bestAutoDiscount(subtotal: number) {
  let best: { promo: PromoRow; discount: number } | null = null;
  for (const p of autoPromos(subtotal)) {
    if (p.kind !== 'discount') continue;
    const d = round2(Math.min(p.type === 'percent' ? (subtotal * p.value) / 100 : p.value, subtotal));
    if (d > 0 && (!best || d > best.discount)) best = { promo: p, discount: d };
  }
  return best;
}

/** สรุปให้หน้าขายแสดงก่อนรับเงิน */
export const previewFor = (subtotal: number) => {
  const d = bestAutoDiscount(subtotal);
  return {
    subtotal,
    gifts: giftsFor(subtotal).map((g) => {
      const v = db
        .prepare('SELECT v.id, v.sku, v.size, v.color, p.name FROM variants_all v JOIN products p ON p.id = v.product_id WHERE v.id = ?')
        .get(g.variantId) as { sku: string; size: string; color: string; name: string } | undefined;
      return { ...g, name: v ? `${v.name} (${[v.color, v.size].filter(Boolean).join(' / ')})` : `สินค้า #${g.variantId}` };
    }),
    discount: d ? { code: d.promo.code, label: d.promo.label, amount: d.discount } : null,
    /** โปรที่ยังไม่ถึงยอด — ไว้บอกลูกค้าว่า "ซื้ออีก ฿x ได้ของแถม" */
    next: listPromos()
      .filter((p) => p.active && p.auto && inPeriod(p) && subtotal < p.minTotal)
      .map((p) => ({ code: p.code, label: p.label, minTotal: p.minTotal, missing: round2(p.minTotal - subtotal) }))
      .sort((a, b) => a.missing - b.missing)
      .slice(0, 3),
  };
};
