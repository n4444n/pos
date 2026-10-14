// สาขา (ทุกสาขาใช้เว็บเดียว ฐานข้อมูลเดียว)
// - สาขาหลัก: เพิ่ม/แก้/ลบสินค้า → ทุกสาขาเห็นทันที
// - แต่ละสาขา: สต็อก ราคาที่ตั้งเอง บิล กะ แยกกัน (ดู db.ts)
// - พนักงานถูกผูกกับสาขาที่กำหนด (auth.ts) · ผู้จัดการเห็นทุกสาขา
import { currentBranch, db, mainBranchId } from './db.ts';
import { HttpError, setVatSwitch } from './common.ts';

export interface Branch {
  id: number;
  name: string;
  code: string;
  address: string;
  vatRegistered: boolean;
  phone: string;
  photo: string;
  isMain: boolean;
  staffCount: number;
  createdAt: string;
}

const COLS = `b.id, b.name, b.code, b.address, b.vat_registered AS vat, b.phone, b.photo, b.is_main AS isMain, b.created_at AS createdAt,
  (SELECT COUNT(*) FROM staff_branches sb JOIN staff s ON s.id = sb.staff_id WHERE sb.branch_id = b.id AND s.active = 1 AND s.role = 'staff') AS staffCount`;
type Row = Omit<Branch, 'vatRegistered' | 'isMain'> & { vat: number; isMain: number };
const toBranch = (r: Row): Branch => ({ ...r, vatRegistered: !!r.vat, isMain: !!r.isMain });

// เตรียมคำสั่งตอนใช้ครั้งแรก (คอลัมน์ของตาราง staff ถูกเพิ่มโดย auth.ts ซึ่งโหลดทีหลัง)
let stmts: { list: ReturnType<typeof db.prepare>; one: ReturnType<typeof db.prepare> } | null = null;
const q = () =>
  (stmts ??= {
    list: db.prepare(`SELECT ${COLS} FROM branches b WHERE b.deleted_at IS NULL ORDER BY b.is_main DESC, b.code, b.id`),
    one: db.prepare(`SELECT ${COLS} FROM branches b WHERE b.id = ? AND b.deleted_at IS NULL`),
  });

export function listBranches(): Branch[] {
  return (q().list.all() as Row[]).map(toBranch);
}
export function getBranch(id: number): Branch | null {
  const r = q().one.get(id) as Row | undefined;
  return r ? toBranch(r) : null;
}
/** ข้อมูลสาขาที่กำลังใช้งาน (โหมดรวมทุกสาขา = สาขาหลัก) */
export function currentBranchInfo(): Branch {
  return getBranch(currentBranch() || mainBranchId()) ?? getBranch(mainBranchId())!;
}

// VAT คิดตามสาขา: สาขาที่ไม่ได้จดทะเบียน VAT → ไม่คิด/ไม่แสดง VAT ในบิล
setVatSwitch(() => currentBranchInfo().vatRegistered);

/** รหัสสาขาถัดไป: ต่อจากเลขท้ายที่มากที่สุด (B01 → B02, 00001 → 00002) */
export function nextCode() {
  let best: { prefix: string; n: number; width: number } | null = null;
  for (const b of listBranches()) {
    const m = b.code.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const n = Number(m[2]);
    if (!best || n > best.n) best = { prefix: m[1], n, width: m[2].length };
  }
  return best ? `${best.prefix}${String(best.n + 1).padStart(best.width, '0')}` : 'B02';
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
function cleanInput(v: Record<string, unknown>) {
  const photo = str(v.photo, 300);
  return {
    name: str(v.name, 60),
    code: str(v.code, 20).toUpperCase().replace(/\s/g, ''),
    address: str(v.address, 300),
    vatRegistered: v.vatRegistered === true || v.vatRegistered === 1 || v.vatRegistered === 'true',
    phone: str(v.phone, 40),
    photo: /^\/uploads\/[\w.-]+$|^https?:\/\//.test(photo) ? photo : '',
  };
}

function validate(b: ReturnType<typeof cleanInput>, exceptId?: number) {
  if (!b.name) throw new HttpError(422, 'กรุณากรอกชื่อสาขา');
  for (const x of listBranches()) {
    if (x.id === exceptId) continue;
    if (x.name.toLowerCase() === b.name.toLowerCase()) throw new HttpError(409, `มีสาขาชื่อ "${b.name}" แล้ว`);
    if (b.code && x.code.toUpperCase() === b.code) throw new HttpError(409, `รหัสสาขา ${b.code} ถูกใช้แล้ว (${x.name})`);
  }
}

export function createBranch(body: Record<string, unknown>) {
  const b = cleanInput(body);
  if (!b.code) b.code = nextCode();
  validate(b);
  const r = db
    .prepare('INSERT INTO branches (name, code, address, vat_registered, phone, photo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.name, b.code, b.address, b.vatRegistered ? 1 : 0, b.phone, b.photo);
  return getBranch(Number(r.lastInsertRowid))!;
}

export function updateBranch(id: number, body: Record<string, unknown>) {
  const cur = getBranch(id);
  if (!cur) throw new HttpError(404, 'ไม่พบสาขา');
  const b = cleanInput(body);
  if (!b.code) b.code = cur.code;
  validate(b, id);
  db.prepare(
    `UPDATE branches SET name = ?, code = ?, address = ?, vat_registered = ?, phone = ?, photo = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
  ).run(b.name, b.code, b.address, b.vatRegistered ? 1 : 0, b.phone, b.photo, id);
  return getBranch(id)!;
}

/** ลบสาขา (ซ่อน) — บิล/กะ/สต็อกเดิมยังเก็บไว้ · พนักงานที่ผูกไว้ถูกถอดออก · ลบสาขาหลักไม่ได้ */
export function deleteBranches(ids: unknown) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) throw new HttpError(422, 'กรุณาเลือกสาขาที่ต้องการลบ');
  let done = 0;
  for (const id of list) {
    const b = getBranch(id);
    if (!b) continue;
    if (b.isMain) throw new HttpError(409, `ลบสาขาหลัก (${b.name}) ไม่ได้`);
    const open = db.prepare("SELECT 1 FROM shifts_all WHERE branch_id = ? AND status = 'open'").get(id);
    if (open) throw new HttpError(409, `${b.name} ยังมีกะที่เปิดอยู่ — ปิดกะก่อนลบสาขา`);
    db.prepare("UPDATE branches SET deleted_at = datetime('now', 'localtime') WHERE id = ?").run(id);
    db.prepare('DELETE FROM staff_branches WHERE branch_id = ?').run(id);
    db.prepare('UPDATE sessions SET branch_id = ? WHERE branch_id = ?').run(mainBranchId(), id);
    done++;
  }
  return { done };
}

/** ราคาของสาขานี้ → กลับไปใช้ราคาสาขาหลัก */
export function resetBranchPrices(variantIds: unknown) {
  const b = currentBranch();
  if (!b || b === mainBranchId()) throw new HttpError(422, 'สาขาหลักใช้ราคาหลักอยู่แล้ว');
  const ids = (Array.isArray(variantIds) ? variantIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const st = db.prepare('UPDATE branch_stock SET price = NULL WHERE branch_id = ? AND variant_id = ?');
  let done = 0;
  for (const id of ids) done += Number(st.run(b, id).changes);
  return { done };
}
