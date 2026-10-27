// เอกสารภาษีหลังการขาย (สาขาที่จด VAT)
// 1) ใบกำกับภาษีเต็มรูป — ลูกค้าขอได้จากบิลที่คิด VAT: ชื่อ / ที่อยู่ / เลขประจำตัวผู้เสียภาษี / สาขาของผู้ซื้อ
//    เลขที่แยก TIV-YYMM-0001 (รันต่อสาขาต่อเดือน) · บิลละ 1 ใบที่ใช้งาน (ข้อมูลผิด → ยกเลิกแล้วออกใหม่ · ใบเดิมเก็บไว้)
// 2) ใบลดหนี้ — รับคืนสินค้าบางส่วน/ทั้งหมดโดยไม่แก้บิลเดิม: เลขที่ CN-YYMM-0001 · คืนสต็อก · คืนเงินในกะ
//    ยอดคืน = มูลค่าสินค้าที่คืนหลังหักส่วนลดท้ายบิลตามสัดส่วน · VAT คิดอัตราเดียวกับบิลเดิม
//    รายงานภาษีขายของเดือนที่ออกใบลดหนี้ นำ VAT ของใบลดหนี้ไปหักภาษีขาย (บิลเดิมไม่เปลี่ยน)
import { docFloor } from './docFloor.ts';
import { currentBranch, db, mainBranchId, tx } from './db.ts';
import { HttpError, PAYMENT_METHODS, round2 } from './common.ts';
import { currentBranchInfo, getBranch } from './branches.ts';
import { getSettings } from './settings.ts';
import { requireShift, recordPayment } from './shifts.ts';
import { billTax, taxBranchText, validTaxId } from './tax.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS tax_invoices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id     INTEGER NOT NULL,
    order_id      INTEGER NOT NULL,
    doc_no        TEXT NOT NULL UNIQUE,
    buyer_name    TEXT NOT NULL,
    buyer_address TEXT NOT NULL,
    buyer_tax_id  TEXT NOT NULL,
    buyer_branch  TEXT NOT NULL DEFAULT '',      -- '00000' = สำนักงานใหญ่ · '00001' … · '' = บุคคลธรรมดา
    vat_rate      REAL NOT NULL,
    vat_base      REAL NOT NULL,
    vat           REAL NOT NULL,
    exempt        REAL NOT NULL DEFAULT 0,
    total         REAL NOT NULL,
    issued_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    issued_by     TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    cancel_reason TEXT,
    cancelled_at  TEXT,
    cancelled_by  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tiv_order ON tax_invoices(order_id);

  CREATE TABLE IF NOT EXISTS credit_notes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id     INTEGER NOT NULL,
    order_id      INTEGER NOT NULL,
    doc_no        TEXT NOT NULL UNIQUE,
    reason        TEXT NOT NULL,
    refund_method TEXT NOT NULL,
    gross         REAL NOT NULL,                 -- มูลค่าสินค้าที่คืนตามราคาในบิล (ก่อนหักส่วนลด)
    total         REAL NOT NULL,                 -- ยอดคืนเงิน (รวม VAT)
    vat_rate      REAL NOT NULL,
    vat_base      REAL NOT NULL,
    vat           REAL NOT NULL,
    exempt        REAL NOT NULL DEFAULT 0,
    shift_id      INTEGER,
    issued_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    issued_by     TEXT NOT NULL,
    approver      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cn_order ON credit_notes(order_id);
  CREATE TABLE IF NOT EXISTS credit_note_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    credit_note_id INTEGER NOT NULL REFERENCES credit_notes(id),
    order_item_id  INTEGER NOT NULL,
    variant_id     INTEGER,
    product_name   TEXT NOT NULL,
    sku            TEXT,
    size           TEXT,
    color          TEXT,
    extra          TEXT,
    qty            INTEGER NOT NULL CHECK (qty > 0),
    unit_price     REAL NOT NULL,
    line_total     REAL NOT NULL,
    vat_exempt     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_cni_note ON credit_note_items(credit_note_id);
