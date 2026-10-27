// ฐานข้อมูล license + instance ของร้านทดลอง (node:sqlite — ไม่มี dependency ภายนอก)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomInt } from 'node:crypto';

export const DB_PATH = resolve(process.env.LICENSE_DB ?? 'data/license.db');
mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS licenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT NOT NULL UNIQUE,              -- POS-XXXX-XXXX
    shop          TEXT NOT NULL,                     -- ชื่อร้าน
    slug          TEXT NOT NULL UNIQUE,              -- โดเมนย่อย a → a.trial.sh0p.tech
    days          INTEGER NOT NULL,                  -- อายุ (นับจากวันที่เปิดใช้งานครั้งแรก)
    max_machines  INTEGER NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'active',    -- active | revoked
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    activated_at  TEXT,                              -- เปิดใช้งานครั้งแรก
    expires_at    TEXT,                              -- activated_at + days
  image         TEXT NOT NULL DEFAULT '',          -- รูปร้าน (data URL)
  image_at      TEXT NOT NULL DEFAULT ''           -- เวลาเปลี่ยนรูป (ใช้ล้างแคช)
  );

  CREATE TABLE IF NOT EXISTS instances (
    slug        TEXT PRIMARY KEY REFERENCES licenses(slug) ON UPDATE CASCADE,
    port        INTEGER NOT NULL UNIQUE,
    manager_pin TEXT NOT NULL,                       -- PIN ผู้จัดการเริ่มต้น (ร้านเปลี่ยนเองได้ในระบบ POS)
    state       TEXT NOT NULL DEFAULT 'running',     -- running | stopped | error
    error       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS machines (
    license_id  INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    machine_id  TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    first_seen  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_seen   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (license_id, machine_id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    license_id INTEGER,
    kind       TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT ''
  );
`);

// ฐานข้อมูลรุ่นแรกมีคอลัมน์ instances.url (ที่อยู่ร้าน) — ตอนนี้คำนวณจากคำขอแทน จึงลบออก
if ((db.prepare("SELECT 1 FROM pragma_table_info('instances') WHERE name = 'url'").get())) db.exec('ALTER TABLE instances DROP COLUMN url');
// รูปร้าน (แสดงในแผงควบคุม) — data URL ขนาดเล็กที่ย่อจากเบราว์เซอร์แล้ว
if (!(db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name = 'image'").get())) {
  db.exec("ALTER TABLE licenses ADD COLUMN image TEXT NOT NULL DEFAULT ''");
  db.exec("ALTER TABLE licenses ADD COLUMN image_at TEXT NOT NULL DEFAULT ''");
}

export interface License {
  id: number;
  code: string;
  shop: string;
  slug: string;
  days: number;
  max_machines: number;
  note: string;
  status: 'active' | 'revoked';
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  image: string;
  image_at: string;
}
export interface Instance {
  slug: string;
  port: number;
  manager_pin: string;
  state: 'running' | 'stopped' | 'error';
  error: string;
  created_at: string;
}
export interface Machine {
  license_id: number;
  machine_id: string;
  name: string;
  first_seen: string;
  last_seen: string;
}

// ตัวอักษรที่อ่านง่าย (ไม่มี 0/O, 1/I/L)
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const part = () => Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
export function newCode() {
  for (;;) {
    const code = `POS-${part()}-${part()}`;
    if (!db.prepare('SELECT 1 FROM licenses WHERE code = ?').get(code)) return code;
  }
}
/** รับได้ทั้งตัวเล็ก/ไม่มีขีด/มีช่องว่าง → POS-XXXX-XXXX */
export function normalizeCode(raw: unknown) {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = s.startsWith('POS') ? s.slice(3) : s;
  return body.length === 8 ? `POS-${body.slice(0, 4)}-${body.slice(4)}` : '';
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
// ชื่อที่ใช้เป็นโดเมนย่อยไม่ได้ (VPS: <ชื่อย่อ>.trial.โดเมน)
const RESERVED = new Set(['www', 'admin', 'api', 'license', 'mail', 'pos', 'updates', 'download', 'trial']);
export const slugOk = (s: string) => SLUG_RE.test(s) && !RESERVED.has(s);

export const getLicense = (code: string) => db.prepare('SELECT * FROM licenses WHERE code = ?').get(code) as License | undefined;
export const getLicenseBySlug = (slug: string) => db.prepare('SELECT * FROM licenses WHERE slug = ?').get(slug) as License | undefined;
export const getLicenseById = (id: number) => db.prepare('SELECT * FROM licenses WHERE id = ?').get(id) as License | undefined;
export const getInstance = (slug: string) => db.prepare('SELECT * FROM instances WHERE slug = ?').get(slug) as Instance | undefined;
export const machinesOf = (id: number) => db.prepare('SELECT * FROM machines WHERE license_id = ? ORDER BY first_seen').all(id) as unknown as Machine[];
export const logEvent = (licenseId: number | null, kind: string, detail = '') =>
  db.prepare('INSERT INTO events (license_id, kind, detail) VALUES (?, ?, ?)').run(licenseId, kind, detail.slice(0, 500));

/** พอร์ตว่างตัวแรกในช่วงที่กำหนด */
export function freePort(min: number, max: number) {
  const used = new Set((db.prepare('SELECT port FROM instances').all() as { port: number }[]).map((r) => r.port));
  for (let p = min; p <= max; p++) if (!used.has(p)) return p;
  throw new Error(`พอร์ตเต็ม (${min}–${max})`);
}

/** เวลาเครื่องแบบ 'YYYY-MM-DD HH:MM:SS' (ตรงกับ datetime('now','localtime')) */
export function localStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export const parseStamp = (s: string) => new Date(s.replace(' ', 'T'));
export const isExpired = (l: License, now = new Date()) => !!l.expires_at && parseStamp(l.expires_at) <= now;
export function daysLeft(l: License, now = new Date()) {
  if (!l.expires_at) return l.days;
  return Math.max(0, Math.ceil((parseStamp(l.expires_at).getTime() - now.getTime()) / 86_400_000));
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
