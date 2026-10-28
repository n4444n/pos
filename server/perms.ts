// สิทธิ์ตามบทบาท — แต่ละบทบาทเห็น/แก้ไข/ใช้งานเมนูไหนได้บ้าง
//   ไม่เห็น (none) → เมนูไม่ขึ้น และเรียก API ไม่ได้
//   ดูอย่างเดียว (view) → เปิดดูได้ แก้ไม่ได้
//   แก้ไขได้ (edit) → ใช้งานได้เต็ม
// ผู้ดูแลระบบได้ทุกสิทธิ์เสมอ (แก้ไม่ได้ กันล็อกตัวเองออกจากระบบ)
import { db } from './db.ts';
import { HttpError } from './common.ts';

export const ROLES = ['admin', 'manager', 'sales', 'parttime'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'ผู้ดูแลระบบ',
  manager: 'ผู้จัดการโรงงาน',
  sales: 'พนักงานขาย',
  parttime: 'พนักงานขาย (พาร์ทไทม์)',
};
export const ROLE_DESC: Record<Role, string> = {
  admin: 'ดูแลทั้งระบบ รวมตั้งค่าและสิทธิ์ — แก้สิทธิ์ของบทบาทนี้ไม่ได้',
  manager: 'ดูแลสินค้า สต็อก การส่งของ และรายงาน',
  sales: 'ขายหน้าร้าน เปิด-ปิดกะ ดูประวัติการขาย',
  parttime: 'ขายหน้าร้านอย่างเดียว',
};

export type Level = 'none' | 'view' | 'edit';
const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 };

/** เมนู/ความสามารถที่กำหนดสิทธิ์ได้ — เรียงตามที่แสดงในหน้าจัดการสิทธิ์ */
export const FEATURES = [
  { id: 'sales', label: 'หน้าขาย', group: 'ขายหน้าร้าน', hint: 'เปิดบิล รับเงิน พิมพ์ใบเสร็จ' },
  { id: 'history', label: 'ประวัติการขาย', group: 'ขายหน้าร้าน', hint: 'ดูบิลย้อนหลัง · แก้ไขได้ = แก้/ยกเลิกบิล' },
  { id: 'shifts', label: 'กะการขาย', group: 'ขายหน้าร้าน', hint: 'เปิด-ปิดกะ นับเงินในลิ้นชัก' },
  { id: 'promos', label: 'โปรโมชั่น', group: 'ขายหน้าร้าน', hint: 'ส่วนลดและของแถม' },
  { id: 'expenses', label: 'ค่าใช้จ่าย / ลิ้นชัก', group: 'ขายหน้าร้าน', hint: 'บันทึกรายจ่าย เงินเข้า-ออกลิ้นชัก' },
  { id: 'stock', label: 'สต็อกสินค้า', group: 'สินค้า', hint: 'สินค้า ราคา จำนวนคงเหลือ บาร์โค้ด' },
  { id: 'shipments', label: 'ส่งของจากโรงงาน', group: 'สินค้า', hint: 'ใบส่งของ สแกนส่ง รายงานการส่ง' },
  { id: 'reports', label: 'รายงาน', group: 'รายงาน', hint: 'รายงานรวม ยอดขาย รายบิล สินค้า' },
  { id: 'taxReport', label: 'ภาษีขาย (VAT)', group: 'รายงาน', hint: 'รายงานภาษี · แก้ไขได้ = ยกเลิกใบกำกับเต็มรูป' },
  { id: 'staff', label: 'พนักงาน', group: 'จัดการระบบ', hint: 'เพิ่ม/แก้พนักงาน · แก้ไขได้ = ตั้งสิทธิ์ได้ด้วย' },
  { id: 'branches', label: 'สาขา', group: 'จัดการระบบ', hint: 'ข้อมูลสาขา' },
  { id: 'settings', label: 'ตั้งค่า', group: 'จัดการระบบ', hint: 'ตั้งค่าร้าน ภาษี ใบเสร็จ แจ้งเตือน สำรอง/กู้คืนข้อมูล' },
] as const;
export type Feature = (typeof FEATURES)[number]['id'];
const FEATURE_IDS = new Set<string>(FEATURES.map((f) => f.id));

/** สิทธิ์เริ่มต้นของแต่ละบทบาท (ผู้ดูแลระบบได้ edit ทุกอย่างเสมอ ไม่ต้องใส่) */
const DEFAULTS: Record<Exclude<Role, 'admin'>, Partial<Record<Feature, Level>>> = {
  manager: {
    sales: 'edit', history: 'edit', shifts: 'edit', promos: 'edit', expenses: 'edit',
    stock: 'edit', shipments: 'edit', reports: 'edit', taxReport: 'view',
    staff: 'view', branches: 'view', settings: 'none',
  },
  sales: {
    sales: 'edit', history: 'view', shifts: 'edit', promos: 'view', expenses: 'view',
    stock: 'view', shipments: 'none', reports: 'none', taxReport: 'none',
    staff: 'none', branches: 'none', settings: 'none',
  },
  parttime: {
    sales: 'edit', history: 'view', shifts: 'edit', promos: 'view', expenses: 'none',
    stock: 'none', shipments: 'none', reports: 'none', taxReport: 'none',
    staff: 'none', branches: 'none', settings: 'none',
  },
};