`);

const branchNow = () => currentBranch() || mainBranchId();
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

// ---------- ข้อมูลที่ใช้ร่วมกัน ----------
interface OrderRow {
  id: number; orderNo: string; branchId: number; createdAt: string; status: string; subtotal: number; discount: number;
  total: number; vat: number; vatRate: number | null; vatBase: number | null; exemptAmount: number; fee: number; feePayer: string | null;
  paymentMethod: string;
}
const orderStmt = db.prepare(
  `SELECT id, order_no AS orderNo, branch_id AS branchId, created_at AS createdAt, status, subtotal, discount, total, vat,
          vat_rate AS vatRate, vat_base AS vatBase, exempt_amount AS exemptAmount, fee, fee_payer AS feePayer, payment_method AS paymentMethod
     FROM orders WHERE id = ?`,
);
function orderOf(id: number) {
  const o = orderStmt.get(id) as OrderRow | undefined;
  if (!o) throw new HttpError(404, 'ไม่พบบิลนี้');
  return o;
}
interface ItemRow { id: number; variantId: number | null; name: string; sku: string | null; size: string | null; color: string | null; extra: string | null; qty: number; unitPrice: number; lineTotal: number; vatExempt: number }
const itemsStmt = db.prepare(
  `SELECT id, variant_id AS variantId, product_name AS name, sku, size, color, extra, qty, unit_price AS unitPrice, line_total AS lineTotal, vat_exempt AS vatExempt
     FROM order_items WHERE order_id = ? ORDER BY id`,
);
const returnedStmt = db.prepare(
  `SELECT i.order_item_id AS itemId, SUM(i.qty) AS qty FROM credit_note_items i JOIN credit_notes c ON c.id = i.credit_note_id
    WHERE c.order_id = ? GROUP BY i.order_item_id`,
);
/** จำนวนที่คืนไปแล้วต่อรายการในบิล */
function returnedOf(orderId: number) {
  const m = new Map<number, number>();
  for (const r of returnedStmt.all(orderId) as { itemId: number; qty: number }[]) m.set(r.itemId, r.qty);
  return m;
}

/** ผู้ขาย (หัวเอกสาร): ชื่อผู้ประกอบการ · เลขผู้เสียภาษี · สำนักงานใหญ่/สาขาที่ · ที่อยู่สาขา */
function sellerOf(branchId: number) {
  const s = getSettings();
  const b = getBranch(branchId);
  return {
    name: s.tax.legalName || s.shop.name,
    shopName: s.shop.name,
    taxId: s.shop.taxId,
    branch: b ? taxBranchText(b.taxBranchNo) : '',
    branchName: b?.name ?? '',
    address: b?.address || s.shop.address || '',
    phone: b?.phone || s.shop.phone || '',
  };
}

/** เลขที่เอกสารถัดไป: TIV-2610-0001 · สาขาอื่นมีรหัสสาขา TIV-B02-2610-0001 (รันต่อสาขาต่อเดือน) */
function nextDocNo(table: 'tax_invoices' | 'credit_notes', kind: 'TIV' | 'CN') {
  const d = new Date();
  const b = currentBranchInfo();
  const code = b.isMain ? '' : `${b.code.replace(/[^A-Za-z0-9]/g, '') || b.id}-`;
  const prefix = `${kind}-${code}${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-`;
  const last = db.prepare(`SELECT doc_no AS no FROM ${table} WHERE doc_no LIKE ? ORDER BY id DESC LIMIT 1`).get(`${prefix}%`) as { no: string } | undefined;
  const n = Math.max(last ? Number(last.no.slice(prefix.length)) || 0 : 0, docFloor(prefix));
  return prefix + String(n + 1).padStart(4, '0');
}

// ---------- ใบกำกับภาษีเต็มรูป ----------
const TIV_COLS = `id, branch_id AS branchId, order_id AS orderId, doc_no AS docNo, buyer_name AS buyerName, buyer_address AS buyerAddress,
  buyer_tax_id AS buyerTaxId, buyer_branch AS buyerBranch, vat_rate AS vatRate, vat_base AS vatBase, vat, exempt, total,
  issued_at AS issuedAt, issued_by AS issuedBy, status, cancel_reason AS cancelReason, cancelled_at AS cancelledAt, cancelled_by AS cancelledBy`;
export interface TaxInvoiceRow {
  id: number; branchId: number; orderId: number; docNo: string; buyerName: string; buyerAddress: string; buyerTaxId: string; buyerBranch: string;
  vatRate: number; vatBase: number; vat: number; exempt: number; total: number; issuedAt: string; issuedBy: string;
  status: 'active' | 'cancelled'; cancelReason: string | null; cancelledAt: string | null; cancelledBy: string | null;
}
const tivByOrder = db.prepare(`SELECT ${TIV_COLS} FROM tax_invoices WHERE order_id = ? ORDER BY id`);
const tivById = db.prepare(`SELECT ${TIV_COLS} FROM tax_invoices WHERE id = ?`);
const activeTiv = (orderId: number) =>
  db.prepare(`SELECT ${TIV_COLS} FROM tax_invoices WHERE order_id = ? AND status = 'active'`).get(orderId) as TaxInvoiceRow | undefined;

const buyerBranchText = (b: string) => (b === '00000' ? 'สำนักงานใหญ่' : b ? `สาขาที่ ${b}` : '');

/** เอกสารพร้อมพิมพ์: ผู้ขาย + ผู้ซื้อ + รายการสินค้าของบิล */
function presentTiv(t: TaxInvoiceRow) {
  const o = orderOf(t.orderId);
  return {
    ...t,
    buyerBranchText: buyerBranchText(t.buyerBranch),
    orderNo: o.orderNo,
    orderDate: o.createdAt,
    subtotal: o.subtotal,
    discount: o.discount,
    fee: o.feePayer === 'customer' ? o.fee : 0,
    items: (itemsStmt.all(o.id) as unknown as ItemRow[]).map((i) => ({ ...i, vatExempt: !!i.vatExempt })),
    seller: sellerOf(t.branchId),
  };
}

export function issueTaxInvoice(orderId: number, body: Record<string, unknown>, by: string) {
  const o = orderOf(orderId);
  if (o.status === 'void') throw new HttpError(409, 'บิลนี้ถูกยกเลิกแล้ว — ออกใบกำกับภาษีไม่ได้');
  if (!(o.vatRate && o.vatRate > 0 && o.vat > 0)) throw new HttpError(409, 'บิลนี้ไม่ได้คิด VAT — ออกใบกำกับภาษีเต็มรูปไม่ได้');
  if (db.prepare('SELECT 1 FROM credit_notes WHERE order_id = ?').get(orderId)) {
    throw new HttpError(409, 'บิลนี้มีการคืนสินค้า (ใบลดหนี้) แล้ว — ออกใบกำกับภาษีเต็มรูปไม่ได้');
  }
  const cur = activeTiv(orderId);
  if (cur) throw new HttpError(409, `บิลนี้ออกใบกำกับภาษีเต็มรูปแล้ว (${cur.docNo}) — ถ้าข้อมูลผิด ให้ยกเลิกใบเดิมก่อนแล้วออกใหม่`);
  const name = str(body.buyerName, 160);
  const address = str(body.buyerAddress, 400);
  const taxId = str(body.buyerTaxId, 20).replace(/[^0-9]/g, '');
  const branch = str(body.buyerBranch, 5).replace(/[^0-9]/g, '');
  if (!name) throw new HttpError(422, 'กรุณาระบุชื่อผู้ซื้อ');
  if (!address) throw new HttpError(422, 'กรุณาระบุที่อยู่ผู้ซื้อ');
  if (!validTaxId(taxId)) throw new HttpError(422, 'เลขประจำตัวผู้เสียภาษีของผู้ซื้อไม่ถูกต้อง (13 หลัก และเลขตรวจสอบหลักสุดท้ายต้องถูกต้อง)');
  if (branch && branch.length !== 5) throw new HttpError(422, 'สาขาของผู้ซื้อต้องเป็นเลข 5 หลัก (สำนักงานใหญ่ = 00000) หรือเว้นว่างสำหรับบุคคลธรรมดา');
  const id = tx(() => {
    const docNo = nextDocNo('tax_invoices', 'TIV');
    return Number(
      db
        .prepare(
          `INSERT INTO tax_invoices (branch_id, order_id, doc_no, buyer_name, buyer_address, buyer_tax_id, buyer_branch, vat_rate, vat_base, vat, exempt, total, issued_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(o.branchId, o.id, docNo, name, address, taxId, branch, o.vatRate, o.vatBase ?? round2(o.total - o.vat), o.vat, o.exemptAmount, o.total, by.slice(0, 80))
        .lastInsertRowid,
    );
  });
  return presentTiv(tivById.get(id) as unknown as TaxInvoiceRow);
}

