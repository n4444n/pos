// ค่าใช้จ่ายร้าน + สมุดเงินสดในลิ้นชัก
// - ค่าใช้จ่ายทุกประเภท (ค่าเช่า ค่าไฟ เงินเดือน ซื้อของ …) แยกตามสาขา
// - จ่ายจาก "เงินสดในลิ้นชัก" → ลงเป็นเงินออกของกะที่เปิดอยู่อัตโนมัติ (ยอดที่ควรมีในลิ้นชักตรงเสมอ)
// - สมุดลิ้นชัก: ทุกการเคลื่อนไหวของเงินสดในกะ (ตั้งต้น ขาย คืนเงิน นำเข้า/ออก ค่าใช้จ่าย) พร้อมยอดคงเหลือ
import { countChanges, currentBranch, db, tx } from './db.ts';
import { HttpError, round2 } from './common.ts';
import { requireShift } from './shifts.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id     INTEGER NOT NULL,
    expense_date  TEXT NOT NULL,                       -- YYYY-MM-DD
    category      TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    amount        REAL NOT NULL CHECK (amount > 0),
    source        TEXT NOT NULL,                       -- drawer | transfer | card | owner
    vendor        TEXT NOT NULL DEFAULT '',
    ref_no        TEXT NOT NULL DEFAULT '',
    photo         TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    shift_id      INTEGER,
    cash_move_id  INTEGER,
    staff         TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    voided_at     TEXT,
    voided_by     TEXT,
    void_reason   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON expenses(branch_id, expense_date);
`);
if (!(db.prepare('PRAGMA table_info(expenses)').all() as { name: string }[]).some((c) => c.name === 'void_move_id'))
  db.exec('ALTER TABLE expenses ADD COLUMN void_move_id INTEGER'); // รายการ "คืนเงินเข้าลิ้นชัก" ตอนยกเลิก

// รายการย่อยในบิลค่าใช้จ่าย (เหมือนระบบเดิม: รายละเอียด · หมวด · จำนวน/หน่วย · ราคา/หน่วย · ราคา)
db.exec(`
  CREATE TABLE IF NOT EXISTS expense_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    line_no     INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL,
    qty         REAL NOT NULL CHECK (qty > 0),
    unit        TEXT NOT NULL DEFAULT '',
    unit_price  REAL NOT NULL CHECK (unit_price >= 0),
    amount      REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expense_items_exp ON expense_items(expense_id);
  -- ค่าใช้จ่ายที่บันทึกก่อนมีรายการย่อย → 1 รายการ
  INSERT INTO expense_items (expense_id, line_no, description, category, qty, unit, unit_price, amount)
    SELECT e.id, 1, e.description, e.category, 1, 'รายการ', e.amount, e.amount FROM expenses e
     WHERE NOT EXISTS (SELECT 1 FROM expense_items i WHERE i.expense_id = e.id);
