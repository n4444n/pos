// รูปแบบเลขที่บิล — ตั้งแยกต่อสาขา (ตั้งค่า → เลขที่บิล)
// ค่าที่ตั้งใช้กับสาขานั้นสาขาเดียว · สาขาที่ยังไม่ได้ตั้ง ใช้รูปแบบเดิม:
//   สาขาหลัก INV-261102-0001 · สาขาอื่น INV-B02-261102-0001 · มีเครื่อง POS INV-POS01-261102-0001
import { currentBranch, db, mainBranchId } from './db.ts';
import { HttpError } from './common.ts';
import { getBranch, type Branch } from './branches.ts';
import { docFloor } from './docFloor.ts';
import { taxAdmin, type Terminal } from './tax.ts';

export type BillDate = 'ymd' | 'ym' | 'y' | 'none';
export interface BillFormat {
  /** ตัวอักษรนำหน้า เช่น INV (A–Z 0–9, เว้นว่างได้) */
  prefix: string;
  /** ใส่รหัสสาขา เช่น B02 */
  branchCode: boolean;
  /** ใส่รหัสเครื่อง POS (เมื่อเครื่องนี้เลือกเครื่อง POS ไว้) */
  terminalCode: boolean;
  /** วันที่ในเลขบิล + รอบเริ่มเลข 1 ใหม่: รายวัน 261102 · รายเดือน 2611 · รายปี 26 · ไม่มี (รันต่อเนื่อง) */
  date: BillDate;
  /** จำนวนหลักของเลขรัน */
  digits: number;
  /** ตัวคั่น */
  sep: '-' | '';
}

db.exec(`CREATE TABLE IF NOT EXISTS bill_format (
  branch_id INTEGER PRIMARY KEY,
  value     TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const DATES: BillDate[] = ['ymd', 'ym', 'y', 'none'];
export const defaultFormat = (b: Pick<Branch, 'isMain'>): BillFormat => ({ prefix: 'INV', branchCode: !b.isMain, terminalCode: true, date: 'ymd', digits: 4, sep: '-' });

function clean(v: Record<string, unknown>, b: Branch): BillFormat {
  const d = defaultFormat(b);
  const prefix = String(v.prefix ?? d.prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const date = DATES.includes(v.date as BillDate) ? (v.date as BillDate) : d.date;
  const digits = Math.min(6, Math.max(3, Math.round(Number(v.digits) || d.digits)));
  const sep = v.sep === '' ? '' : '-';
  const bool = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def);
  return { prefix, branchCode: bool(v.branchCode, d.branchCode), terminalCode: bool(v.terminalCode, d.terminalCode), date, digits, sep };
}

const getQ = db.prepare('SELECT value FROM bill_format WHERE branch_id = ?');
const setQ = db.prepare(`INSERT INTO bill_format (branch_id, value) VALUES (?, ?)
  ON CONFLICT (branch_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);

const branchOf = (id?: number) => {
  const b = getBranch(id ?? (currentBranch() || mainBranchId())) ?? getBranch(mainBranchId());
  if (!b) throw new HttpError(404, 'ไม่พบสาขา');
  return b;
};

/** รูปแบบเลขบิลของสาขา (ยังไม่ได้ตั้ง = รูปแบบเดิม) */
export function billFormat(b: Branch): BillFormat {
  const r = getQ.get(b.id) as { value: string } | undefined;
  if (!r) return defaultFormat(b);
  try {
    return clean(JSON.parse(r.value), b);
  } catch {
    return defaultFormat(b);
  }
}

const branchTag = (b: Branch) => b.code.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || String(b.id);

/** ส่วนหน้าของเลขบิล (ก่อนเลขรัน) เช่น INV-B02-261102- */
export function billPrefix(f: BillFormat, b: Branch, t: Terminal | null, d = new Date()) {
  const p = (x: number) => String(x).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const date = f.date === 'ymd' ? `${yy}${p(d.getMonth() + 1)}${p(d.getDate())}` : f.date === 'ym' ? `${yy}${p(d.getMonth() + 1)}` : f.date === 'y' ? yy : '';
  const parts = [f.prefix, f.branchCode ? branchTag(b) : '', f.terminalCode && t ? t.code.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '', date].filter(Boolean);
  return parts.length ? parts.join(f.sep) + f.sep : '';
}

// เลขรันล่าสุดของ prefix นี้ — ดูทุกสาขา (เลขบิลห้ามซ้ำทั้งร้าน) และนับเฉพาะเลขที่เป็นตัวเลขล้วนตามจำนวนหลัก
// (กันเลขรูปแบบเก่า/รูปแบบอื่นที่ขึ้นต้นเหมือนกัน เช่น INV-261102-0001 ไม่ถูกนับเป็นเลขรันของ INV-)
const maxQ = db.prepare(`SELECT MAX(CAST(substr(order_no, :s) AS INTEGER)) AS n FROM orders_all
  WHERE order_no LIKE :p AND substr(order_no, :s) <> '' AND substr(order_no, :s) NOT GLOB '*[^0-9]*'
    AND (length(order_no) = :len OR (length(order_no) BETWEEN :len + 1 AND :len + 2 AND substr(order_no, :s, 1) <> '0'))`);
const existsQ = db.prepare('SELECT 1 FROM orders_all WHERE order_no = ?');

/** เลขที่บิลถัดไปของสาขาที่กำลังใช้งาน */
export function nextBillNo(t: Terminal | null) {
  const b = branchOf();
  const f = billFormat(b);
  return nextFor(f, b, t);
}

function nextFor(f: BillFormat, b: Branch, t: Terminal | null) {
  const prefix = billPrefix(f, b, t);
  const r = maxQ.get({ s: prefix.length + 1, p: prefix + '%', len: prefix.length + f.digits }) as { n: number | null };
  let n = Math.max(r.n ?? 0, docFloor(prefix)) + 1;
  const fmt = (x: number) => prefix + String(x).padStart(f.digits, '0');
  while (existsQ.get(fmt(n))) n++; // กันชนกับเลขที่มีอยู่แล้ว (เช่น เปลี่ยนรูปแบบกลับไปกลับมา)
  return fmt(n);
}

// ---------- หน้าตั้งค่า ----------
function view(b: Branch) {
  const f = billFormat(b);
  const terminals = taxAdmin().terminals.filter((x) => x.branchId === b.id && x.active);
  const t = terminals[0] ?? null;
  return {
    branch: { id: b.id, name: b.name, code: b.code, isMain: b.isMain },
    custom: !!getQ.get(b.id),
    format: f,
    defaults: defaultFormat(b),
    terminals: terminals.map((x) => x.code),
    /** ตัวอย่างเลขบิลถัดไป (ไม่มีเครื่อง POS / เครื่องแรกของสาขา) */
    next: nextFor(f, b, null),
    nextTerminal: t ? nextFor(f, b, t) : null,
  };
}

export const billNoSettings = () => view(branchOf());

export function saveBillNo(body: Record<string, unknown>) {
  const b = branchOf();
  if (body.reset === true) db.prepare('DELETE FROM bill_format WHERE branch_id = ?').run(b.id);
  else {
    const f = clean(body, b);
    if (!f.prefix && !f.branchCode && f.date === 'none') throw new HttpError(422, 'ต้องมีตัวอักษรนำหน้า รหัสสาขา หรือวันที่ อย่างน้อย 1 อย่าง (เลขบิลจะได้ไม่เป็นตัวเลขล้วน)');
    setQ.run(b.id, JSON.stringify(f));
  }
  return view(b);
}
