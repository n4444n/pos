// พักบิล (Hold): ลูกค้าไปแลกเงิน/ลืมของ → พักรายการที่สแกนไว้ แล้วขายให้คนต่อไปก่อน · กลับมาค่อยเรียกคืน
// เก็บที่เซิร์ฟเวอร์ (แยกสาขา) — เครื่องไหนในสาขาก็เรียกคืนได้ · ไม่กันสต็อก (ตรวจสต็อกตอนเรียกคืน)
import { currentBranch, db } from './db.ts';
import { HttpError, round2 } from './common.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS held_bills (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id      INTEGER NOT NULL,
    customer_name  TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    salesperson    TEXT,
    order_type     TEXT,
    promo_code     TEXT,
    items          TEXT NOT NULL,          -- JSON [{ variantId, qty, name, label, price }]
    item_count     INTEGER NOT NULL,
    total          REAL NOT NULL,
    staff          TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_held_branch ON held_bills(branch_id);
`);

export interface HeldItem { variantId: number; qty: number; name: string; label: string; price: number }
export interface HeldBill {
  id: number; customerName: string; note: string; salesperson: string | null; orderType: string | null; promoCode: string | null;
  items: HeldItem[]; itemCount: number; total: number; staff: string; createdAt: string;
}
const COLS = `id, customer_name AS customerName, note, salesperson, order_type AS orderType, promo_code AS promoCode, items,
  item_count AS itemCount, total, staff, created_at AS createdAt`;
// ราคาขาย = ราคาของ SKU (สาขานี้) ถ้าไม่ได้ตั้ง ใช้ราคาระดับสินค้า (variants.price = NULL → products.price)
const priceStmt = () => db.prepare('SELECT COALESCE(v.price, p.price) AS price FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?');
const parse = (r: Record<string, unknown>): HeldBill => {
  const bill = { ...(r as unknown as HeldBill), items: JSON.parse(String(r.items)) as HeldItem[] };
  // บิลที่พักไว้ก่อนแก้ (ราคาเป็น null → ยอด 0) → เติมราคาปัจจุบันแล้วคิดยอดใหม่
  if (bill.items.some((x) => x.price == null)) {
    const st = priceStmt();
    for (const x of bill.items) if (x.price == null) x.price = (st.get(x.variantId) as { price: number } | undefined)?.price ?? 0;
    bill.total = round2(bill.items.reduce((a, x) => a + x.price * x.qty, 0));
  }
  return bill;
};
const BR = '((SELECT branch_id FROM temp.ctx) = 0 OR branch_id = (SELECT branch_id FROM temp.ctx))';

export function listHeld(): HeldBill[] {
  return (db.prepare(`SELECT ${COLS} FROM held_bills WHERE ${BR} ORDER BY id`).all() as Record<string, unknown>[]).map(parse);
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
export function holdBill(body: Record<string, any>, staff: string) {
  if (!currentBranch()) throw new HttpError(422, 'กรุณาเลือกสาขาก่อน');
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) throw new HttpError(422, 'ยังไม่มีสินค้าในรายการ');
  if (raw.length > 200) throw new HttpError(422, 'รายการมากเกินไป');
  const get = db.prepare(
    `SELECT v.id, COALESCE(v.price, p.price) AS price, v.size, v.color, v.extra, p.name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
  );
  const items: HeldItem[] = [];
  for (const it of raw) {
    const id = Number(it?.variantId);
    const qty = Math.floor(Number(it?.qty));
    if (!Number.isInteger(id) || !(qty > 0)) continue;
    const v = get.get(id) as { id: number; price: number; size: string; color: string; extra: string | null; name: string } | undefined;
    if (!v) continue;
    const label = [v.color, v.size, v.extra].filter((x) => x && x !== '-').join(' / ');
    items.push({ variantId: id, qty, name: v.name, label, price: v.price });
  }
  if (!items.length) throw new HttpError(422, 'ไม่พบสินค้าในรายการ');
  const total = round2(items.reduce((a, x) => a + x.price * x.qty, 0));
  const count = items.reduce((a, x) => a + x.qty, 0);
  const r = db
    .prepare(
      `INSERT INTO held_bills (branch_id, customer_name, note, salesperson, order_type, promo_code, items, item_count, total, staff)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      currentBranch(), str(body.customerName, 80), str(body.note, 200), str(body.salesperson, 80) || null, str(body.orderType, 40) || null,
      str(body.promoCode, 40) || null, JSON.stringify(items), count, total, staff.slice(0, 80),
    );
  return parse(db.prepare(`SELECT ${COLS} FROM held_bills WHERE id = ?`).get(Number(r.lastInsertRowid)) as Record<string, unknown>);
}

/** เรียกคืน = ส่งบิลกลับไปที่หน้าขาย แล้วลบออกจากรายการพัก */
export function recallHeld(id: number) {
  const r = db.prepare(`SELECT ${COLS} FROM held_bills WHERE id = ? AND ${BR}`).get(id) as Record<string, unknown> | undefined;
  if (!r) throw new HttpError(404, 'ไม่พบบิลที่พักไว้ (อาจถูกเรียกคืนจากเครื่องอื่นแล้ว)');
  db.prepare('DELETE FROM held_bills WHERE id = ?').run(id);
  return parse(r);
}

export function deleteHeld(id: number) {
  const r = db.prepare(`DELETE FROM held_bills WHERE id = ? AND ${BR}`).run(id);
  if (!Number(r.changes)) throw new HttpError(404, 'ไม่พบบิลที่พักไว้');
  return { ok: true };
}