`);

// ---------- หมวดค่าใช้จ่าย (แก้ได้ที่หน้าค่าใช้จ่าย) ----------
export interface ExpenseCategory { id: string; name: string; icon: string; color: string }
const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  { id: 'rent', name: 'ค่าเช่าที่', icon: '🏠', color: '#6B4EFF' },
  { id: 'utility', name: 'ค่าน้ำ ไฟ อินเทอร์เน็ต', icon: '💡', color: '#F5A524' },
  { id: 'salary', name: 'เงินเดือน / ค่าแรง', icon: '👥', color: '#2F6BFF' },
  { id: 'stock', name: 'ซื้อสินค้าเข้าร้าน', icon: '📦', color: '#1F9D63' },
  { id: 'supplies', name: 'วัสดุสิ้นเปลือง (ถุง แท็ก ไม้แขวน)', icon: '🛍️', color: '#0E9AA7' },
  { id: 'shipping', name: 'ค่าขนส่ง / ไปรษณีย์', icon: '🚚', color: '#D98200' },
  { id: 'marketing', name: 'การตลาด / โฆษณา', icon: '📣', color: '#D23B7E' },
  { id: 'repair', name: 'ซ่อมบำรุง / อุปกรณ์', icon: '🔧', color: '#64748B' },
  { id: 'food', name: 'อาหาร / เครื่องดื่ม', icon: '🍱', color: '#E5484D' },
  { id: 'fee', name: 'ค่าธรรมเนียม ธนาคาร / แพลตฟอร์ม', icon: '🏦', color: '#475569' },
  { id: 'other', name: 'อื่น ๆ', icon: '📝', color: '#94A3B8' },
];
export const EXPENSE_SOURCES = {
  drawer: 'เงินสดในลิ้นชัก',
  transfer: 'โอนจากบัญชีร้าน',
  card: 'บัตรเครดิต / เดบิต',
  owner: 'เงินสดนอกลิ้นชัก / เจ้าของสำรองจ่าย',
} as const;
type Source = keyof typeof EXPENSE_SOURCES;

export function expenseCategories(): ExpenseCategory[] {
  const r = db.prepare("SELECT value FROM settings WHERE section = 'expenseCategories'").get() as { value: string } | undefined;
  try {
    const v = r ? JSON.parse(r.value) : null;
    return Array.isArray(v) && v.length ? v : DEFAULT_CATEGORIES;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}
export function saveExpenseCategories(body: unknown) {
  const list = (Array.isArray(body) ? body : (body as { categories?: unknown })?.categories) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(list) || !list.length) throw new HttpError(422, 'ต้องมีอย่างน้อย 1 หมวด');
  const seen = new Set<string>();
  const out: ExpenseCategory[] = [];
  for (const c of list.slice(0, 40)) {
    const name = String(c?.name ?? '').trim().slice(0, 60);
    if (!name) continue;
    let id = String(c?.id ?? '').trim().replace(/[^\w-]/g, '').slice(0, 30) || `c${Date.now().toString(36)}${out.length}`;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    out.push({
      id, name, icon: String(c?.icon ?? '📝').slice(0, 8) || '📝',
      color: /^#[0-9a-fA-F]{6}$/.test(String(c?.color)) ? String(c.color) : '#94A3B8',
    });
  }
  if (!out.length) throw new HttpError(422, 'ต้องมีอย่างน้อย 1 หมวด');
  db.prepare(
    `INSERT INTO settings (section, value) VALUES ('expenseCategories', ?)
     ON CONFLICT(section) DO UPDATE SET value = excluded.value, updated_at = datetime('now', 'localtime')`,
  ).run(JSON.stringify(out));
  return out;
}

// ---------- อ่าน ----------
const BR = `((SELECT branch_id FROM temp.ctx) = 0 OR e.branch_id = (SELECT branch_id FROM temp.ctx))`;
const COLS = `e.id, e.branch_id AS branchId, b.name AS branchName, e.expense_date AS date, e.category, e.description, e.amount, e.source,
  e.vendor, e.ref_no AS refNo, e.photo, e.note, e.shift_id AS shiftId, sh.shift_no AS shiftNo, sh.status AS shiftStatus,
  e.cash_move_id AS cashMoveId, e.staff, e.created_at AS createdAt, e.updated_at AS updatedAt,
  e.voided_at AS voidedAt, e.voided_by AS voidedBy, e.void_reason AS voidReason`;
const FROM = `FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN shifts_all sh ON sh.id = e.shift_id`;

export interface ExpenseItem { description: string; category: string; qty: number; unit: string; unitPrice: number; amount: number }
export interface ExpenseRow {
  items?: ExpenseItem[];
  id: number; branchId: number; branchName: string; date: string; category: string; description: string; amount: number; source: Source;
  vendor: string; refNo: string; photo: string; note: string; shiftId: number | null; shiftNo: number | null; shiftStatus: string | null;
  cashMoveId: number | null; staff: string; createdAt: string; updatedAt: string; voidedAt: string | null; voidedBy: string | null; voidReason: string | null;
}

export interface ExpenseQuery { from?: string; to?: string; category?: string; source?: string; q?: string; voided?: string }
function where(f: ExpenseQuery) {
  const conds = [BR];
  const args: (string | number)[] = [];
  if (f.from) { conds.push('e.expense_date >= ?'); args.push(f.from); }
  if (f.to) { conds.push('e.expense_date <= ?'); args.push(f.to); }
  if (f.category) { conds.push('EXISTS (SELECT 1 FROM expense_items i WHERE i.expense_id = e.id AND i.category = ?)'); args.push(f.category); }
  if (f.source && f.source in EXPENSE_SOURCES) { conds.push('e.source = ?'); args.push(f.source); }
  if (f.q?.trim()) {
    conds.push("(e.description LIKE ? OR e.vendor LIKE ? OR e.ref_no LIKE ? OR e.note LIKE ? OR e.staff LIKE ? OR EXISTS (SELECT 1 FROM expense_items i WHERE i.expense_id = e.id AND i.description LIKE ?))");
    const like = `%${f.q.trim()}%`;
    args.push(like, like, like, like, like, like);
  }
  return { sql: 'WHERE ' + conds.join(' AND '), args };
}

export function listExpenses(f: ExpenseQuery) {
  const w = where(f);
  const showVoid = f.voided === '1';
  const rows = db
    .prepare(`SELECT ${COLS} ${FROM} ${w.sql} ${showVoid ? '' : 'AND e.voided_at IS NULL'} ORDER BY e.expense_date DESC, e.id DESC LIMIT 1000`)
    .all(...w.args) as unknown as ExpenseRow[];
  attachItems(rows);
  const live = `${w.sql} AND e.voided_at IS NULL`;
  const tot = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(e.amount), 0) AS total ${FROM} ${live}`).get(...w.args) as { count: number; total: number };
  const bySource = db.prepare(`SELECT e.source, COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS count ${FROM} ${live} GROUP BY e.source`).all(...w.args) as { source: string; total: number; count: number }[];
  const byCategory = db
    .prepare(
      `SELECT i.category, COALESCE(SUM(i.amount), 0) AS total, COUNT(*) AS count
         FROM expense_items i JOIN expenses e ON e.id = i.expense_id LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN shifts_all sh ON sh.id = e.shift_id
         ${live} ${f.category ? 'AND i.category = ?' : ''} GROUP BY i.category ORDER BY total DESC`,
    )
    .all(...w.args, ...(f.category ? [f.category] : [])) as { category: string; total: number; count: number }[];
  const byDay = db
    .prepare(`SELECT e.expense_date AS date, COALESCE(SUM(e.amount), 0) AS total ${FROM} ${live} GROUP BY e.expense_date ORDER BY e.expense_date`)
    .all(...w.args) as { date: string; total: number }[];
  return {
    rows,
    summary: { count: tot.count, total: round2(tot.total), bySource, byCategory, byDay },
    categories: expenseCategories(),
    sources: EXPENSE_SOURCES,
  };
}