export function taxInvoiceDoc(id: number) {
  const t = tivById.get(id) as TaxInvoiceRow | undefined;
  if (!t) throw new HttpError(404, 'ไม่พบใบกำกับภาษี');
  orderOf(t.orderId); // ตรวจว่าอยู่ในสาขาที่เปิดอยู่
  return presentTiv(t);
}

export function cancelTaxInvoice(id: number, reason: unknown, by: string) {
  const t = tivById.get(id) as TaxInvoiceRow | undefined;
  if (!t) throw new HttpError(404, 'ไม่พบใบกำกับภาษี');
  orderOf(t.orderId);
  if (t.status === 'cancelled') throw new HttpError(409, 'ใบกำกับภาษีนี้ถูกยกเลิกไปแล้ว');
  const why = str(reason, 200);
  if (!why) throw new HttpError(422, 'กรุณาระบุเหตุผลการยกเลิก');
  db.prepare("UPDATE tax_invoices SET status = 'cancelled', cancel_reason = ?, cancelled_at = datetime('now', 'localtime'), cancelled_by = ? WHERE id = ?").run(
    why, by.slice(0, 80), id,
  );
  return presentTiv(tivById.get(id) as unknown as TaxInvoiceRow);
}

// ---------- ใบลดหนี้ (รับคืนสินค้า) ----------
const CN_COLS = `id, branch_id AS branchId, order_id AS orderId, doc_no AS docNo, reason, refund_method AS refundMethod, gross, total,
  vat_rate AS vatRate, vat_base AS vatBase, vat, exempt, issued_at AS issuedAt, issued_by AS issuedBy, approver`;
