// กะการขาย: เปิดกะ / นำเงินเข้า-ออก / ปิดกะ + กระทบยอดเงินสดในลิ้นชัก
import { db, tx, countChanges } from './db.ts';
import { HttpError, PAYMENT_METHODS, round2 } from './common.ts';

const SHIFT_COLS = `id, shift_no AS shiftNo, business_date AS businessDate, status, opened_at AS openedAt,
  opened_by AS openedBy, opening_cash AS openingCash, opening_note AS openingNote, closed_at AS closedAt,
  closed_by AS closedBy, counted_cash AS countedCash, expected_cash AS expectedCash, diff,
  denominations, close_note AS closeNote, cash_sales AS cashSales, cash_in AS cashIn, cash_out AS cashOut,
  total_sales AS totalSales, bill_count AS billCount, tenders`;

const q = {
  current: db.prepare(`SELECT ${SHIFT_COLS} FROM shifts WHERE status = 'open' LIMIT 1`),
  byId: db.prepare(`SELECT ${SHIFT_COLS} FROM shifts WHERE id = ?`),
  countOnDate: db.prepare('SELECT COUNT(*) AS n FROM shifts WHERE business_date = ?'),
  insShift: db.prepare(
    `INSERT INTO shifts_all (shift_no, business_date, opened_by, opening_cash, opening_note) VALUES (?, ?, ?, ?, ?)`,
  ),
  closeShift: db.prepare(
    `UPDATE shifts SET status = 'closed', closed_at = datetime('now', 'localtime'), closed_by = ?, counted_cash = ?,
            expected_cash = ?, diff = ?, denominations = ?, close_note = ?, cash_sales = ?, cash_in = ?, cash_out = ?,
            total_sales = ?, bill_count = ?, tenders = ?
      WHERE id = ? AND status = 'open'`,
  ),
  payByMethod: db.prepare('SELECT method, COALESCE(SUM(amount), 0) AS amount, COUNT(DISTINCT order_id) AS n FROM payments WHERE shift_id = ? GROUP BY method'),
  moveSums: db.prepare("SELECT kind, COALESCE(SUM(amount), 0) AS amount FROM cash_movements WHERE shift_id = ? GROUP BY kind"),
  moves: db.prepare(
    'SELECT id, kind, amount, reason, staff, created_at AS createdAt FROM cash_movements WHERE shift_id = ? ORDER BY id DESC',
  ),
  insMove: db.prepare('INSERT INTO cash_movements_all (shift_id, kind, amount, reason, staff) VALUES (?, ?, ?, ?, ?)'),
  billCount: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE shift_id = ?"),
  voidCount: db.prepare("SELECT COUNT(*) AS n FROM payments WHERE shift_id = ? AND kind = 'void'"),
  editCount: db.prepare("SELECT COUNT(*) AS n FROM payments WHERE shift_id = ? AND kind = 'edit'"),
  cashRefunds: db.prepare(
    "SELECT COALESCE(SUM(-amount), 0) AS n FROM payments WHERE shift_id = ? AND method = 'cash' AND amount < 0",
  ),
  insPayment: db.prepare('INSERT INTO payments_all (shift_id, order_id, kind, method, amount) VALUES (?, ?, ?, ?, ?)'),
  lastClosed: db.prepare(`SELECT counted_cash AS countedCash FROM shifts WHERE status = 'closed' ORDER BY id DESC LIMIT 1`),
};

export interface ShiftRow {
  id: number; shiftNo: number; businessDate: string; status: 'open' | 'closed'; openedAt: string; openedBy: string;
  openingCash: number; openingNote: string | null; closedAt: string | null; closedBy: string | null;
  countedCash: number | null; expectedCash: number | null; diff: number | null; denominations: string | null;
  closeNote: string | null; cashSales: number | null; cashIn: number | null; cashOut: number | null;
  totalSales: number | null; billCount: number | null; tenders: string | null;
}

/** ช่องทางที่ไม่ใช่เงินสด — เงินไม่เข้าลิ้นชัก ตรวจยอดกับสลิปสรุปเครื่อง EDC / รายการเงินเข้าบัญชีแทน */
/**
 * ช่องตรวจยอดตอนปิดกะ (ไม่ใช่เงินสด) — รวมช่องทางที่ตรวจจากแหล่งเดียวกัน
 *  - บัตรเครดิต + บัตรเดบิต: สลิปสรุปยอด (Settlement) ของเครื่อง EDC
 *  - สแกนจ่าย (QR พร้อมเพย์ + โอน): ยอดเงินเข้าบัญชีร้าน
 */