const ITEM_COLS = 'expense_id AS expenseId, description, category, qty, unit, unit_price AS unitPrice, amount';
function attachItems(rows: ExpenseRow[]) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const items = db
    .prepare(`SELECT ${ITEM_COLS} FROM expense_items WHERE expense_id IN (${ids.map(() => '?').join(',')}) ORDER BY expense_id, line_no`)
    .all(...ids) as unknown as (ExpenseItem & { expenseId: number })[];
  const by = new Map<number, ExpenseItem[]>();
  for (const { expenseId, ...it } of items) by.set(expenseId, [...(by.get(expenseId) ?? []), it]);
  for (const r of rows) r.items = by.get(r.id) ?? [];
  return rows;
}
const getRow = (id: number) => {
  const r = db.prepare(`SELECT ${COLS} ${FROM} WHERE e.id = ? AND ${BR}`).get(id) as unknown as ExpenseRow | undefined;
  return r ? attachItems([r])[0] : undefined;
};

/** ยอดค่าใช้จ่ายรวมในช่วงวันที่ (รายงาน) — ตามสาขาปัจจุบัน (0 = ทุกสาขา) */
export function expenseTotal(from: string, to: string) {
  const r = db
    .prepare(`SELECT COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS count FROM expenses e WHERE ${BR} AND e.voided_at IS NULL AND e.expense_date BETWEEN ? AND ?`)
    .get(from, to) as { total: number; count: number };
  const top = db
    .prepare(
      `SELECT i.category, SUM(i.amount) AS total FROM expense_items i JOIN expenses e ON e.id = i.expense_id
        WHERE ${BR} AND e.voided_at IS NULL AND e.expense_date BETWEEN ? AND ?
        GROUP BY i.category ORDER BY total DESC LIMIT 5`,
    )
    .all(from, to) as { category: string; total: number }[];
  const cats = expenseCategories();
  return {
    total: round2(r.total), count: r.count,
    top: top.map((t) => ({ ...t, total: round2(t.total), name: cats.find((c) => c.id === t.category)?.name ?? t.category })),
  };
}