export interface CreditNoteRow {
  id: number; branchId: number; orderId: number; docNo: string; reason: string; refundMethod: string; gross: number; total: number;
  vatRate: number; vatBase: number; vat: number; exempt: number; issuedAt: string; issuedBy: string; approver: string;
}
const cnByOrder = db.prepare(`SELECT ${CN_COLS} FROM credit_notes WHERE order_id = ? ORDER BY id`);
const cnById = db.prepare(`SELECT ${CN_COLS} FROM credit_notes WHERE id = ?`);
const cnItems = db.prepare(
  `SELECT order_item_id AS orderItemId, variant_id AS variantId, product_name AS name, sku, size, color, extra, qty, unit_price AS unitPrice,
          line_total AS lineTotal, vat_exempt AS vatExempt FROM credit_note_items WHERE credit_note_id = ? ORDER BY id`,
);
function presentCn(c: CreditNoteRow) {
  const o = orderOf(c.orderId);
  const tiv = activeTiv(o.id);
  return {
    ...c,
    orderNo: o.orderNo,
    orderDate: o.createdAt,
    orderTotal: o.total,
    orderVat: o.vat,
    /** ใบลดหนี้ก่อนหน้าของบิลเดียวกัน (มูลค่าที่ถูกต้อง = ยอดบิล − ใบลดหนี้ทั้งหมดจนถึงใบนี้) */
    priorCredits: round2((db.prepare('SELECT COALESCE(SUM(total), 0) AS t FROM credit_notes WHERE order_id = ? AND id < ?').get(o.id, c.id) as { t: number }).t),
    taxInvoiceNo: tiv?.docNo ?? null,
    buyer: tiv ? { name: tiv.buyerName, address: tiv.buyerAddress, taxId: tiv.buyerTaxId, branch: buyerBranchText(tiv.buyerBranch) } : null,
    items: (cnItems.all(c.id) as Record<string, any>[]).map((i) => ({ ...i, vatExempt: !!i.vatExempt })),
    seller: sellerOf(c.branchId),
  };
}

const restock = db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?');

