// API key สำหรับระบบภายนอก และการเชื่อมสาขา
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db, mainBranchId } from './db.ts';
import { HttpError } from './common.ts';
import type { Me } from './auth.ts';
import { getSettings } from './settings.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    scope        TEXT NOT NULL CHECK (scope IN ('read', 'write', 'sync')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by   TEXT,
    last_used_at TEXT,
    revoked      INTEGER NOT NULL DEFAULT 0
  );
`);

export type Scope = 'read' | 'write' | 'sync';
export const SCOPE_LABEL: Record<Scope, string> = {
  read: 'อ่านอย่างเดียว (GET)',
  write: 'อ่าน + เขียน (เหมือนผู้จัดการ)',
  sync: 'เชื่อมสาขา (ดึงข้อมูลสินค้า)',
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function listKeys() {
  return db
    .prepare(
      `SELECT id, name, prefix, scope, created_at AS createdAt, created_by AS createdBy, last_used_at AS lastUsedAt
         FROM api_keys WHERE revoked = 0 AND scope != 'sync' ORDER BY id DESC`,
    )
    .all();
}

export function createKey(body: { name?: string; scope?: string }, me: Me) {
  const name = String(body.name ?? '').trim().slice(0, 60);
  if (!name) throw new HttpError(422, 'กรุณาตั้งชื่อ API key เช่น "สาขา 2" หรือ "เว็บไซต์"');
  const scope = (['read', 'write'] as const).find((s) => s === body.scope);
  if (!scope) throw new HttpError(422, 'กรุณาเลือกสิทธิ์ของ key');
  const key = `pos_${randomBytes(24).toString('hex')}`;
  const r = db
    .prepare('INSERT INTO api_keys (name, prefix, key_hash, scope, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(name, key.slice(0, 10), sha(key), scope, me.name);
  // แสดง key เต็มครั้งเดียวตอนสร้าง (เก็บเฉพาะค่า hash)
  return { id: Number(r.lastInsertRowid), name, scope, key, prefix: key.slice(0, 10) };
}

export function revokeKey(id: number) {
  const r = db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND revoked = 0').run(id);
  if (r.changes !== 1) throw new HttpError(404, 'ไม่พบ API key');
  return { ok: true };
}

/** อ่าน key จาก header: X-API-Key: pos_… หรือ Authorization: Bearer pos_… */
export function apiKeyOf(req: IncomingMessage): string | null {
  const h = String(req.headers['x-api-key'] ?? '').trim();
  if (h.startsWith('pos_')) return h;
  const a = String(req.headers.authorization ?? '');
  const m = /^Bearer\s+(pos_[a-f0-9]{48})$/i.exec(a);
  return m ? m[1] : null;
}

/**
 * ตรวจ API key → ผู้ใช้เสมือน
 * read = GET อย่างเดียว · write = สิทธิ์ผู้จัดการ
 * เลือกสาขาด้วย header X-Branch: <รหัสสาขา> (ไม่ส่ง = สาขาหลัก)
 */
export function authenticateKey(key: string, method: string, req: IncomingMessage): Me & { keyId: number } {
  const row = db.prepare('SELECT id, name, scope FROM api_keys WHERE key_hash = ? AND revoked = 0').get(sha(key)) as
    | { id: number; name: string; scope: Scope }
    | undefined;
  if (!row) throw new HttpError(401, 'API key ไม่ถูกต้องหรือถูกยกเลิกแล้ว', 'AUTH');
  const s = getSettings();
  if (row.scope === 'sync') throw new HttpError(403, 'key เชื่อมสาขาแบบเดิมเลิกใช้แล้ว (ทุกสาขาใช้เว็บเดียวกัน)', 'NO_PERMISSION');
  if (!s.api.enabled) throw new HttpError(403, 'ยังไม่ได้เปิดใช้ API (ตั้งค่า → ระบบ API)', 'NO_PERMISSION');
  if (row.scope === 'read' && method !== 'GET') throw new HttpError(403, 'key นี้อ่านได้อย่างเดียว', 'NO_PERMISSION');
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now', 'localtime') WHERE id = ?").run(row.id);
  const all = (db.prepare('SELECT id, code FROM branches WHERE deleted_at IS NULL').all() as { id: number; code: string }[]);
  const wanted = String(req.headers['x-branch'] ?? '').trim().toUpperCase();
  const b = wanted ? all.find((x) => x.code.toUpperCase() === wanted) : null;
  if (wanted && !b) throw new HttpError(404, `ไม่พบสาขารหัส ${wanted}`);
  return {
    id: 0, keyId: row.id, name: `API: ${row.name}`, role: row.scope === 'read' ? 'staff' : 'manager', canVoid: false,
    branchId: b?.id ?? mainBranchId(), branchIds: all.map((x) => x.id),
  };
}