// ---------- บันทึก ----------
interface ItemBody { description?: string; category?: string; qty?: number | string; unit?: string; unitPrice?: number | string }
interface ExpenseBody {
  items?: ItemBody[];
  date?: string; category?: string; description?: string; amount?: number | string; source?: string;
  vendor?: string; refNo?: string; photo?: string; note?: string;
}
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const num = (v: unknown) => Number(String(v ?? '').replace(/,/g, ''));
function clean(b: ExpenseBody) {
  const cats = expenseCategories();
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? id;
  // รูปแบบเดิม (ยอดเดียว) → 1 รายการ
  const raw: ItemBody[] = Array.isArray(b.items) && b.items.length
    ? b.items
    : [{ description: b.description, category: b.category, qty: 1, unit: 'รายการ', unitPrice: b.amount }];
  if (raw.length > 50) throw new HttpError(422, 'รายการมากเกินไป (สูงสุด 50 รายการ)');
  const items: ExpenseItem[] = [];
  raw.forEach((it, i) => {
    const qty = round2(num(it?.qty ?? 1));
    const unitPrice = round2(num(it?.unitPrice));
    const description = str(it?.description, 200);
    // แถวว่าง (ยังไม่กรอกอะไร) → ข้าม
    if (!description && !(unitPrice > 0) && !it?.category) return;
    const n = i + 1;
    const category = cats.some((c) => c.id === it?.category) ? String(it!.category) : '';
    if (!category) throw new HttpError(422, `รายการที่ ${n}: กรุณาเลือกหมวดหมู่`);
    if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(422, `รายการที่ ${n}: จำนวนต้องมากกว่า 0`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new HttpError(422, `รายการที่ ${n}: ราคาต่อหน่วยไม่ถูกต้อง`);
    items.push({ description: description || catName(category), category, qty, unit: str(it?.unit, 20), unitPrice, amount: round2(qty * unitPrice) });
  });
  if (!items.length) throw new HttpError(422, 'กรุณาเพิ่มรายการค่าใช้จ่ายอย่างน้อย 1 รายการ');
  const amount = round2(items.reduce((a, x) => a + x.amount, 0));
  if (!(amount > 0)) throw new HttpError(422, 'ยอดรวมต้องมากกว่า 0');
  if (amount > 10_000_000) throw new HttpError(422, 'จำนวนเงินมากเกินไป');
  const source = (String(b.source) in EXPENSE_SOURCES ? b.source : 'drawer') as Source;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : today();
  const photo = str(b.photo, 300);
  // หัวบิล: หมวด = หมวดของยอดมากที่สุด · รายละเอียด = รายการแรก (+ อีก n รายการ)
  const byCat = new Map<string, number>();
  for (const x of items) byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.amount);
  const category = [...byCat.entries()].sort((a, c) => c[1] - a[1])[0][0];
  const description = (items.length > 1 ? `${items[0].description} และอีก ${items.length - 1} รายการ` : items[0].description).slice(0, 200);
  return {
    date, category, amount, source, items, description,
    vendor: str(b.vendor, 100), refNo: str(b.refNo, 60),
    photo: /^\/uploads\/[\w.-]+$/.test(photo) ? photo : '', note: str(b.note, 500),
  };
}
const saveItems = (expenseId: number, items: ExpenseItem[]) => {
  db.prepare('DELETE FROM expense_items WHERE expense_id = ?').run(expenseId);
  const ins = db.prepare('INSERT INTO expense_items (expense_id, line_no, description, category, qty, unit, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  items.forEach((x, i) => ins.run(expenseId, i + 1, x.description, x.category, x.qty, x.unit, x.unitPrice, x.amount));
};
const reasonOf = (e: { category: string; description: string; items?: ExpenseItem[] }) => {
  const cats = expenseCategories();
  const names = [...new Set((e.items?.length ? e.items.map((x) => x.category) : [e.category]).map((id) => cats.find((c) => c.id === id)?.name ?? id))];
  return `ค่าใช้จ่าย: ${names.join(', ')} — ${e.description}`.slice(0, 200);
};
const insMove = () => db.prepare('INSERT INTO cash_movements_all (shift_id, kind, amount, reason, staff) VALUES (?, ?, ?, ?, ?)');
const shiftOpen = (id: number | null) =>
  !!id && !!db.prepare("SELECT 1 FROM shifts_all WHERE id = ? AND status = 'open'").get(id);

function drawerBalance(shiftId: number, opening: number) {
  const cash = (db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM payments_all WHERE shift_id = ? AND method = 'cash'").get(shiftId) as { n: number }).n;
  const mv = db.prepare("SELECT kind, COALESCE(SUM(amount), 0) AS n FROM cash_movements_all WHERE shift_id = ? GROUP BY kind").all(shiftId) as { kind: string; n: number }[];
  const inn = mv.find((m) => m.kind === 'in')?.n ?? 0;
  const out = mv.find((m) => m.kind === 'out')?.n ?? 0;
  return round2(opening + cash + inn - out);
}

export function createExpense(body: ExpenseBody, staff: string) {
  if (!currentBranch()) throw new HttpError(422, 'กรุณาเลือกสาขาก่อนบันทึกค่าใช้จ่าย');
  const e = clean(body);
  return tx(() => {
    let shiftId: number | null = null;
    let moveId: number | null = null;
    if (e.source === 'drawer') {
      const sh = requireShift();
      const bal = drawerBalance(sh.id, sh.openingCash);
      if (e.amount > bal) throw new HttpError(422, `เงินในลิ้นชักมีประมาณ ฿${bal.toLocaleString()} เท่านั้น — เลือกจ่ายจากแหล่งอื่น หรือนำเงินเข้าลิ้นชักก่อน`);
      shiftId = sh.id;
      e.date = today(); // เงินออกจากลิ้นชักวันนี้
      moveId = Number(insMove().run(sh.id, 'out', e.amount, reasonOf(e), staff.slice(0, 80)).lastInsertRowid);
    }
    const r = db
      .prepare(
        `INSERT INTO expenses (branch_id, expense_date, category, description, amount, source, vendor, ref_no, photo, note, shift_id, cash_move_id, staff)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(currentBranch(), e.date, e.category, e.description, e.amount, e.source, e.vendor, e.refNo, e.photo, e.note, shiftId, moveId, staff.slice(0, 80));
    saveItems(Number(r.lastInsertRowid), e.items);
    return getRow(Number(r.lastInsertRowid))!;
  });
}

export function updateExpense(id: number, body: ExpenseBody, staff: string) {
  const cur = getRow(id);
  if (!cur) throw new HttpError(404, 'ไม่พบรายการ');
  if (cur.voidedAt) throw new HttpError(409, 'รายการนี้ถูกยกเลิกแล้ว');
  const e = clean({ ...body, date: body.date ?? cur.date });
  const moneyChanged = e.amount !== cur.amount || e.source !== cur.source;
  return tx(() => {
    let shiftId = cur.shiftId;
    let moveId = cur.cashMoveId;
    if (cur.source === 'drawer' || e.source === 'drawer') {
      if (moneyChanged) {
        // แก้ยอด/แหล่งเงินของรายการลิ้นชัก ทำได้เฉพาะตอนกะนั้นยังเปิดอยู่
        if (cur.source === 'drawer' && !shiftOpen(cur.shiftId))
          throw new HttpError(409, `กะ #${cur.shiftNo ?? ''} ปิดไปแล้ว — แก้จำนวนเงิน/แหล่งเงินไม่ได้ (ยกเลิกรายการแล้วบันทึกใหม่แทน)`);
        if (cur.source === 'drawer' && cur.cashMoveId) {
          countChanges(() => db.prepare('DELETE FROM cash_movements WHERE id = ?').run(cur.cashMoveId));
          moveId = null;
          shiftId = null;
        }
        if (e.source === 'drawer') {
          const sh = requireShift();
          const bal = drawerBalance(sh.id, sh.openingCash);
          if (e.amount > bal) throw new HttpError(422, `เงินในลิ้นชักมีประมาณ ฿${bal.toLocaleString()} เท่านั้น`);
          moveId = Number(insMove().run(sh.id, 'out', e.amount, reasonOf(e), staff.slice(0, 80)).lastInsertRowid);
          shiftId = sh.id;
          e.date = cur.source === 'drawer' ? cur.date : today();
        }
      } else if (cur.cashMoveId && shiftOpen(cur.shiftId)) {
        db.prepare('UPDATE cash_movements_all SET reason = ? WHERE id = ?').run(reasonOf(e), cur.cashMoveId);
      }
      if (e.source === 'drawer' && cur.source === 'drawer' && !moneyChanged) e.date = cur.date; // วันที่ = วันที่เงินออกจากลิ้นชัก
    }
    db.prepare(
      `UPDATE expenses SET expense_date = ?, category = ?, description = ?, amount = ?, source = ?, vendor = ?, ref_no = ?, photo = ?, note = ?,
              shift_id = ?, cash_move_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
    ).run(e.date, e.category, e.description, e.amount, e.source, e.vendor, e.refNo, e.photo, e.note, shiftId, moveId, id);
    saveItems(id, e.items);
    return getRow(id)!;
  });
}

/** ยกเลิกรายการ: ถ้าจ่ายจากลิ้นชักและกะยังเปิด → ลงรายการ "นำเงินคืนลิ้นชัก" ให้ยอดลิ้นชักถูกต้อง */
export function voidExpense(id: number, reason: string, staff: string) {
  const cur = getRow(id);
  if (!cur) throw new HttpError(404, 'ไม่พบรายการ');
  if (cur.voidedAt) throw new HttpError(409, 'รายการนี้ถูกยกเลิกแล้ว');
  const why = String(reason ?? '').trim().slice(0, 200);
  if (!why) throw new HttpError(422, 'กรุณาระบุเหตุผลที่ยกเลิก');
  return tx(() => {
    let refunded = false;
    let voidMove: number | null = null;
    if (cur.source === 'drawer' && cur.cashMoveId && shiftOpen(cur.shiftId)) {
      voidMove = Number(insMove().run(cur.shiftId, 'in', cur.amount, `ยกเลิกค่าใช้จ่าย #${cur.id}: ${cur.description} (${why})`.slice(0, 200), staff.slice(0, 80)).lastInsertRowid);
      refunded = true;
    }
    db.prepare("UPDATE expenses SET voided_at = datetime('now', 'localtime'), voided_by = ?, void_reason = ?, void_move_id = ? WHERE id = ?").run(staff.slice(0, 80), why, voidMove, id);
    return { expense: getRow(id)!, refunded };
  });
}

// ---------- สมุดเงินสดในลิ้นชัก ----------
export function drawerLedger(shiftId?: number) {
  const sh = (
    shiftId
      ? db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId)
      : db.prepare("SELECT * FROM shifts ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, id DESC LIMIT 1").get()
  ) as Record<string, any> | undefined;
  if (!sh) return { shift: null, entries: [], totals: null };
  type Entry = { at: string; type: string; label: string; detail: string; amount: number; staff: string; ref: string | number | null; balance?: number };
  const entries: Entry[] = [];
  entries.push({ at: sh.opened_at, type: 'open', label: 'เงินตั้งต้น (เปิดกะ)', detail: sh.opening_note ?? '', amount: sh.opening_cash, staff: sh.opened_by, ref: null });
  const pays = db
    .prepare(
      `SELECT p.created_at AS at, p.kind, p.amount, o.order_no AS orderNo, o.id AS orderId, o.salesperson
         FROM payments p LEFT JOIN orders_all o ON o.id = p.order_id WHERE p.shift_id = ? AND p.method = 'cash' ORDER BY p.id`,
    )
    .all(sh.id) as { at: string; kind: string; amount: number; orderNo: string; orderId: number; salesperson: string | null }[];
  for (const p of pays) {
    const label = p.kind === 'sale' ? 'ขายเงินสด' : p.kind === 'void' ? 'ยกเลิกบิล (คืนเงิน)' : p.amount >= 0 ? 'แก้ไขบิล (เก็บเพิ่ม)' : 'แก้ไขบิล (คืนเงิน)';
    entries.push({ at: p.at, type: p.kind, label, detail: p.orderNo ?? '', amount: p.amount, staff: p.salesperson ?? '', ref: p.orderId });
  }
  const moves = db
    .prepare(
      `SELECT m.id, m.created_at AS at, m.kind, m.amount, m.reason, m.staff, e.id AS expenseId, e.voided_at AS voidedAt, v.id AS voidOf
         FROM cash_movements m
         LEFT JOIN expenses e ON e.cash_move_id = m.id
         LEFT JOIN expenses v ON v.void_move_id = m.id
        WHERE m.shift_id = ? ORDER BY m.id`,
    )
    .all(sh.id) as { id: number; at: string; kind: 'in' | 'out'; amount: number; reason: string; staff: string; expenseId: number | null; voidedAt: string | null; voidOf: number | null }[];
  for (const m of moves) {
    const isExp = m.expenseId != null;
    const isVoid = m.voidOf != null;
    entries.push({
      at: m.at, type: isExp ? 'expense' : isVoid ? 'expense_void' : m.kind === 'in' ? 'cash_in' : 'cash_out',
      label: isExp ? (m.voidedAt ? 'ค่าใช้จ่าย (ยกเลิกภายหลัง)' : 'ค่าใช้จ่าย') : isVoid ? 'คืนเงินเข้าลิ้นชัก (ยกเลิกค่าใช้จ่าย)' : m.kind === 'in' ? 'นำเงินเข้า' : 'นำเงินออก',
      detail: m.reason.replace(/^ค่าใช้จ่าย: /, ''), amount: m.kind === 'in' ? m.amount : -m.amount, staff: m.staff, ref: m.expenseId ?? m.voidOf,
    });
  }
  entries.sort((a, b) => (a.type === 'open' ? -1 : b.type === 'open' ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let bal = 0;
  const totals = { opening: round2(sh.opening_cash), cashSales: 0, refunds: 0, cashIn: 0, cashOut: 0, expenses: 0, expected: 0 };
  for (const e of entries) {
    bal = round2(bal + e.amount);
    e.balance = bal;
    if (e.type === 'sale' || ((e.type === 'edit') && e.amount > 0)) totals.cashSales = round2(totals.cashSales + e.amount);
    else if (e.type === 'void' || e.type === 'edit') totals.refunds = round2(totals.refunds - e.amount);
    else if (e.type === 'cash_in') totals.cashIn = round2(totals.cashIn + e.amount);
    else if (e.type === 'cash_out') totals.cashOut = round2(totals.cashOut - e.amount);
    else if (e.type === 'expense' || e.type === 'expense_void') totals.expenses = round2(totals.expenses - e.amount); // ยกเลิก = หักกลับ
  }
  totals.expected = bal;
  return {
    shift: {
      id: sh.id, shiftNo: sh.shift_no, businessDate: sh.business_date, status: sh.status, openedAt: sh.opened_at, openedBy: sh.opened_by,
      closedAt: sh.closed_at, closedBy: sh.closed_by, countedCash: sh.counted_cash, diff: sh.diff,
    },
    entries,
    totals,
  };
}

/** รายการกะล่าสุด (เลือกดูสมุดลิ้นชัก) */
export function recentShifts() {
  return db
    .prepare('SELECT id, shift_no AS shiftNo, business_date AS businessDate, status, opened_by AS openedBy FROM shifts ORDER BY id DESC LIMIT 60')
    .all();
}

export function expensesCsv(f: ExpenseQuery) {
  const { rows, categories } = listExpenses({ ...f, voided: '1' });
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['เลขที่', 'วันที่', 'สาขา', 'ลำดับ', 'รายละเอียด', 'หมวดหมู่', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'ราคา', 'ยอดรวมบิล', 'จ่ายจาก', 'ร้านค้า/ผู้รับเงิน', 'เลขที่ใบเสร็จ', 'กะ', 'บันทึกโดย', 'หมายเหตุ', 'สถานะ'];
  const lines = rows.flatMap((r) =>
    (r.items?.length ? r.items : [{ description: r.description, category: r.category, qty: 1, unit: '', unitPrice: r.amount, amount: r.amount }]).map((it, i) =>
      [
        r.id, r.date, r.branchName, i + 1, it.description, categories.find((c) => c.id === it.category)?.name ?? it.category, it.qty, it.unit, it.unitPrice, it.amount,
        i === 0 ? r.amount : '', EXPENSE_SOURCES[r.source] ?? r.source, r.vendor, r.refNo, r.shiftNo ?? '', r.staff, r.note, r.voidedAt ? `ยกเลิก: ${r.voidReason ?? ''}` : '',
      ].map(esc).join(','),
    ),
  );
  return '﻿' + [head.join(','), ...lines].join('\n');
}
