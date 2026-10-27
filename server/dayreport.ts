// สรุปยอดประจำวัน (พิมพ์ตอนปิดกะ) — ตามสาขาปัจจุบัน
import { db } from './db.ts';
import { HttpError, round2 } from './common.ts';
import { publicSettings } from './settings.ts';
import { expenseTotal } from './expenses.ts';

export function daySummary(date?: string) {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (() => {
    const t = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  })();
  if (!d) throw new HttpError(422, 'วันที่ไม่ถูกต้อง');
  const sales = db
    .prepare(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(subtotal), 0) AS subtotal,
              COALESCE(SUM(discount), 0) AS discount, COALESCE(SUM(vat), 0) AS vat, COALESCE(SUM(fee), 0) AS fee
         FROM orders WHERE status != 'void' AND date(created_at) = ?`,
    )
    .get(d) as { bills: number; total: number; subtotal: number; discount: number; vat: number; fee: number };
  const voids = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount FROM orders WHERE status = 'void' AND date(created_at) = ?`)
    .get(d) as { n: number; amount: number };
  const units = (db
    .prepare(`SELECT COALESCE(SUM(i.qty), 0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status != 'void' AND date(o.created_at) = ?`)
    .get(d) as { n: number }).n;
  // รับเงินสุทธิแยกตามวิธีชำระ (รวมเก็บเพิ่ม/คืนเงินจากการแก้ไข-ยกเลิกบิล)
  const byMethod = db
    .prepare(`SELECT method, COALESCE(SUM(amount), 0) AS amount FROM payments WHERE date(created_at) = ? GROUP BY method`)
    .all(d) as { method: string; amount: number }[];
  const edits = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN e.diff < 0 THEN -e.diff END), 0) AS refunded
         FROM order_edits e JOIN orders o ON o.id = e.order_id WHERE e.kind IN ('edit', 'credit') AND date(e.edited_at) = ?`,
    )
    .get(d) as { n: number; refunded: number };
  const top = db
    .prepare(
      `SELECT i.product_name AS name, SUM(i.qty) AS qty, SUM(i.line_total) AS amount
         FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status != 'void' AND date(o.created_at) = ?
        GROUP BY i.product_name ORDER BY qty DESC, amount DESC LIMIT 5`,
    )
    .all(d) as { name: string; qty: number; amount: number }[];
  const shifts = db
    .prepare(
      `SELECT id, shift_no AS shiftNo, status, opened_at AS openedAt, opened_by AS openedBy, closed_at AS closedAt, closed_by AS closedBy,
              opening_cash AS openingCash, expected_cash AS expectedCash, counted_cash AS countedCash, diff, cash_in AS cashIn, cash_out AS cashOut
         FROM shifts WHERE business_date = ? ORDER BY id`,
    )
    .all(d);
  const exp = expenseTotal(d, d);
  const drawerExp = (db
    .prepare(`SELECT COALESCE(SUM(e.amount), 0) AS n FROM expenses e WHERE e.voided_at IS NULL AND e.source = 'drawer' AND e.expense_date = ?
                AND ((SELECT branch_id FROM temp.ctx) = 0 OR e.branch_id = (SELECT branch_id FROM temp.ctx))`)
    .get(d) as { n: number }).n;
  const shop = publicSettings().shop;
  return {
    date: d,
    shop: { name: shop.name, branchName: shop.branchName, branchCode: shop.branchCode },
    sales: { ...sales, total: round2(sales.total), subtotal: round2(sales.subtotal), discount: round2(sales.discount), vat: round2(sales.vat), fee: round2(sales.fee), units, aov: sales.bills ? round2(sales.total / sales.bills) : 0 },
    voids: { count: voids.n, amount: round2(voids.amount) },
    edits: { count: edits.n, refunded: round2(edits.refunded) },
    byMethod: byMethod.map((m) => ({ ...m, amount: round2(m.amount) })),
    top: top.map((t) => ({ ...t, amount: round2(t.amount) })),
    expenses: { total: exp.total, count: exp.count, drawer: round2(drawerExp), top: exp.top },
    shifts,
  };
}