export function createCreditNote(
  orderId: number,
  body: { items?: unknown; reason?: unknown; refundMethod?: unknown },
  by: { operator: string; approver: string },
) {
  const o = orderOf(orderId);
  if (o.status === 'void') throw new HttpError(409, 'บิลนี้ถูกยกเลิกแล้ว — คืนสินค้าไม่ได้');
  if (!(o.vatRate && o.vatRate > 0)) throw new HttpError(409, 'บิลนี้ไม่ได้คิด VAT — ใช้ "แก้ไขบิล / เปลี่ยนสินค้า" แทนใบลดหนี้');
  const reason = str(body.reason, 200);
  if (!reason) throw new HttpError(422, 'กรุณาระบุเหตุผลการคืนสินค้า');
  const refundMethod = PAYMENT_METHODS.includes(String(body.refundMethod)) ? String(body.refundMethod) : o.paymentMethod;
  const sold = itemsStmt.all(orderId) as unknown as ItemRow[];
  const done = returnedOf(orderId);
  const want = (Array.isArray(body.items) ? body.items : []) as { itemId?: unknown; qty?: unknown }[];
  const lines: (ItemRow & { back: number; total: number })[] = [];
  for (const w of want) {
    const it = sold.find((s) => s.id === Number(w.itemId));
    const qty = Math.floor(Number(w.qty));
    if (!it || !(qty > 0)) continue;
    const left = it.qty - (done.get(it.id) ?? 0);
    if (qty > left) throw new HttpError(422, `${it.name} คืนได้อีกไม่เกิน ${left} ชิ้น`);
    lines.push({ ...it, back: qty, total: round2(it.unitPrice * qty) });
  }
  if (!lines.length) throw new HttpError(422, 'กรุณาเลือกสินค้าที่รับคืนอย่างน้อย 1 รายการ');

  // ยอดคืน: มูลค่าตามราคาในบิล หักส่วนลดท้ายบิลตามสัดส่วน (ค่าธรรมเนียมไม่คืน)
  const gross = round2(lines.reduce((s, l) => s + l.total, 0));
  const factor = o.subtotal > 0 ? (o.subtotal - o.discount) / o.subtotal : 1;
  const already = (db.prepare('SELECT COALESCE(SUM(total), 0) AS t FROM credit_notes WHERE order_id = ?').get(orderId) as { t: number }).t;
  const cap = round2(o.total - (o.feePayer === 'customer' ? o.fee : 0) - already);
  const total = Math.min(round2(gross * factor), Math.max(0, cap));
  // ส่วนลดเฉลี่ยลงแต่ละรายการตามสัดส่วน → แยกส่วนยกเว้น VAT / เสีย VAT ด้วยอัตราเดียวกับบิลเดิม
  const tax = billTax(lines.map((l) => ({ lineTotal: l.total, exempt: !!l.vatExempt })), gross, round2(gross - total), total, o.vatRate);

  const shift = total > 0 ? requireShift() : null;
  const id = tx(() => {
    const docNo = nextDocNo('credit_notes', 'CN');
    const cnId = Number(
      db
        .prepare(
          `INSERT INTO credit_notes (branch_id, order_id, doc_no, reason, refund_method, gross, total, vat_rate, vat_base, vat, exempt, shift_id, issued_by, approver)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(branchNow(), o.id, docNo, reason, refundMethod, gross, total, o.vatRate, tax.vatBase, tax.vat, tax.exempt, shift?.id ?? null,
          by.operator.slice(0, 80), by.approver.slice(0, 80))
        .lastInsertRowid,
    );
    const ins = db.prepare(
      `INSERT INTO credit_note_items (credit_note_id, order_item_id, variant_id, product_name, sku, size, color, extra, qty, unit_price, line_total, vat_exempt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of lines) {
      ins.run(cnId, l.id, l.variantId, l.name, l.sku, l.size, l.color, l.extra, l.back, l.unitPrice, l.total, l.vatExempt ? 1 : 0);
      if (l.variantId) restock.run(l.back, l.variantId); // คืนสต็อก
    }
    // คืนเงินในกะปัจจุบัน (ตาราง payments รับ sale/edit/void — ใช้ 'edit' = รายการปรับยอดหลังขาย)
    if (shift) recordPayment(shift.id, o.id, 'edit', refundMethod, -total);
    db.prepare(
      `INSERT INTO order_edits (order_id, kind, staff, reason, summary, old_total, new_total, diff, settle_method, before_json, after_json)
       VALUES (?, 'credit', ?, ?, ?, ?, ?, ?, ?, '[]', '[]')`,
    ).run(o.id, by.operator.slice(0, 80), reason, `ออกใบลดหนี้ ${docNo} · รับคืน ${lines.map((l) => `${l.name} × ${l.back}`).join(', ')}`.slice(0, 500),
      o.total, o.total, -total, refundMethod);
    return cnId;
  });
  return presentCn(cnById.get(id) as unknown as CreditNoteRow);
}

export function creditNoteDoc(id: number) {
  const c = cnById.get(id) as CreditNoteRow | undefined;
  if (!c) throw new HttpError(404, 'ไม่พบใบลดหนี้');
  return presentCn(c);
}

/** เอกสารภาษีของบิล (แสดงในรายละเอียดบิล) + จำนวนที่ยังคืนได้ต่อรายการ */
export function docsForOrder(orderId: number) {
  const done = returnedOf(orderId);
  return {
    taxInvoices: tivByOrder.all(orderId) as unknown as TaxInvoiceRow[],
    creditNotes: (cnByOrder.all(orderId) as unknown as CreditNoteRow[]).map((c) => ({ ...c, items: cnItems.all(c.id) })),
    returned: Object.fromEntries(done),
  };
}

/** ยกเลิกบิล: ห้ามเมื่อมีใบลดหนี้/ใบกำกับเต็มรูปที่ใช้งาน · บิลคิด VAT ของเดือนก่อน (ยื่นภาษีไปแล้ว) ต้องใช้ใบลดหนี้ */
export function assertVoidable(orderId: number) {
  const o = orderOf(orderId);
  if (db.prepare('SELECT 1 FROM credit_notes WHERE order_id = ?').get(orderId)) {
    throw new HttpError(409, 'บิลนี้มีใบลดหนี้ (คืนสินค้า) แล้ว — ยกเลิกบิลไม่ได้ ถ้าคืนเพิ่ม ให้ออกใบลดหนี้อีกใบ');
  }
  const tiv = activeTiv(orderId);
  if (tiv) throw new HttpError(409, `บิลนี้ออกใบกำกับภาษีเต็มรูป ${tiv.docNo} แล้ว — ยกเลิกใบกำกับภาษีก่อน หรือใช้ใบลดหนี้`);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if ((o.vatRate ?? 0) > 0 && o.vat > 0 && o.createdAt.slice(0, 7) !== month) {
    throw new HttpError(409, 'บิลคิด VAT ของเดือนก่อนยกเลิกไม่ได้ (รวมในการยื่นภาษีเดือนนั้นแล้ว) — ใช้ "คืนสินค้า / ใบลดหนี้" แทน', 'PAST_MONTH');
  }
}

// ---------- รายงานภาษี ----------
export interface DocRange { from: string; to: string; terminal?: string }
/** ใบลดหนี้ที่ออกในช่วงวันที่ (ตามวันที่ออกใบลดหนี้) — ขอบเขตสาขาตาม view orders */
export function creditNotesIn(r: DocRange) {
  const extra = r.terminal === 'none' ? ' AND o.terminal_id IS NULL' : Number(r.terminal) > 0 ? ' AND o.terminal_id = ?' : '';
  const args: (string | number)[] = [r.from, r.to];
  if (Number(r.terminal) > 0) args.push(Number(r.terminal));
  return (
    db
      .prepare(
        `SELECT c.id, c.doc_no AS docNo, c.issued_at AS issuedAt, c.reason, c.refund_method AS refundMethod, c.vat_rate AS vatRate,
                c.vat_base AS vatBase, c.vat, c.exempt, c.total, c.issued_by AS issuedBy, c.approver, o.order_no AS orderNo,
                o.created_at AS orderDate, o.branch_id AS branchId
           FROM credit_notes c JOIN orders o ON o.id = c.order_id
          WHERE substr(c.issued_at, 1, 10) BETWEEN ? AND ?${extra} ORDER BY c.issued_at, c.id`,
      )
      .all(...args) as {
      id: number; docNo: string; issuedAt: string; reason: string; refundMethod: string; vatRate: number; vatBase: number; vat: number; exempt: number;
      total: number; issuedBy: string; approver: string; orderNo: string; orderDate: string; branchId: number;
    }[]
  ).map((c) => ({ ...c, branch: getBranch(c.branchId)?.name ?? '' }));
}
/** ใบกำกับภาษีเต็มรูปที่ออกในช่วงวันที่ (รวมใบที่ยกเลิก) */
export function taxInvoicesIn(r: DocRange) {
  const extra = r.terminal === 'none' ? ' AND o.terminal_id IS NULL' : Number(r.terminal) > 0 ? ' AND o.terminal_id = ?' : '';
  const args: (string | number)[] = [r.from, r.to];
  if (Number(r.terminal) > 0) args.push(Number(r.terminal));
  return db
    .prepare(
      `SELECT t.id, t.doc_no AS docNo, t.issued_at AS issuedAt, t.buyer_name AS buyerName, t.buyer_tax_id AS buyerTaxId, t.buyer_branch AS buyerBranch,
              t.vat_rate AS vatRate, t.vat_base AS vatBase, t.vat, t.exempt, t.total, t.status, t.cancel_reason AS cancelReason,
              t.issued_by AS issuedBy, o.order_no AS orderNo
         FROM tax_invoices t JOIN orders o ON o.id = t.order_id
        WHERE substr(t.issued_at, 1, 10) BETWEEN ? AND ?${extra} ORDER BY t.issued_at, t.id`,
    )
    .all(...args)
    .map((t) => ({ ...(t as Record<string, any>), buyerBranchText: buyerBranchText(String((t as Record<string, any>).buyerBranch ?? '')) }));
}
