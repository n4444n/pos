// LOG (บันทึกการใช้งาน): เก็บทุกการกระทำในโปรแกรม — ใคร ทำอะไร ที่สาขาไหน เมื่อไร สำเร็จหรือไม่
// - บันทึกอัตโนมัติจาก router (index.ts) ทุกคำขอที่เปลี่ยนข้อมูล (POST / PUT / PATCH / DELETE) + เข้า/ออกระบบ + ดาวน์โหลดไฟล์ส่งออก/สำรอง
// - ข้อมูลลับ (PIN / รหัสผ่าน / token / key / รูป) ถูกตัดออกก่อนบันทึก
// - ดูได้เฉพาะ "ผู้ดูแลระบบ" (role admin ที่เข้าระบบด้วย PIN) — API key และบทบาทอื่นดูไม่ได้ แม้จะตั้งสิทธิ์ให้
// - เก็บย้อนหลัง 365 วัน แล้วลบอัตโนมัติ
import { db } from '../../core/db.ts';
import { HttpError } from '../../core/common.ts';
import { buildXlsx, type Col } from '../../core/xlsx.ts';
import type { Me } from '../../core/auth.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    staff_id   INTEGER,
    staff_name TEXT,
    role       TEXT,
    branch_id  INTEGER,
    method     TEXT NOT NULL,
    path       TEXT NOT NULL,
    action     TEXT NOT NULL,
    ref        TEXT,
    detail     TEXT,
    status     INTEGER NOT NULL,
    ip         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
  CREATE INDEX IF NOT EXISTS idx_audit_staff ON audit_log(staff_id, at);