export const TENDER_GROUPS = [
  { id: 'card', label: 'บัตรเครดิต + บัตรเดบิต', methods: ['card'] },
  { id: 'scan', label: 'สแกนจ่าย', methods: ['promptpay', 'transfer'] },
] as const;
export type Tender = { label?: string; system: number; count: number; actual: number; diff: number };

/** ตัวเลขสดของกะ (คำนวณจากสมุดรับจ่าย) */
function live(shiftId: number, openingCash: number) {
  const byMethod: Record<string, number> = { cash: 0, promptpay: 0, card: 0, transfer: 0 };
  const countByMethod: Record<string, number> = { cash: 0, promptpay: 0, card: 0, transfer: 0 };
  for (const r of q.payByMethod.all(shiftId) as { method: string; amount: number; n: number }[]) {
    byMethod[r.method] = round2(r.amount);
    countByMethod[r.method] = r.n;
  }
  const moves = { in: 0, out: 0 };
  for (const r of q.moveSums.all(shiftId) as { kind: 'in' | 'out'; amount: number }[]) moves[r.kind] = round2(r.amount);
  const cashSales = byMethod.cash;
  const totalSales = round2(Object.values(byMethod).reduce((a, b) => a + b, 0));
  const netCash = round2(cashSales + moves.in - moves.out); // "สรุปยอด" = เงินสดที่เพิ่มขึ้นในลิ้นชัก
  return {
    byMethod,
    countByMethod,
    cashSales,
    cashIn: moves.in,
    cashOut: moves.out,
    netCash,
    expectedCash: round2(openingCash + netCash),
    totalSales,
    billCount: (q.billCount.get(shiftId) as { n: number }).n,
    editCount: (q.editCount.get(shiftId) as { n: number }).n,
    voidCount: (q.voidCount.get(shiftId) as { n: number }).n,
    cashRefunds: round2((q.cashRefunds.get(shiftId) as { n: number }).n),
  };
}

function minutesBetween(a: string, b: string) {
  const t = (s: string) => new Date(s.replace(' ', 'T')).getTime();
  return Math.max(0, Math.round((t(b) - t(a)) / 60000));
}

function nowLocal() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** สถานะผลกระทบยอด */
export function verdict(diff: number | null) {
  if (diff == null) return 'open';
  return diff === 0 ? 'match' : diff > 0 ? 'over' : 'short';
}

/** รวมข้อมูลกะให้พร้อมแสดงผล (กะที่ปิดแล้วใช้ snapshot, กะที่เปิดอยู่คำนวณสด) */
function present(s: ShiftRow) {
  const l = live(s.id, s.openingCash);
  const closed = s.status === 'closed';
  const cashSales = closed ? s.cashSales ?? l.cashSales : l.cashSales;
  const cashIn = closed ? s.cashIn ?? l.cashIn : l.cashIn;
  const cashOut = closed ? s.cashOut ?? l.cashOut : l.cashOut;
  const expectedCash = closed ? s.expectedCash ?? l.expectedCash : l.expectedCash;
  // ยอดจริงบัตร / QR / โอน (กะที่ปิดก่อนมีฟีเจอร์นี้ = null → แสดงยอดระบบอย่างเดียว)
  let tenders: Record<string, Tender> | null = null;
  try {
    tenders = s.tenders ? JSON.parse(s.tenders) : null;
  } catch {
    tenders = null;
  }
  const tenderDiff = tenders ? round2(Object.values(tenders).reduce((a, t) => a + (t.diff || 0), 0)) : null;
  return {
    ...s,
    denominations: s.denominations ? JSON.parse(s.denominations) : null,
    cashSales,
    cashIn,
    cashOut,
    netCash: round2(cashSales + cashIn - cashOut),
    expectedCash,
    totalSales: closed ? s.totalSales ?? l.totalSales : l.totalSales,
    billCount: closed ? s.billCount ?? l.billCount : l.billCount,
    byMethod: l.byMethod,
    countByMethod: l.countByMethod,
    tenders,
    tenderDiff,
    editCount: l.editCount,
    voidCount: l.voidCount,
    cashRefunds: l.cashRefunds,
    minutes: minutesBetween(s.openedAt, s.closedAt ?? nowLocal()),
    verdict: verdict(closed ? s.diff : null),
  };
}

// ---------------- API ----------------
export function currentShiftRow() {
  return q.current.get() as ShiftRow | undefined;
}

/** ใช้ตอนขาย/แก้บิล — ต้องมีกะเปิดอยู่ */
export function requireShift() {
  const s = currentShiftRow();
  if (!s) throw new HttpError(409, 'ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนทำรายการ', 'NO_SHIFT');
  return s;
}