db.exec(`CREATE TABLE IF NOT EXISTS role_perms (
  role    TEXT NOT NULL,
  feature TEXT NOT NULL,
  level   TEXT NOT NULL CHECK (level IN ('none', 'view', 'edit')),
  PRIMARY KEY (role, feature)
)`);

const q = {
  all: db.prepare('SELECT role, feature, level FROM role_perms'),
  set: db.prepare('INSERT INTO role_perms (role, feature, level) VALUES (?, ?, ?) ON CONFLICT (role, feature) DO UPDATE SET level = excluded.level'),
  clear: db.prepare('DELETE FROM role_perms WHERE role = ?'),
};

const full = () => Object.fromEntries(FEATURES.map((f) => [f.id, 'edit' as Level])) as Record<Feature, Level>;

/**
 * สิทธิ์ของทุกบทบาท (ค่าเริ่มต้น + ที่แก้ไว้ในฐานข้อมูล)
 * เก็บผลไว้ในหน่วยความจำ — can() ถูกเรียกหลายครั้งต่อคำขอ (บางทีทุกแถวในรายการสินค้า)
 * ถ้าอ่านฐานข้อมูลใหม่ทุกครั้งจะเปลืองโดยเปล่าประโยชน์ · ล้างแคชเมื่อมีการบันทึกสิทธิ์
 */
let cache: Record<Role, Record<Feature, Level>> | null = null;
export const clearPermCache = () => { cache = null; };
export function allPerms(): Record<Role, Record<Feature, Level>> {
  return (cache ??= buildPerms());
}
function buildPerms(): Record<Role, Record<Feature, Level>> {
  const out = {} as Record<Role, Record<Feature, Level>>;
  for (const r of ROLES) {
    out[r] = r === 'admin'
      ? full()
      : (Object.fromEntries(FEATURES.map((f) => [f.id, DEFAULTS[r][f.id] ?? 'none'])) as Record<Feature, Level>);
  }
  for (const row of q.all.all() as { role: string; feature: string; level: Level }[]) {
    if (row.role !== 'admin' && (ROLES as readonly string[]).includes(row.role) && FEATURE_IDS.has(row.feature)) {
      out[row.role as Role][row.feature as Feature] = row.level;
    }
  }
  return out;
}

export const permsOf = (role: Role): Record<Feature, Level> => {
  const all = allPerms();
  return all[role] ?? all.parttime;
};

/** มีสิทธิ์ถึงระดับที่ต้องการหรือไม่ */
export const can = (me: { role: Role }, feature: Feature, need: Level = 'view') =>
  RANK[permsOf(me.role)[feature] ?? 'none'] >= RANK[need];

/** ไม่มีสิทธิ์ → 403 (ข้อความบอกชื่อเมนู ผู้ใช้จะได้รู้ว่าติดตรงไหน) */
export function requirePerm(me: { role: Role; name?: string }, feature: Feature, need: Level = 'edit') {
  if (can(me, feature, need)) return;
  const f = FEATURES.find((x) => x.id === feature);
  const what = need === 'edit' ? 'แก้ไข' : 'เปิดดู';
  throw new HttpError(403, `บทบาท "${ROLE_LABEL[me.role] ?? me.role}" ไม่มีสิทธิ์${what} "${f?.label ?? feature}"`, 'NO_PERMISSION');
}

/** บันทึกสิทธิ์ของบทบาทหนึ่ง (ผู้ดูแลระบบแก้ไม่ได้) */
export function savePerms(role: string, perms: Record<string, string>) {
  if (role === 'admin') throw new HttpError(400, 'สิทธิ์ของผู้ดูแลระบบแก้ไขไม่ได้', 'ADMIN_FIXED');
  if (!(ROLES as readonly string[]).includes(role)) throw new HttpError(404, 'ไม่พบบทบาทนี้');
  const rows = Object.entries(perms).filter(([f, l]) => FEATURE_IDS.has(f) && l in RANK);
  if (!rows.length) throw new HttpError(422, 'ไม่มีสิทธิ์ที่จะบันทึก');
  db.exec('BEGIN IMMEDIATE');
  try {
    q.clear.run(role);
    for (const [f, l] of rows) q.set.run(role, f, l);
    db.exec('COMMIT');
    clearPermCache();
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return allPerms();
}

/** คืนค่าสิทธิ์ของบทบาทหนึ่งกลับเป็นค่าเริ่มต้น */
export function resetPerms(role: string) {
  if (role === 'admin') throw new HttpError(400, 'สิทธิ์ของผู้ดูแลระบบแก้ไขไม่ได้', 'ADMIN_FIXED');
  if (!(ROLES as readonly string[]).includes(role)) throw new HttpError(404, 'ไม่พบบทบาทนี้');
  q.clear.run(role);
  clearPermCache();
  return allPerms();
}

/** ข้อมูลทั้งหมดที่หน้าจัดการสิทธิ์ใช้ */
export const permCatalog = () => ({
  roles: ROLES.map((id) => ({ id, label: ROLE_LABEL[id], desc: ROLE_DESC[id], fixed: id === 'admin' })),
  features: FEATURES.map((f) => ({ ...f })),
  perms: allPerms(),
});