`);

const KEEP_DAYS = 365;
const purge = () => db.prepare(`DELETE FROM audit_log WHERE at < datetime('now', 'localtime', '-${KEEP_DAYS} days')`).run();
purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();

// ---------------------------------------------------------------- ชื่อการกระทำ (ภาษาคน)
type Rule = [method: string, re: RegExp, label: string | ((m: RegExpExecArray) => string)];
const SETTINGS_NAME: Record<string, string> = {
  shop: 'ข้อมูลร้าน', display: 'การแสดงผลหน้าขาย', stock: 'สต็อก', payments: 'วิธีชำระเงิน', barcode: 'บาร์โค้ด', receipt: 'ใบเสร็จ',
  notify: 'การแจ้งเตือน', api: 'API', tax: 'ภาษี',
};
const RULES: Rule[] = [
  ['POST', /^\/api\/auth\/login$/, 'เข้าสู่ระบบ'],
  ['POST', /^\/api\/auth\/logout$/, 'ออกจากระบบ'],
  ['POST', /^\/api\/branches\/switch$/, 'สลับสาขา'],
  ['GET', /^\/api\/backup\/download$/, 'ดาวน์โหลดไฟล์สำรองข้อมูล'],
  ['POST', /^\/api\/backup\/upload$/, 'อัปโหลดไฟล์สำรองเพื่อกู้คืน'],
  ['POST', /^\/api\/backup\/restore$/, 'กู้คืนข้อมูล'],
  ['POST', /^\/api\/backup\/discard$/, 'ยกเลิกไฟล์กู้คืน'],
  ['POST', /^\/api\/backup\/devices\/revoke$/, 'ยกเลิกสำรองอัตโนมัติของเครื่อง'],
  ['POST', /^\/api\/backup\/devices$/, 'เปิดสำรองอัตโนมัติลงเครื่อง'],
  ['POST', /^\/api\/perms\/[a-z]+\/reset$/, 'คืนค่าสิทธิ์บทบาท'],
  ['*', /^\/api\/perms\/[a-z]+$/, 'แก้ไขสิทธิ์บทบาท'],
  ['POST', /^\/api\/staff$/, 'เพิ่มพนักงาน'],
  ['DELETE', /^\/api\/staff\/\d+$/, 'ลบพนักงาน'],
  ['*', /^\/api\/staff\/\d+$/, 'แก้ไขพนักงาน'],
  ['POST', /^\/api\/promos$/, 'สร้างโปรโมชั่น'],
  ['DELETE', /^\/api\/promos\/[^/]+$/, 'ลบโปรโมชั่น'],
  ['*', /^\/api\/promos\/[^/]+$/, 'แก้ไขโปรโมชั่น'],
  ['POST', /^\/api\/orders$/, 'ขายสินค้า (ออกบิล)'],
  ['POST', /^\/api\/beam\/charge$/, 'Beam: ส่งยอดไปเครื่องรับบัตร'],
  ['POST', /^\/api\/beam\/charge\/[^/]+\/bill$/, 'Beam: ออกบิลหลังรับเงินสำเร็จ'],
  ['POST', /^\/api\/beam\/charge\/[^/]+\/cancel$/, 'Beam: ยกเลิกรายการบนเครื่อง'],
  ['POST', /^\/api\/beam\/pair$/, 'Beam: ผูกเครื่องรับบัตร'],
  ['DELETE', /^\/api\/beam\/pair$/, 'Beam: ยกเลิกการผูกเครื่องรับบัตร'],
  ['POST', /^\/api\/beam\/test$/, 'Beam: ทดสอบการเชื่อมต่อ'],
  ['POST', /^\/api\/orders\/\d+\/void$/, 'ยกเลิกบิล'],
  ['POST', /^\/api\/orders\/\d+\/tax-invoice$/, 'ออกใบกำกับภาษีเต็มรูป'],
  ['POST', /^\/api\/orders\/\d+\/credit-note$/, 'ออกใบลดหนี้ / คืนเงิน'],
  ['*', /^\/api\/orders\/\d+$/, 'แก้ไขบิล'],
  ['POST', /^\/api\/tax-invoices\/\d+\/cancel$/, 'ยกเลิกใบกำกับภาษี'],
  ['*', /^\/api\/credit-notes\/\d+$/, 'แก้ไข / ยกเลิกใบลดหนี้'],
  ['POST', /^\/api\/products$/, 'เพิ่มสินค้า'],
  ['POST', /^\/api\/products\/import$/, 'นำเข้าสินค้าจากไฟล์'],
  ['POST', /^\/api\/products\/bulk$/, 'แก้ไขสินค้าหลายรายการ'],
  ['*', /^\/api\/products\/\d+\/skus$/, 'แก้ไข SKU ของสินค้า'],
  ['DELETE', /^\/api\/products\/\d+$/, 'ลบสินค้า'],
  ['*', /^\/api\/products\/\d+$/, 'แก้ไขสินค้า'],
  ['*', /^\/api\/variants\/\d+$/, 'แก้ไขบาร์โค้ด / สถานะ SKU'],
  ['POST', /^\/api\/stock\/command$/, 'ปรับสต็อก'],
  ['POST', /^\/api\/categories$/, 'เพิ่มหมวดหมู่'],
  ['DELETE', /^\/api\/categories\/[^/]+$/, 'ลบหมวดหมู่'],
  ['*', /^\/api\/categories\/[^/]+$/, 'แก้ไขหมวดหมู่'],
  ['POST', /^\/api\/uploads/, 'อัปโหลดรูป'],
  ['*', /^\/api\/tax\/company$/, 'ตั้งค่าภาษี (ผู้ประกอบการ)'],
  ['POST', /^\/api\/tax\/rates$/, 'เพิ่มอัตรา VAT'],
  ['DELETE', /^\/api\/tax\/rates\/\d+$/, 'ลบอัตรา VAT'],
  ['*', /^\/api\/tax\/rates\/\d+$/, 'แก้ไขอัตรา VAT'],
  ['POST', /^\/api\/tax\/terminals$/, 'เพิ่มเครื่อง POS'],
  ['DELETE', /^\/api\/tax\/terminals\/\d+$/, 'ลบเครื่อง POS'],
  ['*', /^\/api\/tax\/terminals\/\d+$/, 'แก้ไขเครื่อง POS'],
  ['*', /^\/api\/tax\/branches\/\d+$/, 'ตั้งค่าภาษีของสาขา'],
  ['PUT', /^\/api\/billno$/, 'ตั้งค่าเลขที่บิล'],
  ['POST', /^\/api\/settings\/notify\/test$/, 'ทดสอบส่งการแจ้งเตือน'],
  ['POST', /^\/api\/settings\/keys$/, 'สร้าง API key'],
  ['DELETE', /^\/api\/settings\/keys\/\d+$/, 'ยกเลิก API key'],
  ['PUT', /^\/api\/settings\/([a-z]+)$/, (m) => `บันทึกตั้งค่า: ${SETTINGS_NAME[m[1]] ?? m[1]}`],
  ['POST', /^\/api\/branches$/, 'เพิ่มสาขา'],
  ['POST', /^\/api\/branches\/delete$/, 'ลบสาขา'],
  ['POST', /^\/api\/branches\/reset-prices$/, 'คืนราคาขายสาขาเป็นราคากลาง'],
  ['*', /^\/api\/branches\/\d+$/, 'แก้ไขสาขา'],
  ['POST', /^\/api\/shipments$/, 'สร้างใบส่งของ'],
  ['POST', /^\/api\/shipments\/\d+\/scan$/, 'สแกนสินค้าใส่ใบส่งของ'],
  ['PUT', /^\/api\/shipments\/\d+\/items\/\d+$/, 'แก้จำนวนในใบส่งของ'],
  ['POST', /^\/api\/shipments\/\d+\/ship$/, 'ส่งออกใบส่งของ'],
  ['POST', /^\/api\/shipments\/\d+\/cancel$/, 'ยกเลิกใบส่งของ'],
  ['POST', /^\/api\/shipments\/\d+\/restore$/, 'กู้คืนใบส่งของ'],
  ['POST', /^\/api\/shipments\/\d+\/hold$/, 'พักใบส่งของ'],
  ['POST', /^\/api\/shipments\/\d+\/resume$/, 'ทำใบส่งของต่อ'],
  ['PUT', /^\/api\/shipments\/\d+\/received$/, 'แก้ไขจำนวนที่ปลายทางรับจริง'],
  ['POST', /^\/api\/shipments\/\d+\/adjust$/, 'ปรับสต็อกจากใบส่งของ'],
  ['DELETE', /^\/api\/shipments\/\d+$/, 'ลบใบส่งของ'],
  ['PATCH', /^\/api\/shipments\/\d+$/, 'แก้ไขใบส่งของ'],
  ['POST', /^\/api\/expenses$/, 'บันทึกค่าใช้จ่าย'],
  ['POST', /^\/api\/expenses\/\d+\/void$/, 'ลบ / ยกเลิกค่าใช้จ่าย'],
  ['*', /^\/api\/expenses\/\d+$/, 'แก้ไขค่าใช้จ่าย'],
  ['PUT', /^\/api\/expenses\/categories$/, 'แก้ไขหมวดค่าใช้จ่าย'],
  ['POST', /^\/api\/held$/, 'พักบิล'],
  ['POST', /^\/api\/held\/\d+\/recall$/, 'เรียกบิลที่พักไว้'],
  ['DELETE', /^\/api\/held\/\d+$/, 'ลบบิลที่พักไว้'],
  ['POST', /^\/api\/shifts\/open$/, 'เปิดกะ'],
  ['POST', /^\/api\/shifts\/current\/cash$/, 'นำเงินเข้า / ออกลิ้นชัก'],
  ['POST', /^\/api\/shifts\/current\/close$/, 'ปิดกะ'],
];

/** ดาวน์โหลดไฟล์ส่งออก (Excel / CSV) */
const isExport = (path: string) => /\.(xlsx|csv)$/.test(path);

export function actionLabel(method: string, path: string) {
  for (const [m, re, label] of RULES) {
    if (m !== '*' && m !== method) continue;
    if (m === '*' && method === 'GET') continue;
    const hit = re.exec(path);
    if (hit) return typeof label === 'function' ? label(hit) : label;
  }
  if (method === 'GET' && isExport(path)) return 'ส่งออกไฟล์ Excel / CSV';
  return `${method} ${path}`;
}

/** คำขอนี้ต้องบันทึกไหม */
export function shouldAudit(method: string, path: string) {
  if (!path.startsWith('/api/') || path.startsWith('/api/internal/') || path === '/api/health') return false;
  if (method === 'GET' || method === 'HEAD') return isExport(path) || path === '/api/backup/download';
  return method !== 'OPTIONS';
}

// ---------------------------------------------------------------- ตัดข้อมูลลับ / ย่อข้อมูล
const SECRET_KEY = /pin|password|passwd|secret|token|api.?key|^key$|authorization|signature/i;
const BLOB_KEY = /image|photo|logo|base64|dataurl|file/i;
function clean(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 160 ? `${v.slice(0, 160)}… (${v.length} ตัวอักษร)` : v;
  if (depth > 3) return '…';
  if (Array.isArray(v)) {
    const head = v.slice(0, 15).map((x) => clean(x, depth + 1));
    return v.length > 15 ? [...head, `… อีก ${v.length - 15} รายการ`] : head;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) out[k] = '••••';
      else if (BLOB_KEY.test(k) && typeof x === 'string' && x.length > 80) out[k] = '(ไฟล์/รูป)';
      else out[k] = clean(x, depth + 1);
    }
    return out;
  }
  return String(v);
}

/** เลขที่เอกสาร / ชื่อที่เกี่ยวข้อง — หาจากผลลัพธ์ก่อน แล้วค่อยหาจากข้อมูลที่ส่งมา */
const REF_KEYS = ['orderNo', 'docNo', 'shiftNo', 'code', 'sku', 'name'];
function findRef(o: unknown, depth = 0): string | null {
  if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 2) return null;
  const r = o as Record<string, unknown>;
  for (const k of REF_KEYS) {
    const v = r[k];
    if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return `${k === 'shiftNo' ? 'กะ #' : ''}${String(v).slice(0, 80)}`;
  }
  for (const k of ['order', 'shipment', 'expense', 'shift', 'product', 'staff', 'branch', 'promo', 'settings', 'result']) {
    const hit = findRef(r[k], depth + 1);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------- บันทึก
const ins = db.prepare(
  `INSERT INTO audit_log (staff_id, staff_name, role, branch_id, method, path, action, ref, detail, status, ip)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