/** บันทึกรับ/จ่ายเงินลงกะปัจจุบัน */
export function recordPayment(shiftId: number, orderId: number, kind: 'sale' | 'edit' | 'void', method: string, amount: number) {
  if (amount === 0) return;
  q.insPayment.run(shiftId, orderId, kind, method, round2(amount));
}

export function currentShift() {
  const s = currentShiftRow();
  if (!s) {
    const last = q.lastClosed.get() as { countedCash: number } | undefined;
    return { shift: null, suggestOpening: last?.countedCash ?? 0 };
  }
  return { shift: present(s), moves: q.moves.all(s.id) };
}

export function shiftBrief() {
  const s = currentShiftRow();
  return s ? { id: s.id, shiftNo: s.shiftNo, openedAt: s.openedAt, openedBy: s.openedBy } : null;
}

/** ชนิดธนบัตร/เหรียญที่ร้านใช้ (ไม่รับ 50 / 25 สตางค์) */
export const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

/** เก็บเฉพาะชนิดที่ใช้งาน + จำนวนเต็มบวก — กันข้อมูลแปลก ๆ หลุดลงฐานข้อมูล */
function cleanDenoms(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const d of DENOMINATIONS) {
    const n = Math.floor(Number((raw as Record<string, unknown>)[String(d)]));
    if (Number.isFinite(n) && n > 0) out[d] = Math.min(n, 99999);
  }
  return Object.keys(out).length ? out : null;
}

// ล้างเหรียญ 50 / 25 สตางค์ ออกจากกะที่บันทึกไว้แล้ว (รันซ้ำได้ ไม่มีผลถ้าไม่มีข้อมูลนี้)
db.exec(`UPDATE shifts_all SET denominations = NULLIF(json_remove(denominations, '$."0.5"', '$."0.25"'), '{}')
          WHERE denominations IS NOT NULL AND json_valid(denominations)
            AND (json_type(denominations, '$."0.5"') IS NOT NULL OR json_type(denominations, '$."0.25"') IS NOT NULL)`);

export function openShift(body: { staff?: string; openingCash?: number; note?: string; denominations?: unknown }) {
  const staff = body.staff?.trim();
  const cash = round2(Number(body.openingCash));
  if (!staff) throw new HttpError(422, 'กรุณาเลือกพนักงานผู้เปิดกะ');
  if (!Number.isFinite(cash) || cash < 0) throw new HttpError(422, 'จำนวนเงินเปิดกะไม่ถูกต้อง');
  if (currentShiftRow()) throw new HttpError(409, 'มีกะที่เปิดอยู่แล้ว กรุณาปิดกะเดิมก่อน');
  const date = nowLocal().slice(0, 10);
  const id = tx(() => {
    const { n } = q.countOnDate.get(date) as { n: number };
    return Number(q.insShift.run(n + 1, date, staff.slice(0, 80), cash, body.note?.trim().slice(0, 200) || null).lastInsertRowid);
  });
  return present(q.byId.get(id) as ShiftRow);
}

export function cashMove(body: { kind?: string; amount?: number; reason?: string; staff?: string }) {
  const s = requireShift();
  const kind = body.kind === 'in' || body.kind === 'out' ? body.kind : null;
  const amount = round2(Number(body.amount));
  const reason = body.reason?.trim();
  const staff = body.staff?.trim();
  if (!kind) throw new HttpError(400, 'ประเภทรายการไม่ถูกต้อง');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(422, 'กรุณาระบุจำนวนเงิน');
  if (!reason) throw new HttpError(422, 'กรุณาระบุเหตุผล');
  if (!staff) throw new HttpError(422, 'กรุณาเลือกพนักงาน');
  if (kind === 'out') {
    const l = live(s.id, s.openingCash);
    if (amount > l.expectedCash) throw new HttpError(422, `เงินในลิ้นชักมีประมาณ ฿${l.expectedCash.toLocaleString()} เท่านั้น`);
  }
  q.insMove.run(s.id, kind, amount, reason.slice(0, 200), staff.slice(0, 80));
  return currentShift();
}

