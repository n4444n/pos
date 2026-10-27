// ข้อมูลร้าน + สำรองข้อมูลของร้านทดลอง
// ถามเซิร์ฟเวอร์ POS ของร้านผ่าน API ภายใน http://127.0.0.1:<พอร์ต>/api/internal/* (ร้านต้องเปิดอยู่)
// token ของแต่ละร้าน = HMAC(ความลับของเซิร์ฟเวอร์ license, ชื่อย่อร้าน) — ส่งให้ร้านตอนเปิด (env POS_INTERNAL_TOKEN)
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DB_PATH, localStamp, sign } from './store.ts';

export const tokenFor = (slug: string) => sign(`pos-internal:${slug}`);

/** โฟลเดอร์เก็บไฟล์สำรอง: <BACKUP_DIR>/<ร้าน>/<ร้าน>-YYYYMMDD-HHMMSS[-b<สาขา>][-auto].db (-b = เฉพาะสาขา) */
export const BACKUP_ROOT = resolve(process.env.BACKUP_DIR ?? join(dirname(DB_PATH), 'backups'));
const KEEP = 20; // เก็บไฟล์ล่าสุดต่อร้าน
const AUTO_EVERY_MS = 24 * 3600_000; // สำรองอัตโนมัติวันละครั้ง (ร้านที่เปิดอยู่)
const FILE_RE = /^[a-z0-9-]{1,30}-\d{8}-\d{6}(-b\d{1,6})?(-auto)?\.db$/;

async function call(port: number, slug: string, what: string, timeoutMs: number) {
  const r = await fetch(`http://127.0.0.1:${port}/api/internal/${what}`, {
    headers: { 'X-POS-Internal': tokenFor(slug) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (r.status === 404) throw new Error('ระบบร้านรุ่นนี้ยังไม่รองรับ — หยุดร้านแล้วเปิดใหม่หนึ่งครั้ง');
  if (!r.ok) throw new Error(`ระบบร้านตอบ HTTP ${r.status}`);
  return r;
}

export async function shopStats(port: number, slug: string) {
  return (await call(port, slug, 'stats', 5000)).json() as Promise<Record<string, unknown>>;
}

export interface BackupFile { file: string; size: number; at: string; auto: boolean; branch: number | null }

export function listBackups(slug: string): BackupFile[] {
  const dir = join(BACKUP_ROOT, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => FILE_RE.test(f) && f.startsWith(`${slug}-`))
    .map((f) => {
      const m = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-b(\d+))?/.exec(f.slice(slug.length))!;
      return {
        file: f, size: statSync(join(dir, f)).size, at: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`,
        auto: f.endsWith('-auto.db'), branch: m[7] ? Number(m[7]) : null,
      };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

/** ขอสำเนาฐานข้อมูลจากร้านแล้วบันทึกลงโฟลเดอร์สำรอง · branch = เฉพาะสาขา · ลบไฟล์เก่าเกิน KEEP */
export async function backupShop(slug: string, port: number, auto = false, branch?: number): Promise<BackupFile> {
  const buf = Buffer.from(await (await call(port, slug, `backup${branch ? `?branch=${branch}` : ''}`, 120_000)).arrayBuffer());
  if (buf.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw new Error('ไฟล์สำรองที่ได้ไม่ใช่ฐานข้อมูล SQLite');
  const dir = join(BACKUP_ROOT, slug);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = `${slug}-${localStamp().replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1-')}${branch ? `-b${branch}` : ''}${auto ? '-auto' : ''}.db`;
  writeFileSync(join(dir, file), buf, { mode: 0o600 });
  for (const old of listBackups(slug).slice(KEEP)) unlinkSync(join(dir, old.file));
  return listBackups(slug).find((b) => b.file === file)!;
}

/** ที่อยู่ไฟล์สำรอง (ตรวจชื่อไฟล์ — กันอ่านไฟล์นอกโฟลเดอร์) */
export function backupPath(slug: string, file: string) {
  if (!FILE_RE.test(file) || !file.startsWith(`${slug}-`)) return null;
  const p = join(BACKUP_ROOT, slug, file);
  return existsSync(p) ? p : null;
}

export const needsAutoBackup = (slug: string) => {
  const last = listBackups(slug)[0];
  return !last || Date.now() - new Date(last.at.replace(' ', 'T')).getTime() > AUTO_EVERY_MS;
};

/** ลบร้าน → ย้ายไฟล์สำรองไป backups/_deleted/<ร้าน>-<เวลา> (ร้านใหม่ชื่อเดิมจะไม่เห็นไฟล์ของร้านเก่า) */
export function archiveBackups(slug: string) {
  const dir = join(BACKUP_ROOT, slug);
  if (!existsSync(dir)) return;
  mkdirSync(join(BACKUP_ROOT, '_deleted'), { recursive: true, mode: 0o700 });
  renameSync(dir, join(BACKUP_ROOT, '_deleted', `${slug}-${localStamp().replace(/[-: ]/g, '')}`));
}