export interface AuditInput {
  method: string; path: string; query?: string; status: number; ip: string;
  me?: (Me & { keyId?: number }) | null; branchId?: number | null; body?: unknown; result?: unknown;
}

export function recordAudit(a: AuditInput) {
  try {
    if (!shouldAudit(a.method, a.path)) return;
    const res = a.result as Record<string, unknown> | undefined;
    const ok = a.status < 400;
    const err = !ok && res && typeof res.error === 'string' ? res.error : null;
    const detail: Record<string, unknown> = {};
    if (a.body !== undefined && a.body !== null && !(typeof a.body === 'object' && !Array.isArray(a.body) && !Object.keys(a.body as object).length)) detail.data = clean(a.body);
    if (a.query) detail.query = a.query.slice(0, 300);
    if (err) detail.error = err;
    const ref = ok ? findRef(res) ?? findRef(a.body) : findRef(a.body);
    const who = a.me ? (a.me.keyId ? `API key #${a.me.keyId}` : a.me.name) : null;
    ins.run(
      a.me && !a.me.keyId ? a.me.id : null,
      who,
      a.me ? (a.me.keyId ? 'api' : a.me.role) : null,
      a.branchId ?? a.me?.branchId ?? null,
      a.method,
      a.path.slice(0, 200),
      actionLabel(a.method, a.path),
      ref,
      Object.keys(detail).length ? JSON.stringify(detail).slice(0, 4000) : null,
      a.status,
      a.ip.slice(0, 60),
    );
  } catch (e) {
    console.warn('[audit]', (e as Error).message);
  }
}