export function closeShift(body: { staff?: string; countedCash?: number; denominations?: unknown; note?: string; tenders?: unknown }) {
  const s = requireShift();
  const staff = body.staff?.trim();
  const counted = round2(Number(body.countedCash));
  if (!staff) throw new HttpError(422, 'กรุณาเลือกพนักงานผู้ปิดกะ');
  if (!Number.isFinite(counted) || counted < 0) throw new HttpError(422, 'กรุณากรอกจำนวนเงินที่นับได้');
  const l = live(s.id, s.openingCash);
  const diff = round2(counted - l.expectedCash);
  // ช่องที่ 2: บัตร / สแกนจ่าย — กรอกยอดจริงจากสลิปสรุปเครื่อง EDC / ยอดเงินเข้าบัญชี (ไม่นับรวมกับลิ้นชัก)
  const raw = body.tenders && typeof body.tenders === 'object' ? (body.tenders as Record<string, unknown>) : {};
  const tenders: Record<string, Tender> = {};
  for (const g of TENDER_GROUPS) {
    const system = round2(g.methods.reduce((a, m) => a + (l.byMethod[m] ?? 0), 0));
    const count = g.methods.reduce((a, m) => a + (l.countByMethod[m] ?? 0), 0);
    const given = raw[g.id];
    if (given == null || given === '') {
      if (system !== 0) throw new HttpError(422, `กรุณากรอกยอดจริงของ ${g.label}`);
      continue; // ไม่มีรายการและไม่ได้กรอก → ไม่ต้องบันทึก
    }
    const actual = round2(Number(given));
    if (!Number.isFinite(actual) || actual < 0) throw new HttpError(422, `ยอดจริงของ ${g.label} ไม่ถูกต้อง`);
    tenders[g.id] = { label: g.label, system, count, actual, diff: round2(actual - system) };
  }
  const tenderMismatch = Object.values(tenders).some((t) => t.diff !== 0);
  const note = body.note?.trim() || null;
  if ((diff !== 0 || tenderMismatch) && !note)
    throw new HttpError(422, diff !== 0 ? 'ยอดเงินสดไม่ตรง กรุณาระบุหมายเหตุ' : 'ยอดบัตร / สแกนจ่าย ไม่ตรง กรุณาระบุหมายเหตุ');
  const clean = cleanDenoms(body.denominations);
  const denoms = clean ? JSON.stringify(clean) : null;
  const n = countChanges(() =>
    q.closeShift.run(
      staff.slice(0, 80), counted, l.expectedCash, diff, denoms, note?.slice(0, 300) ?? null,
      l.cashSales, l.cashIn, l.cashOut, l.totalSales, l.billCount, JSON.stringify(tenders), s.id,
    ),
  );
  if (n !== 1) throw new HttpError(409, 'กะนี้ถูกปิดไปแล้ว');
  return present(q.byId.get(s.id) as ShiftRow);
}

export function shiftDetail(id: number) {
  const s = q.byId.get(id) as ShiftRow | undefined;
  if (!s) throw new HttpError(404, 'ไม่พบกะนี้');
  const orders = db
    .prepare(
      `SELECT id, order_no AS orderNo, created_at AS createdAt, total, payment_method AS paymentMethod, status
         FROM orders WHERE shift_id = ? ORDER BY id DESC LIMIT 300`,
    )
    .all(id);
  const adjustments = db
    .prepare(
      `SELECT p.id, p.kind, p.method, p.amount, p.created_at AS createdAt, o.order_no AS orderNo
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.shift_id = ? AND p.kind != 'sale' ORDER BY p.id DESC`,
    )
    .all(id);
  return { shift: present(s), moves: q.moves.all(id), orders, adjustments };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function listShifts(f: { from?: string; to?: string; limit?: number; offset?: number }) {
  const conds: string[] = [];
  const args: string[] = [];
  if (f.from && DATE.test(f.from)) { conds.push('business_date >= ?'); args.push(f.from); }
  if (f.to && DATE.test(f.to)) { conds.push('business_date <= ?'); args.push(f.to); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const rows = (db.prepare(`SELECT ${SHIFT_COLS} FROM shifts ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as ShiftRow[]).map(present);
  const all = (db.prepare(`SELECT ${SHIFT_COLS} FROM shifts ${where}`).all(...args) as ShiftRow[]).map(present);
  const closed = all.filter((x) => x.status === 'closed');
  const summary = {
    count: all.length,
    totalSales: round2(all.reduce((a, x) => a + x.totalSales, 0)),
    cashSales: round2(all.reduce((a, x) => a + x.cashSales, 0)),
    match: closed.filter((x) => x.verdict === 'match').length,
    short: closed.filter((x) => x.verdict === 'short').length,
    over: closed.filter((x) => x.verdict === 'over').length,
    netDiff: round2(closed.reduce((a, x) => a + (x.diff ?? 0), 0)),
  };
  return { rows, summary, limit, offset };
}

export { PAYMENT_METHODS };
