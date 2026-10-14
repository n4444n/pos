// ประวัติการขาย + แก้ไขบิล (เปลี่ยน/คืนสินค้า) + ยกเลิกบิล + export CSV
import { db, tx, countChanges } from './db.ts';
import { allowNegativeStock, feeFor } from './settings.ts';
import { discountFor, HttpError, PAYMENT_METHODS, round2, vatOf, type Promo } from './common.ts';
import { recordPayment, requireShift } from './shifts.ts';
import { variantLabel } from './products.ts';

const PAY_LABEL: Record<string, string> = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', card: 'บัตร', transfer: 'โอน' };
const STATUS_LABEL: Record<string, string> = { paid: 'ชำระแล้ว', edited: 'แก้ไขแล้ว', void: 'ยกเลิก' };

const q = {
  order: db.prepare(
    `SELECT id, order_no AS orderNo, customer_name AS customerName, salesperson, order_type AS orderType,
            subtotal, discount, vat, total, promo_code AS promoCode, payment_method AS paymentMethod,
            cash_received AS cashReceived, change_due AS changeDue, status, created_at AS createdAt,
            updated_at AS updatedAt, edit_count AS editCount, void_reason AS voidReason, fee, fee_payer AS feePayer
       FROM orders WHERE id = ?`,
  ),
  items: db.prepare(
    `SELECT oi.variant_id AS variantId, v.product_id AS productId, oi.product_name AS name, oi.sku, oi.size,
            oi.color, oi.extra, v.color_hex AS colorHex, p.art, oi.qty, oi.unit_price AS unitPrice, oi.line_total AS lineTotal
       FROM order_items oi
       LEFT JOIN variants v ON v.id = oi.variant_id
       LEFT JOIN products p ON p.id = v.product_id
      WHERE oi.order_id = ? ORDER BY oi.id`,
  ),
  edits: db.prepare(
    `SELECT id, kind, edited_at AS editedAt, staff, reason, summary, old_total AS oldTotal, new_total AS newTotal,
            diff, settle_method AS settleMethod, cash_received AS cashReceived, change_due AS changeDue
       FROM order_edits WHERE order_id = ? ORDER BY id DESC`,
  ),
  variant: db.prepare(
    `SELECT v.id, v.sku, v.size, v.color, v.extra, v.stock, v.active, p.active AS pActive, p.name, COALESCE(v.price, p.price) AS price
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
  ),
  promo: db.prepare('SELECT code, label, type, value, min_total AS minTotal FROM promos WHERE code = ?'),
  restock: db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?'),
  decStock: db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?'),
  decStockAny: db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ?'),
  delItems: db.prepare('DELETE FROM order_items WHERE order_id = ?'),
  insItem: db.prepare(
    `INSERT INTO order_items (order_id, variant_id, product_name, sku, size, color, extra, qty, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  updOrder: db.prepare(
    `UPDATE orders SET customer_name = ?, subtotal = ?, discount = ?, vat = ?, total = ?, status = 'edited',
            edit_count = edit_count + 1, updated_at = datetime('now', 'localtime')
      WHERE id = ?`,
  ),
  voidOrder: db.prepare(
    `UPDATE orders SET status = 'void', void_reason = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
  ),
  insEdit: db.prepare(
    `INSERT INTO order_edits (order_id, kind, staff, reason, summary, old_total, new_total, diff, settle_method,
                              cash_received, change_due, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
};

type OrderRow = {
  id: number; orderNo: string; customerName: string | null; total: number; promoCode: string | null; status: string; paymentMethod: string; feePayer: string;
};
type ItemRow = {
  variantId: number; productId: number | null; name: string; sku: string; size: string; color: string; extra: string;
  colorHex: string | null; art: string | null; qty: number; unitPrice: number; lineTotal: number;
};

function getOrder(id: number) {
  const o = q.order.get(id) as OrderRow | undefined;
  if (!o) throw new HttpError(404, 'ไม่พบบิลนี้');
  return o;
}

export function orderDetail(id: number) {
  const order = getOrder(id);
  return { ...order, items: q.items.all(id) as ItemRow[], edits: q.edits.all(id) };
}

// ---------------- ค้นหา / รายการบิล ----------------
export interface HistoryQuery {
  from?: string; to?: string; timeFrom?: string; timeTo?: string;
  q?: string; status?: string; payment?: string; limit?: number; offset?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function where(f: HistoryQuery) {
  const conds: string[] = [];
  const args: (string | number)[] = [];
  if (f.from && DATE.test(f.from)) { conds.push('date(o.created_at) >= ?'); args.push(f.from); }
  if (f.to && DATE.test(f.to)) { conds.push('date(o.created_at) <= ?'); args.push(f.to); }
  if (f.timeFrom && TIME.test(f.timeFrom)) { conds.push("strftime('%H:%M', o.created_at) >= ?"); args.push(f.timeFrom); }
  if (f.timeTo && TIME.test(f.timeTo)) { conds.push("strftime('%H:%M', o.created_at) <= ?"); args.push(f.timeTo); }
  if (f.status && ['paid', 'edited', 'void'].includes(f.status)) { conds.push('o.status = ?'); args.push(f.status); }
  if (f.payment && PAYMENT_METHODS.includes(f.payment)) { conds.push('o.payment_method = ?'); args.push(f.payment); }
  const text = f.q?.trim();
  if (text) {
    const like = `%${text}%`;
    conds.push(`(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.salesperson LIKE ?
                 OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND (i.sku LIKE ? OR i.product_name LIKE ?)))`);
    args.push(like, like, like, like, like);
  }
  return { sql: conds.length ? 'WHERE ' + conds.join(' AND ') : '', args };
}

const LIST_COLS = `o.id, o.order_no AS orderNo, o.created_at AS createdAt, o.customer_name AS customerName,
  o.salesperson, o.order_type AS orderType, o.subtotal, o.discount, o.vat, o.total, o.payment_method AS paymentMethod,
  o.status, o.edit_count AS editCount,
  (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id) AS itemCount`;

export function history(f: HistoryQuery) {
  const { sql, args } = where(f);
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 500);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const rows = db.prepare(`SELECT ${LIST_COLS} FROM orders o ${sql} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const summary = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN o.status != 'void' THEN o.total END), 0) AS sales,
              COALESCE(SUM(CASE WHEN o.status = 'void' THEN 1 ELSE 0 END), 0) AS voided,
              COALESCE(SUM(CASE WHEN o.status = 'edited' THEN 1 ELSE 0 END), 0) AS edited
         FROM orders o ${sql}`,
    )
    .get(...args);
  return { rows, summary, limit, offset };
}

export function historyCsv(f: HistoryQuery) {
  const { rows } = history({ ...f, limit: 500, offset: 0 });
  const all = [...(rows as Record<string, unknown>[])];
  // ดึงต่อจนครบ (สูงสุด 20,000 บิล)
  for (let off = 500; all.length === off && off < 20000; off += 500) {
    all.push(...(history({ ...f, limit: 500, offset: off }).rows as Record<string, unknown>[]));
  }
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['เลขที่บิล', 'วันที่-เวลา', 'ลูกค้า', 'พนักงาน', 'ประเภท', 'จำนวนชิ้น', 'ยอดรวม', 'ส่วนลด', 'VAT', 'ยอดสุทธิ', 'วิธีชำระ', 'สถานะ', 'แก้ไข (ครั้ง)'];
  const lines = all.map((r) =>
    [r.orderNo, r.createdAt, r.customerName, r.salesperson, r.orderType, r.itemCount, r.subtotal, r.discount, r.vat, r.total,
      PAY_LABEL[r.paymentMethod as string] ?? r.paymentMethod, STATUS_LABEL[r.status as string] ?? r.status, r.editCount]
      .map(esc).join(','),
  );
  return '﻿' + [head.join(','), ...lines].join('\r\n'); // BOM → Excel อ่านภาษาไทยได้
}

// ---------------- แก้ไขบิล / เปลี่ยนสินค้า ----------------
export interface EditBody {
  items?: { variantId: number; qty: number }[];
  customerName?: string;
  staff?: string;
  reason?: string;
  settleMethod?: string;
  cashReceived?: number;
  dryRun?: boolean;
}

export function editOrder(id: number, body: EditBody) {
  const order = getOrder(id);
  if (order.status === 'void') throw new HttpError(409, 'บิลนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
  const before = q.items.all(id) as ItemRow[];

  const oldQty = new Map<number, number>();
  const oldPrice = new Map<number, number>();
  for (const it of before) {
    oldQty.set(it.variantId, (oldQty.get(it.variantId) ?? 0) + it.qty);
    oldPrice.set(it.variantId, it.unitPrice);
  }

  // รวมรายการ variant ซ้ำ
  const wanted = new Map<number, number>();
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const qn = Math.floor(Number(it.qty));
    if (!Number.isFinite(qn) || qn < 0 || qn > 999) throw new HttpError(400, 'จำนวนสินค้าไม่ถูกต้อง');
    if (qn > 0) wanted.set(Number(it.variantId), (wanted.get(Number(it.variantId)) ?? 0) + qn);
  }
  if (wanted.size > 200) throw new HttpError(400, 'รายการสินค้ามากเกินไป');

  const lines = [...wanted].map(([variantId, qty]) => {
    const v = q.variant.get(variantId) as
      | { id: number; sku: string; size: string; color: string; extra: string; stock: number; active: number; pActive: number; name: string; price: number }
      | undefined;
    if (!v) throw new HttpError(404, `ไม่พบสินค้า #${variantId}`);
    // SKU ที่ปิดขายแล้ว: ใช้ได้เฉพาะที่อยู่ในบิลเดิม (ห้ามเพิ่มจำนวน)
    if ((!v.active || !v.pActive) && qty > (oldQty.get(variantId) ?? 0)) throw new HttpError(409, `${v.name} (${variantLabel(v)}) ปิดการขายแล้ว`);
    // สต็อกที่ใช้ได้ = สต็อกปัจจุบัน + จำนวนเดิมในบิล (จะถูกคืนกลับก่อน)
    const available = v.stock + (oldQty.get(variantId) ?? 0);
    if (qty > available && !allowNegativeStock()) throw new HttpError(409, `${v.name} (${variantLabel(v)}) ใช้ได้ ${available} ชิ้น`);
    // สินค้าเดิมในบิลใช้ราคาเดิม, สินค้าใหม่ใช้ราคาปัจจุบัน
    const unitPrice = oldPrice.get(variantId) ?? v.price;
    return { ...v, qty, unitPrice, lineTotal: round2(unitPrice * qty) };
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const promo = order.promoCode ? (q.promo.get(order.promoCode) as Promo | undefined) : undefined;
  const discount = discountFor(promo, subtotal);
  // ค่าธรรมเนียมคิดใหม่จากยอดสินค้า ตามวิธีชำระ/ผู้จ่ายเดิมของบิล
  const goods = round2(subtotal - discount);
  const fee = feeFor(order.paymentMethod, goods);
  const total = round2(goods + (order.feePayer === 'customer' ? fee : 0));
  const vat = vatOf(total);
  const diff = round2(total - order.total);

  // สรุปการเปลี่ยนแปลง: คืน / รับเพิ่ม
  const returned: string[] = [];
  const added: string[] = [];
  const label = (name: string, color: string, size: string, n: number, extra = '') => `${name} (${variantLabel({ color, size, extra })}) ×${n}`;
  for (const it of before) {
    const now = wanted.get(it.variantId) ?? 0;
    const d = (oldQty.get(it.variantId) ?? 0) - now;
    if (d > 0 && !returned.some((r) => r.startsWith(`${it.name} (${variantLabel(it)})`))) returned.push(label(it.name, it.color, it.size, d, it.extra));
  }
  for (const l of lines) {
    const d = l.qty - (oldQty.get(l.id) ?? 0);
    if (d > 0) added.push(label(l.name, l.color, l.size, d, l.extra));
  }
  const changed = returned.length > 0 || added.length > 0 || (body.customerName ?? order.customerName ?? '') !== (order.customerName ?? '');
  const summary = [returned.length ? `คืน: ${returned.join(', ')}` : '', added.length ? `รับ: ${added.join(', ')}` : '']
    .filter(Boolean).join(' · ') || 'แก้ไขข้อมูลบิล';

  const preview = {
    subtotal, discount, vat, total, fee, feePayer: order.feePayer, oldTotal: order.total, diff, promoCode: order.promoCode, summary, changed,
    lines: lines.map((l) => ({ variantId: l.id, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
  };
  if (body.dryRun) return { preview };

  // ---------- validate before saving ----------
  if (lines.length === 0) throw new HttpError(400, 'บิลต้องมีสินค้าอย่างน้อย 1 รายการ (ถ้าคืนทั้งหมด ให้ใช้ "ยกเลิกบิล")');
  if (!changed) throw new HttpError(400, 'ยังไม่มีการเปลี่ยนแปลง');
  const staff = body.staff?.trim();
  const reason = body.reason?.trim();
  if (!staff) throw new HttpError(422, 'กรุณาเลือกพนักงานผู้แก้ไข');
  if (!reason) throw new HttpError(422, 'กรุณาระบุเหตุผลการแก้ไข');

  let settleMethod: string | null = null;
  let cashReceived: number | null = null;
  let change: number | null = null;
  if (diff !== 0) {
    settleMethod = body.settleMethod ?? '';
    if (!PAYMENT_METHODS.includes(settleMethod)) throw new HttpError(422, diff > 0 ? 'กรุณาเลือกวิธีรับเงินส่วนต่าง' : 'กรุณาเลือกวิธีคืนเงิน');
    if (settleMethod === 'cash' && diff > 0) {
      cashReceived = round2(Number(body.cashReceived ?? diff));
      if (!(cashReceived >= diff)) throw new HttpError(422, 'รับเงินสดไม่พอ');
      change = round2(cashReceived - diff);
    }
  }

  // มีเงินเข้า/ออก → ต้องมีกะเปิดอยู่ เพื่อลงบัญชีลิ้นชัก
  const shift = diff !== 0 ? requireShift() : null;

  tx(() => {
    if (shift) recordPayment(shift.id, id, 'edit', settleMethod!, diff);
    for (const it of before) q.restock.run(it.qty, it.variantId);
    for (const l of lines) {
      const dec = allowNegativeStock() ? () => q.decStockAny.run(l.qty, l.id) : () => q.decStock.run(l.qty, l.id, l.qty);
      if (countChanges(dec) !== 1) throw new HttpError(409, `${l.name} (${variantLabel(l)}) สต็อกไม่พอ`);
    }
    q.delItems.run(id);
    for (const l of lines) q.insItem.run(id, l.id, l.name, l.sku, l.size, l.color, l.extra, l.qty, l.unitPrice, l.lineTotal);
    const customer = body.customerName !== undefined ? body.customerName.trim().slice(0, 80) || null : order.customerName;
    q.updOrder.run(customer, subtotal, discount, vat, total, id);
    // ยอดเปลี่ยน → คิดค่าธรรมเนียมใหม่ตามวิธีชำระของบิล
    db.prepare('UPDATE orders SET fee = ? WHERE id = ?').run(fee, id);
    q.insEdit.run(
      id, 'edit', staff.slice(0, 80), reason.slice(0, 200), summary, order.total, total, diff, settleMethod,
      cashReceived, change, JSON.stringify(before), JSON.stringify(preview.lines),
    );
  });

  return { order: orderDetail(id), diff, changeDue: change };
}

export function voidOrder(id: number, body: { staff?: string; reason?: string; refundMethod?: string }) {
  const order = getOrder(id);
  if (order.status === 'void') throw new HttpError(409, 'บิลนี้ถูกยกเลิกไปแล้ว');
  const staff = body.staff?.trim();
  const reason = body.reason?.trim();
  if (!staff) throw new HttpError(422, 'กรุณาเลือกพนักงานผู้ยกเลิก');
  if (!reason) throw new HttpError(422, 'กรุณาระบุเหตุผลการยกเลิก');
  const refund = body.refundMethod && PAYMENT_METHODS.includes(body.refundMethod) ? body.refundMethod : null;
  const before = q.items.all(id) as ItemRow[];
  const shift = order.total > 0 ? requireShift() : null;
  const method = refund ?? (q.order.get(id) as { paymentMethod: string }).paymentMethod;
  tx(() => {
    if (shift) recordPayment(shift.id, id, 'void', method, -order.total);
    for (const it of before) q.restock.run(it.qty, it.variantId); // คืนสต็อกทั้งหมด
    q.voidOrder.run(reason.slice(0, 200), id);
    q.insEdit.run(
      id, 'void', staff.slice(0, 80), reason.slice(0, 200), 'ยกเลิกบิล · คืนสินค้าเข้าสต็อกทั้งหมด',
      order.total, 0, -order.total, refund, null, null, JSON.stringify(before), '[]',
    );
  });
  return { order: orderDetail(id) };
}