// ---------------------------------------------------------------- หน้า LOG (ผู้ดูแลระบบเท่านั้น)
/** เฉพาะผู้ดูแลระบบที่เข้าระบบด้วย PIN — API key (แม้สิทธิ์เขียน) และบทบาทอื่นดูไม่ได้ */
export function requireLogAccess(me: Me & { keyId?: number }) {
  if (me.keyId || me.role !== 'admin') throw new HttpError(403, 'เมนู LOG ดูได้เฉพาะผู้ดูแลระบบ', 'NO_PERMISSION');
}

export interface LogQuery { from?: string; to?: string; q?: string; staff?: string; result?: string; branch?: string; page?: string | number; limit?: string | number }
interface LogRow {
  id: number; at: string; staffId: number | null; staffName: string | null; role: string | null; branchId: number | null; branchName: string | null;
  method: string; path: string; action: string; ref: string | null; detail: string | null; status: number; ip: string | null;
}
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function where(f: LogQuery) {
  const t = today();
  let from = isDay(f.from) ? f.from : t;
  let to = isDay(f.to) ? f.to : t;
  if (from > to) [from, to] = [to, from];
  const sql = ['date(l.at) BETWEEN ? AND ?'];
  const args: (string | number)[] = [from, to];
  const staff = String(f.staff ?? '');
  if (/^\d+$/.test(staff)) {
    sql.push('l.staff_id = ?');
    args.push(Number(staff));
  } else if (staff === 'api') sql.push("l.role = 'api'");
  else if (staff === 'none') sql.push('l.staff_name IS NULL');
  if (f.result === 'ok') sql.push('l.status < 400');
  if (f.result === 'fail') sql.push('l.status >= 400');
  const branch = Number(f.branch);
  if (Number.isInteger(branch) && branch > 0) {
    sql.push('l.branch_id = ?');
    args.push(branch);
  }
  const q = String(f.q ?? '').trim().slice(0, 80);
  if (q) {
    sql.push("(l.action LIKE ? OR IFNULL(l.ref, '') LIKE ? OR IFNULL(l.staff_name, '') LIKE ? OR IFNULL(l.detail, '') LIKE ? OR l.path LIKE ?)");
    for (let i = 0; i < 5; i++) args.push(`%${q}%`);
  }
  return { sql: sql.join(' AND '), args, range: { from, to } };
}

