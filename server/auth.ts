// พนักงาน + PIN (UID หลัก) + session สำหรับเข้าสู่ระบบ
// - PIN ไม่ซ้ำกัน (ตัวเลข 6 หลักเท่านั้น) เก็บเป็น HMAC-SHA256 ไม่เก็บตัวเลขจริง
// - ใช้ PIN เพื่อ Login และเพื่ออนุมัติการยกเลิกบิล
// - จำกัดการกรอก PIN ผิด: 5 ครั้ง → ล็อก 60 วินาที (ต่อ IP)
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { currentBranch, db, DB_PATH, mainBranchId, tx } from './db.ts';
import { HttpError } from './common.ts';

const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

// ---------- secret สำหรับ hash PIN (สร้างครั้งแรก เก็บคู่กับฐานข้อมูล) ----------
const SECRET_FILE = join(dirname(DB_PATH), '.pin-secret');
const SECRET = (() => {
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, 'utf8').trim();
  const s = randomBytes(32).toString('hex');
  writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
})();

export const hashPin = (pin: string) => createHmac('sha256', SECRET).update(pin).digest('hex');
export const PIN_LENGTH = 6;
const PIN_RE = /^\d{6}$/;

// ---------- migration ----------
function addColumn(table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('staff', 'pin_hash', 'TEXT');
addColumn('staff', 'role', "TEXT NOT NULL DEFAULT 'staff'");
addColumn('staff', 'active', 'INTEGER NOT NULL DEFAULT 1');
addColumn('staff', 'can_void', 'INTEGER NOT NULL DEFAULT 1');
addColumn('staff', 'last_login', 'TEXT');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_pin ON staff(pin_hash) WHERE pin_hash IS NOT NULL;
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    staff_id   INTEGER NOT NULL REFERENCES staff(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staff_id);
`);
addColumn('sessions', 'branch_id', 'INTEGER');      // สาขาที่กำลังใช้งานในเครื่องนี้
addColumn('staff', 'last_branch_id', 'INTEGER');    // สาขาล่าสุด (เข้าสู่ระบบครั้งหน้าเปิดสาขานี้)

// ตั้ง PIN เริ่มต้นให้พนักงานเดิมที่ยังไม่มี PIN + สร้างผู้จัดการคนแรก
(function ensureDefaults() {
  db.exec("UPDATE staff SET name = TRIM(REPLACE(name, 'พนักงาน: ', '')) WHERE name LIKE 'พนักงาน: %'");
  const noPin = db.prepare('SELECT id, name FROM staff WHERE pin_hash IS NULL ORDER BY id').all() as { id: number; name: string }[];
  const defaults = ['123456', '234567', '345678', '456789', '567890', '678901', '789012', '890123'];
  const created: string[] = [];
  tx(() => {
    for (const s of noPin) {
      const pin = defaults.find((p) => !db.prepare('SELECT 1 FROM staff WHERE pin_hash = ?').get(hashPin(p)));
      if (!pin) continue;
      db.prepare('UPDATE staff SET pin_hash = ? WHERE id = ?').run(hashPin(pin), s.id);
      created.push(`${s.name} = ${pin}`);
    }
    const hasManager = db.prepare("SELECT 1 FROM staff WHERE role = 'manager' AND active = 1").get();
    if (!hasManager) {
      const pin = db.prepare('SELECT 1 FROM staff WHERE pin_hash = ?').get(hashPin('999999')) ? '909090' : '999999';
      db.prepare("INSERT INTO staff (name, pin_hash, role, can_void) VALUES ('ผู้จัดการ', ?, 'manager', 1)").run(hashPin(pin));
      created.push(`ผู้จัดการ (manager) = ${pin}`);
    }
  });
  if (created.length) console.log(`[auth] ตั้ง PIN เริ่มต้น → ${created.join(', ')}  (เปลี่ยนได้ที่เมนู "พนักงาน")`);
})();

// ---------- types ----------
export interface Me {
  id: number;
  name: string;
  role: 'manager' | 'staff';
  canVoid: boolean;
  /** สาขาที่กำลังใช้งาน */
  branchId: number;
  /** สาขาที่เข้าได้ (ผู้จัดการ = ทุกสาขา) */
  branchIds: number[];
}

const STAFF_COLS = "id, name, role, active, can_void AS canVoid, last_login AS lastLogin, last_branch_id AS lastBranchId";
const q = {
  byPin: db.prepare(`SELECT ${STAFF_COLS} FROM staff WHERE pin_hash = ?`),
  byId: db.prepare(`SELECT ${STAFF_COLS} FROM staff WHERE id = ?`),
  insSession: db.prepare('INSERT INTO sessions (token, staff_id, expires_at, branch_id) VALUES (?, ?, ?, ?)'),
  session: db.prepare(
    `SELECT s.token, s.expires_at AS expiresAt, s.branch_id AS sessionBranch, ${STAFF_COLS.split(', ').map((c) => 'st.' + c).join(', ')}
       FROM sessions s JOIN staff st ON st.id = s.staff_id WHERE s.token = ?`,
  ),
  touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  delStaffSessions: db.prepare('DELETE FROM sessions WHERE staff_id = ?'),
  purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  lastLogin: db.prepare("UPDATE staff SET last_login = datetime('now', 'localtime') WHERE id = ?"),
  list: db.prepare(`SELECT ${STAFF_COLS}, pin_hash IS NOT NULL AS hasPin FROM staff ORDER BY active DESC, role, id`),
  activeManagers: db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role = 'manager' AND active = 1 AND id != ?"),
  allBranches: db.prepare('SELECT id FROM branches WHERE deleted_at IS NULL ORDER BY is_main DESC, code, id'),
  staffBranches: db.prepare(
    'SELECT b.id FROM staff_branches sb JOIN branches b ON b.id = sb.branch_id WHERE sb.staff_id = ? AND b.deleted_at IS NULL ORDER BY b.is_main DESC, b.code, b.id',
  ),
  setSessionBranch: db.prepare('UPDATE sessions SET branch_id = ? WHERE token = ?'),
  setLastBranch: db.prepare('UPDATE staff SET last_branch_id = ? WHERE id = ?'),
};

type StaffRow = { id: number; name: string; role: 'manager' | 'staff'; active: number; canVoid: number; lastLogin: string | null; lastBranchId: number | null };

/** สาขาที่พนักงานคนนี้เข้าได้ — ผู้จัดการเข้าได้ทุกสาขา */
export function allowedBranches(r: { id: number; role: string }): number[] {
  const rows = (r.role === 'manager' ? q.allBranches.all() : q.staffBranches.all(r.id)) as { id: number }[];
  return rows.map((x) => x.id);
}
function pickBranch(r: StaffRow, wanted: number | null | undefined): number {
  const ids = allowedBranches(r);
  if (!ids.length) throw new HttpError(403, `${r.name} ยังไม่ได้ถูกกำหนดสาขา — ให้ผู้จัดการกำหนดที่เมนู พนักงาน`, 'NO_BRANCH');
  if (wanted && ids.includes(wanted)) return wanted;
  if (r.lastBranchId && ids.includes(r.lastBranchId)) return r.lastBranchId;
  return ids.includes(mainBranchId()) ? mainBranchId() : ids[0];
}
const toMe = (r: StaffRow, branchId: number): Me => ({
  id: r.id, name: r.name, role: r.role, canVoid: !!r.canVoid, branchId, branchIds: allowedBranches(r),
});

// ---------- กันเดา PIN ----------
const attempts = new Map<string, { fails: number; until: number }>();

export function clientIp(req: IncomingMessage) {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function checkPin(pin: unknown, key: string): StaffRow {
  const a = attempts.get(key);
  const now = Date.now();
  if (a && a.until > now) {
    throw new HttpError(429, `กรอก PIN ผิดหลายครั้ง กรุณารอ ${Math.ceil((a.until - now) / 1000)} วินาที`, 'LOCKED');
  }
  const p = String(pin ?? '');
  const row = PIN_RE.test(p) ? (q.byPin.get(hashPin(p)) as StaffRow | undefined) : undefined;
  if (!row || !row.active) {
    const fails = (a && a.until <= now && a.fails >= MAX_FAILS ? 0 : a?.fails ?? 0) + 1;
    attempts.set(key, { fails, until: fails >= MAX_FAILS ? now + LOCK_MS : 0 });
    const left = MAX_FAILS - fails;
    throw new HttpError(401, left > 0 ? `PIN ไม่ถูกต้อง (เหลือ ${left} ครั้ง)` : 'PIN ผิดเกินกำหนด ล็อก 60 วินาที', 'BAD_PIN');
  }
  attempts.delete(key);
  return row;
}

// ---------- session ----------
export function login(pin: unknown, ip: string) {
  const row = checkPin(pin, 'login:' + ip);
  const branchId = pickBranch(row, null);
  const token = randomBytes(32).toString('hex');
  q.purge.run(Date.now());
  q.insSession.run(token, row.id, Date.now() + SESSION_HOURS * 3600_000, branchId);
  q.lastLogin.run(row.id);
  q.setLastBranch.run(branchId, row.id);
  return { token, staff: toMe(row, branchId) };
}

export function logout(token: string | null) {
  if (token) q.delSession.run(token);
  return { ok: true };
}

export function tokenOf(req: IncomingMessage, url: URL) {
  const h = String(req.headers.authorization ?? '');
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return url.searchParams.get('token'); // ใช้กับลิงก์ดาวน์โหลด CSV
}

/** ตรวจ token → คืนข้อมูลพนักงาน (ต่ออายุ session แบบ sliding) */
export function authenticate(req: IncomingMessage, url: URL): Me {
  const token = tokenOf(req, url);
  if (!token || token.length !== 64) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ', 'AUTH');
  const r = q.session.get(token) as (StaffRow & { token: string; expiresAt: number; sessionBranch: number | null }) | undefined;
  const a = Buffer.from(token);
  if (!r || !timingSafeEqual(a, Buffer.from(r.token)) || r.expiresAt < Date.now() || !r.active) {
    if (r) q.delSession.run(token);
    throw new HttpError(401, 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่', 'AUTH');
  }
  if (r.expiresAt - Date.now() < (SESSION_HOURS - 1) * 3600_000) q.touch.run(Date.now() + SESSION_HOURS * 3600_000, token);
  // สาขาของ session (ถ้าถูกถอดสิทธิ์/สาขาถูกลบ → ย้ายไปสาขาที่ยังเข้าได้)
  const branchId = pickBranch(r, r.sessionBranch);
  if (branchId !== r.sessionBranch) q.setSessionBranch.run(branchId, token);
  return toMe(r, branchId);
}

/** สลับสาขา (เฉพาะสาขาที่ได้รับสิทธิ์) */
export function switchBranch(req: IncomingMessage, url: URL, me: Me, branchId: unknown) {
  const id = Number(branchId);
  if (!me.branchIds.includes(id)) throw new HttpError(403, 'คุณไม่มีสิทธิ์เข้าสาขานี้', 'NO_PERMISSION');
  const token = tokenOf(req, url);
  if (token) q.setSessionBranch.run(id, token);
  q.setLastBranch.run(id, me.id);
  return { ...me, branchId: id };
}

/** อนุมัติการยกเลิกบิลด้วย PIN → คืนพนักงานเจ้าของ PIN */
export function approveVoid(pin: unknown, ip: string): Me {
  const row = checkPin(pin, 'void:' + ip);
  if (!row.canVoid) throw new HttpError(403, `${row.name} ไม่มีสิทธิ์ยกเลิกบิล กรุณาใช้ PIN ผู้จัดการ`, 'NO_PERMISSION');
  const b = currentBranch();
  if (!allowedBranches(row).includes(b)) throw new HttpError(403, `${row.name} ไม่ได้ดูแลสาขานี้ กรุณาใช้ PIN ของพนักงานสาขานี้หรือผู้จัดการ`, 'NO_PERMISSION');
  return toMe(row, b);
}

export function requireManager(me: Me) {
  if (me.role !== 'manager') throw new HttpError(403, 'เฉพาะผู้จัดการเท่านั้น', 'NO_PERMISSION');
}

// ---------- จัดการพนักงาน (ผู้จัดการ) ----------
export function listStaff() {
  return (q.list.all() as (StaffRow & { hasPin: number })[]).map((r) => ({
    id: r.id, name: r.name, role: r.role, active: !!r.active, canVoid: !!r.canVoid, lastLogin: r.lastLogin, hasPin: !!r.hasPin,
    branchIds: (q.staffBranches.all(r.id) as { id: number }[]).map((x) => x.id),
  }));
}

interface StaffBody { name?: string; pin?: string; role?: string; active?: boolean; canVoid?: boolean; branchIds?: unknown }

/** สาขาที่กำหนดให้พนักงาน (พนักงานขายต้องมีอย่างน้อย 1 สาขา) */
function cleanBranchIds(v: unknown, role: string): number[] | null {
  if (v === undefined) return null;
  const valid = new Set((q.allBranches.all() as { id: number }[]).map((x) => x.id));
  const ids = [...new Set((Array.isArray(v) ? v : []).map(Number))].filter((n) => valid.has(n));
  if (role !== 'manager' && !ids.length) throw new HttpError(422, 'กรุณาเลือกสาขาที่พนักงานคนนี้ดูแลอย่างน้อย 1 สาขา');
  return ids;
}
function setStaffBranches(staffId: number, ids: number[]) {
  db.prepare('DELETE FROM staff_branches WHERE staff_id = ?').run(staffId);
  const ins = db.prepare('INSERT OR IGNORE INTO staff_branches (staff_id, branch_id) VALUES (?, ?)');
  for (const b of ids) ins.run(staffId, b);
}

function validPin(pin: string, exceptId?: number) {
  if (!PIN_RE.test(pin)) throw new HttpError(422, 'PIN ต้องเป็นตัวเลข 6 หลัก');
  if (/^(\d)\1{5}$/.test(pin)) throw new HttpError(422, 'PIN ง่ายเกินไป (ห้ามใช้เลขซ้ำทั้ง 6 หลัก)');
  const dup = q.byPin.get(hashPin(pin)) as StaffRow | undefined;
  if (dup && dup.id !== exceptId) throw new HttpError(409, 'PIN นี้ถูกใช้แล้ว กรุณาเลือก PIN อื่น');
}

export function createStaff(body: StaffBody, me: Me) {
  const name = body.name?.trim();
  if (!name) throw new HttpError(422, 'กรุณาระบุชื่อพนักงาน');
  const pin = String(body.pin ?? '');
  validPin(pin);
  const role = body.role === 'manager' ? 'manager' : 'staff';
  const branches = cleanBranchIds(body.branchIds ?? [me.branchId], role) ?? [me.branchId];
  const id = tx(() => {
    const r = db
      .prepare('INSERT INTO staff (name, pin_hash, role, can_void, active) VALUES (?, ?, ?, ?, 1)')
      .run(name.slice(0, 60), hashPin(pin), role, body.canVoid === false ? 0 : role === 'manager' || body.canVoid ? 1 : 0);
    const id = Number(r.lastInsertRowid);
    setStaffBranches(id, branches);
    return id;
  });
  return listStaff().find((s) => s.id === id);
}

export function updateStaff(id: number, body: StaffBody, me: Me) {
  const cur = q.byId.get(id) as StaffRow | undefined;
  if (!cur) throw new HttpError(404, 'ไม่พบพนักงาน');
  const name = body.name !== undefined ? body.name.trim() : cur.name;
  if (!name) throw new HttpError(422, 'กรุณาระบุชื่อพนักงาน');
  const role = body.role === 'manager' || body.role === 'staff' ? body.role : cur.role;
  const active = body.active !== undefined ? body.active : !!cur.active;
  const canVoid = body.canVoid !== undefined ? body.canVoid : !!cur.canVoid;
  // ต้องเหลือผู้จัดการที่ใช้งานได้อย่างน้อย 1 คน
  if (cur.role === 'manager' && cur.active && (role !== 'manager' || !active)) {
    const { n } = q.activeManagers.get(id) as { n: number };
    if (n === 0) throw new HttpError(409, 'ต้องมีผู้จัดการที่ใช้งานได้อย่างน้อย 1 คน');
  }
  if (id === me.id && !active) throw new HttpError(409, 'ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้');
  tx(() => {
    if (body.pin) {
      validPin(String(body.pin), id);
      db.prepare('UPDATE staff SET pin_hash = ? WHERE id = ?').run(hashPin(String(body.pin)), id);
      q.delStaffSessions.run(id); // เปลี่ยน PIN → ออกจากระบบทุกเครื่อง
    }
    db.prepare('UPDATE staff SET name = ?, role = ?, active = ?, can_void = ? WHERE id = ?').run(name.slice(0, 60), role, active ? 1 : 0, canVoid ? 1 : 0, id);
    const branches = cleanBranchIds(body.branchIds, role);
    if (branches) setStaffBranches(id, branches);
    if (!active) q.delStaffSessions.run(id);
  });
  return listStaff().find((s) => s.id === id);
}
