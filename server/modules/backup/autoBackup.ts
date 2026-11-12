// สำรองข้อมูลอัตโนมัติลงคอมของร้าน (แอปเดสก์ท็อป .exe) — ตั้งค่าแยกแต่ละเครื่อง
// เครื่องที่เปิด "สำรองอัตโนมัติ" ได้กุญแจของตัวเอง 1 อัน (ผู้จัดการเปิดจากหน้า ตั้งค่า → สำรอง & กู้คืนข้อมูล)
//   แอปใช้กุญแจนี้ดาวน์โหลดไฟล์สำรองได้แม้ยังไม่มีใครเข้าสู่ระบบ (เช่น ปิดโปรแกรมหลังออกจากระบบแล้ว)
//   กุญแจทำได้อย่างเดียวคือดาวน์โหลดไฟล์สำรอง · เก็บเฉพาะค่าแฮช · ยกเลิกได้จากหน้าเดียวกัน
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { db, DB_PATH } from '../../core/db.ts';
import { HttpError } from '../../core/common.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS backup_devices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_by   TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_used_at TEXT,
    last_ip      TEXT NOT NULL DEFAULT '',
    revoked_at   TEXT
  );
`);

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export interface BackupDevice { id: number; name: string; createdBy: string; createdAt: string; lastUsedAt: string | null; lastIp: string }

/** ออกกุญแจให้เครื่องนี้ (คืน token ครั้งเดียว — เซิร์ฟเวอร์เก็บแค่แฮช) */
export function createDevice(name: unknown, by: string) {
  const n = String(name ?? '').trim().slice(0, 80) || 'เครื่องไม่มีชื่อ';
  const token = `pbk_${randomBytes(24).toString('hex')}`;
  const r = db.prepare('INSERT INTO backup_devices (name, token_hash, created_by) VALUES (?, ?, ?)').run(n, hash(token), by.slice(0, 80));
  return { id: Number(r.lastInsertRowid), name: n, token };
}

export function listDevices(): BackupDevice[] {
  return (db.prepare(
    `SELECT id, name, created_by AS createdBy, created_at AS createdAt, last_used_at AS lastUsedAt, last_ip AS lastIp
     FROM backup_devices WHERE revoked_at IS NULL ORDER BY id DESC`,
  ).all() as unknown as BackupDevice[]).map((d) => {
    const m = seen.get(d.id);
    return m && (!d.lastUsedAt || m.at > d.lastUsedAt) ? { ...d, lastUsedAt: m.at, lastIp: m.ip } : d;
  });
}

export function revokeDevice(id: unknown) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'รหัสเครื่องไม่ถูกต้อง');
  db.prepare("UPDATE backup_devices SET revoked_at = datetime('now', 'localtime') WHERE id = ? AND revoked_at IS NULL").run(n);
}

/** ใช้ล่าสุด (ในหน่วยความจำ) — ไม่เขียนฐานข้อมูลทุกครั้ง ไม่งั้นข้อมูล "เปลี่ยน" เองทุกรอบ แล้วข้ามรอบที่ไม่เปลี่ยนไม่ได้ */
const seen = new Map<number, { at: string; ip: string }>();
const nowLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** ตรวจกุญแจจาก header X-Backup-Key · ไม่ถูกต้อง/ถูกยกเลิก → 401 */
export function deviceByKey(key: string, ip: string) {
  const row = /^pbk_[a-f0-9]{48}$/.test(key)
    ? (db.prepare('SELECT id, name, last_used_at FROM backup_devices WHERE token_hash = ? AND revoked_at IS NULL').get(hash(key)) as { id: number; name: string; last_used_at: string | null } | undefined)
    : undefined;
  if (!row) throw new HttpError(401, 'สิทธิ์สำรองอัตโนมัติของเครื่องนี้ถูกยกเลิกหรือใช้ไม่ได้ — เปิด ตั้งค่า → สำรอง & กู้คืนข้อมูล แล้วเปิดสำรองอัตโนมัติใหม่', 'BACKUP_KEY');
  const at = nowLocal();
  seen.set(row.id, { at, ip: ip.slice(0, 60) });
  // บันทึกลงฐานข้อมูลวันละครั้งพอ (ดูย้อนหลังได้หลังรีสตาร์ต)
  if (!row.last_used_at || row.last_used_at.slice(0, 10) !== at.slice(0, 10)) {
    db.prepare('UPDATE backup_devices SET last_used_at = ?, last_ip = ? WHERE id = ?').run(at, ip.slice(0, 60), row.id);
  }
  return row;
}

/** ตัวบอกว่าข้อมูลเปลี่ยนหรือยัง (เวลาแก้ไขล่าสุดของ .db / -wal) — แอปส่งค่าเดิมมา ถ้าตรง = ไม่ต้องสำรองซ้ำ */
export function dataStamp() {
  let t = 0;
  for (const f of [DB_PATH, `${DB_PATH}-wal`]) if (existsSync(f)) t = Math.max(t, statSync(f).mtimeMs);
  return String(Math.floor(t));
}