const COLS = `l.id, l.at, l.staff_id AS staffId, l.staff_name AS staffName, l.role, l.branch_id AS branchId, b.name AS branchName,
  l.method, l.path, l.action, l.ref, l.detail, l.status, l.ip`;

export function listLogs(f: LogQuery) {
  const w = where(f);
  const limit = Math.min(200, Math.max(1, Number(f.limit) || 50));
  const total = (db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(l.status >= 400), 0) AS fail FROM audit_log l WHERE ${w.sql}`).get(...w.args) as { n: number; fail: number });
  const pages = Math.max(1, Math.ceil(total.n / limit));
  const page = Math.min(pages, Math.max(1, Number(f.page) || 1));
  const rows = db
    .prepare(`SELECT ${COLS} FROM audit_log l LEFT JOIN branches b ON b.id = l.branch_id WHERE ${w.sql} ORDER BY l.id DESC LIMIT ? OFFSET ?`)
    .all(...w.args, limit, (page - 1) * limit) as unknown as LogRow[];
  const staff = db
    .prepare("SELECT DISTINCT staff_id AS id, staff_name AS name FROM audit_log WHERE staff_id IS NOT NULL ORDER BY staff_name")
    .all() as { id: number; name: string }[];
  const branches = db.prepare('SELECT id, name FROM branches WHERE deleted_at IS NULL ORDER BY is_main DESC, id').all() as { id: number; name: string }[];
  return { range: w.range, rows, total: total.n, failed: total.fail, page, pages, staff, branches };
}

export function logsXlsx(f: LogQuery) {
  const w = where(f);
  const rows = db
    .prepare(`SELECT ${COLS} FROM audit_log l LEFT JOIN branches b ON b.id = l.branch_id WHERE ${w.sql} ORDER BY l.id DESC LIMIT 50000`)
    .all(...w.args) as unknown as LogRow[];
  const cols: Col<LogRow>[] = [
    { header: 'วันเวลา', value: (r) => r.at, type: 'datetime' },
    { header: 'ผู้ใช้', value: (r) => r.staffName ?? '-' },
    { header: 'บทบาท', value: (r) => r.role ?? '' },
    { header: 'สาขา', value: (r) => r.branchName ?? '' },
    { header: 'การกระทำ', value: (r) => r.action },
    { header: 'เลขที่ / ชื่อ', value: (r) => r.ref ?? '' },
    { header: 'ผล', value: (r) => (r.status < 400 ? 'สำเร็จ' : `ไม่สำเร็จ (${r.status})`) },
    { header: 'รายละเอียด', value: (r) => r.detail ?? '' },
    { header: 'IP', value: (r) => r.ip ?? '' },
    { header: 'คำขอ', value: (r) => `${r.method} ${r.path}` },
  ];
  const file = buildXlsx([{ name: 'LOG', intro: ['บันทึกการใช้งานโปรแกรม (LOG)', `${w.range.from} ถึง ${w.range.to}`], cols, rows }]);
  return { file, range: w.range };
}
