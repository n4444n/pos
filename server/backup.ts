// สำรอง / กู้คืนข้อมูล แยกตามสาขา
// - ไฟล์สำรอง = ฐานข้อมูล SQLite ทั้งไฟล์ (VACUUM INTO — ไม่ต้องหยุดร้าน)
//   สำรองเฉพาะสาขา = ตัดข้อมูลของสาขาอื่นออกจากสำเนา (สินค้า/พนักงาน/ตั้งค่าที่ใช้ร่วมกันยังอยู่ครบ)
// - กู้คืน = แทนที่ "ข้อมูลของสาขาที่เลือก" ด้วยข้อมูลในไฟล์ (ตาราง BRANCH_DATA ด้านล่าง)
//   สาขาอื่น · สินค้า · หมวดหมู่ · พนักงาน · ตั้งค่า · ใบโอนสินค้าระหว่างสาขา ไม่ถูกแตะ
//   ก่อนกู้คืนสำรองข้อมูลปัจจุบันทั้งร้านไว้ใน data/backups/ เสมอ (ย้อนกลับได้)
//   เลขที่บิล/เอกสารที่เคยออกแล้วถูกจำไว้ (docFloor.ts) — หลังกู้คืนรันเลขต่อ ไม่ออกเลขซ้ำ
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { db, DB_PATH } from './db.ts';
import { HttpError } from './common.ts';
import { getSettings } from './settings.ts';
import { rememberDocNos } from './docFloor.ts';

const DATA_DIR = dirname(DB_PATH);
export const LOCAL_BACKUPS = join(DATA_DIR, 'backups');
const UPLOADS = join(DATA_DIR, 'restore-uploads');
const APP_ID = 'clothing-pos';

/**
 * ข้อมูลของสาขา — เรียงจาก "แม่" ไป "ลูก" (เพิ่มตามลำดับนี้ · ลบย้อนลำดับ)
 * where(s) = เงื่อนไขเลือกแถวของสาขา :b ในฐานข้อมูล s ('main' หรือ 'bk')
 */
const BRANCH_DATA: { table: string; label: string; where: (s: string) => string }[] = [
  { table: 'shifts_all', label: 'กะ', where: () => 'branch_id = :b' },
  { table: 'orders_all', label: 'บิลขาย', where: () => 'branch_id = :b' },
  { table: 'order_items', label: 'รายการในบิล', where: (s) => `order_id IN (SELECT id FROM ${s}.orders_all WHERE branch_id = :b)` },
  { table: 'order_edits', label: 'ประวัติแก้ไขบิล', where: (s) => `order_id IN (SELECT id FROM ${s}.orders_all WHERE branch_id = :b)` },
  { table: 'payments_all', label: 'การชำระเงิน', where: () => 'branch_id = :b' },
  { table: 'cash_movements_all', label: 'เงินเข้า-ออกในกะ', where: () => 'branch_id = :b' },
  { table: 'stock_moves_all', label: 'ความเคลื่อนไหวสต็อก', where: () => 'branch_id = :b' },
  { table: 'branch_stock', label: 'สต็อก/ราคาสาขา', where: () => 'branch_id = :b' },
  { table: 'expenses', label: 'ค่าใช้จ่าย', where: () => 'branch_id = :b' },
  { table: 'expense_items', label: 'รายการค่าใช้จ่าย', where: (s) => `expense_id IN (SELECT id FROM ${s}.expenses WHERE branch_id = :b)` },
  { table: 'held_bills', label: 'บิลที่พักไว้', where: () => 'branch_id = :b' },
  { table: 'tax_invoices', label: 'ใบกำกับภาษีเต็มรูป', where: () => 'branch_id = :b' },
  { table: 'credit_notes', label: 'ใบลดหนี้', where: () => 'branch_id = :b' },
  { table: 'credit_note_items', label: 'รายการใบลดหนี้', where: (s) => `credit_note_id IN (SELECT id FROM ${s}.credit_notes WHERE branch_id = :b)` },
];

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const quote = (path: string) => `'${path.replace(/'/g, "''")}'`;
const tablesOf = (conn: DatabaseSync, schema = 'main') =>
  new Set((conn.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name));
const colsOf = (conn: DatabaseSync, table: string, schema = 'main') =>
  (conn.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

// ---------------------------------------------------------------- สร้างไฟล์สำรอง
/** สำเนาฐานข้อมูลลงไฟล์ path · branchId = เก็บเฉพาะข้อมูลสาขานั้น (ไม่ระบุ = ทั้งร้าน) */
export function writeBackup(path: string, branchId?: number) {
  mkdirSync(dirname(path), { recursive: true });
  if (branchId !== undefined && !db.prepare('SELECT 1 FROM branches WHERE id = ?').get(branchId)) throw new HttpError(404, 'ไม่พบสาขานี้');
  db.exec(`VACUUM INTO ${quote(path)}`);
  const c = new DatabaseSync(path);
  try {
    c.exec('PRAGMA foreign_keys = OFF');
    c.exec('BEGIN');
    if (branchId !== undefined) {
      const have = tablesOf(c);
      const others = (c.prepare('SELECT id FROM branches WHERE id <> ?').all(branchId) as { id: number }[]).map((r) => r.id);
      for (const t of [...BRANCH_DATA].reverse()) {
        if (!have.has(t.table)) continue;
        const del = c.prepare(`DELETE FROM main.${t.table} WHERE ${t.where('main')}`);
        for (const b of others) del.run({ b });
      }
    }
    c.exec('DELETE FROM sessions'); // ไม่เก็บ token ที่ใช้เข้าระบบอยู่
    c.exec('CREATE TABLE IF NOT EXISTS pos_backup (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const meta = c.prepare('INSERT OR REPLACE INTO pos_backup (key, value) VALUES (?, ?)');
    meta.run('app', APP_ID);
    meta.run('created_at', new Date().toISOString());
    meta.run('scope', branchId === undefined ? 'all' : String(branchId));
    meta.run('shop', getSettings().shop.name || '');
    c.exec('COMMIT');
    c.exec('VACUUM');
  } finally {
    c.close();
  }
  return path;
}

/** ไฟล์สำรองเป็น Buffer (ใช้ส่งให้ดาวน์โหลด / เซิร์ฟเวอร์ license) */
export function backupBuffer(branchId?: number): Buffer {
  const tmp = join(DATA_DIR, `.backup-${randomBytes(6).toString('hex')}.db`);
  try {
    writeBackup(tmp, branchId);
    return readFileSync(tmp);
  } finally {
    try { unlinkSync(tmp); } catch { /* ไม่มีไฟล์ */ }
  }
}

export function backupFileName(branchId?: number) {
  const b = branchId === undefined ? null : (db.prepare('SELECT name, code FROM branches WHERE id = ?').get(branchId) as { name: string; code: string } | undefined);
  const tag = b ? `-${(b.code || b.name).replace(/[^\p{L}\p{N}_-]+/gu, '_')}` : '-ทั้งร้าน';
  return `pos-backup${tag}-${stamp()}.db`;
}

// ---------------------------------------------------------------- อ่านไฟล์ที่อัปโหลด
export interface BranchSummary {
  id: number; name: string; code: string; isMain: boolean;
  bills: number; lastBillAt: string | null; openShift: boolean;
}
export interface BackupPreview {
  id: string;
  shop: string;
  createdAt: string | null;
  scope: 'all' | number;
  sameShop: boolean;
  /** สาขาในไฟล์ + ข้อมูลปัจจุบันของสาขาเดียวกัน */
  branches: (BranchSummary & { hasData: boolean; current: BranchSummary | null; lostBills: number; shipmentsAfter: number })[];
}

function summarize(conn: DatabaseSync, schema: string, id: number): BranchSummary | null {
  const b = conn.prepare(`SELECT id, name, code, is_main AS isMain FROM ${schema}.branches WHERE id = ?`).get(id) as
    { id: number; name: string; code: string; isMain: number } | undefined;
  if (!b) return null;
  const o = conn.prepare(`SELECT COUNT(*) AS n, MAX(created_at) AS last FROM ${schema}.orders_all WHERE branch_id = ? AND status <> 'void'`).get(id) as { n: number; last: string | null };
  const open = conn.prepare(`SELECT 1 FROM ${schema}.shifts_all WHERE branch_id = ? AND status = 'open'`).get(id);
  return { id: b.id, name: b.name, code: b.code, isMain: !!b.isMain, bills: o.n, lastBillAt: o.last, openShift: !!open };
}

/** ตรวจไฟล์: เป็น SQLite ไม่เสีย · เป็นฐานข้อมูลของ POS นี้ · ร้านเดียวกัน (สาขาหลักตรงกัน) */
function openChecked(path: string) {
  const head = readFileSync(path).subarray(0, 16).toString('latin1');
  if (!head.startsWith('SQLite format 3')) throw new HttpError(400, 'ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูล (.db) ของระบบ');
  let c: DatabaseSync;
  try {
    c = new DatabaseSync(path, { readOnly: true });
  } catch {
    throw new HttpError(400, 'เปิดไฟล์สำรองไม่ได้ — ไฟล์อาจเสีย');
  }
  try {
    const ok = (c.prepare('PRAGMA quick_check').get() as Record<string, string>)?.quick_check;
    if (ok !== 'ok') throw new HttpError(400, 'ไฟล์สำรองเสีย (ตรวจความสมบูรณ์ไม่ผ่าน)');
    const have = tablesOf(c);
    for (const t of ['branches', 'orders_all', 'products', 'variants_all', 'shifts_all']) {
      if (!have.has(t)) throw new HttpError(400, 'ไฟล์นี้ไม่ใช่ฐานข้อมูลของระบบ POS นี้ หรือเป็นรุ่นเก่าเกินไป (ยังไม่มีระบบหลายสาขา)');
    }
    return c;
  } catch (e) {
    c.close();
    throw e;
  }
}

function metaOf(c: DatabaseSync) {
  if (!tablesOf(c).has('pos_backup')) return {} as Record<string, string>;
  return Object.fromEntries((c.prepare('SELECT key, value FROM pos_backup').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}

/** ร้านเดียวกันไหม: สาขาหลัก (id + วันที่สร้าง) ตรงกัน */
function sameShop(c: DatabaseSync) {
  const a = c.prepare('SELECT id, created_at AS at FROM branches WHERE is_main = 1').get() as { id: number; at: string } | undefined;
  const b = db.prepare('SELECT id, created_at AS at FROM branches WHERE is_main = 1').get() as { id: number; at: string } | undefined;
  return !!a && !!b && a.id === b.id && a.at === b.at;
}

function cleanUploads() {
  if (!existsSync(UPLOADS)) return;
  for (const f of readdirSync(UPLOADS)) {
    const p = join(UPLOADS, f);
    try { if (Date.now() - statSync(p).mtimeMs > 3600_000) unlinkSync(p); } catch { /* ใช้อยู่ */ }
  }
}
const uploadPath = (id: string) => {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new HttpError(400, 'รหัสไฟล์ไม่ถูกต้อง');
  const p = join(UPLOADS, `${id}.db`);
  if (!existsSync(p)) throw new HttpError(410, 'ไฟล์ที่อัปโหลดหมดอายุแล้ว — เลือกไฟล์ใหม่อีกครั้ง');
  return p;
};
/** ที่เก็บไฟล์อัปโหลดใหม่ (ลบไฟล์ค้างเกิน 1 ชั่วโมง) */
export function newUploadPath() {
  cleanUploads();
  mkdirSync(UPLOADS, { recursive: true });
  const id = randomBytes(12).toString('hex');
  return { id, path: join(UPLOADS, `${id}.db`) };
}
export function dropUpload(id: string) {
  try { unlinkSync(join(UPLOADS, `${id}.db`)); } catch { /* ไม่มีไฟล์ */ }
}

/** สรุปไฟล์ที่อัปโหลด: สาขาในไฟล์ จำนวนบิล เทียบกับข้อมูลปัจจุบัน */
export function previewUpload(id: string): BackupPreview {
  const c = openChecked(uploadPath(id));
  try {
    const meta = metaOf(c);
    if (meta.app && meta.app !== APP_ID) throw new HttpError(400, 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบ POS นี้');
    const scope = !meta.scope || meta.scope === 'all' ? 'all' : Number(meta.scope);
    const ids = (c.prepare('SELECT id FROM branches WHERE deleted_at IS NULL ORDER BY is_main DESC, id').all() as { id: number }[]).map((r) => r.id);
    const shipments = tablesOf(db).has('shipments');
    const branches = ids.map((bid) => {
      const inFile = summarize(c, 'main', bid)!;
      const current = summarize(db, 'main', bid);
      const since = inFile.lastBillAt ?? '0000';
      const lost = current
        ? (db.prepare("SELECT COUNT(*) AS n FROM orders_all WHERE branch_id = ? AND status <> 'void' AND created_at > ?").get(bid, since) as { n: number }).n
        : 0;
      const ship = shipments && current
        ? (db.prepare('SELECT COUNT(*) AS n FROM shipments WHERE (dest_branch_id = ? OR source_branch_id = ?) AND created_at > ?').get(bid, bid, since) as { n: number }).n
        : 0;
      const hasData = scope === 'all' || scope === bid;
      return { ...inFile, hasData, current, lostBills: hasData ? lost : 0, shipmentsAfter: hasData ? ship : 0 };
    });
    return { id, shop: meta.shop ?? '', createdAt: meta.created_at ?? null, scope, sameShop: sameShop(c), branches };
  } finally {
    c.close();
  }
}

// ---------------------------------------------------------------- กู้คืน
export interface RestoreResult {
  branches: { id: number; name: string; rows: number }[];
  safetyBackup: string;
}

/** แทนที่ข้อมูลของสาขาที่เลือกด้วยข้อมูลจากไฟล์ที่อัปโหลด */
export function restoreBranches(id: string, branchIds: number[], by: string): RestoreResult {
  const file = uploadPath(id);
  const preview = previewUpload(id);
  if (!preview.sameShop) throw new HttpError(400, 'ไฟล์นี้เป็นข้อมูลของร้านอื่น — กู้คืนได้เฉพาะไฟล์สำรองของร้านนี้');
  const pick = [...new Set(branchIds.map(Number))];
  if (!pick.length) throw new HttpError(400, 'เลือกสาขาที่จะกู้คืนอย่างน้อย 1 สาขา');
  for (const b of pick) {
    const p = preview.branches.find((x) => x.id === b);
    if (!p || !p.hasData) throw new HttpError(400, `ไฟล์นี้ไม่มีข้อมูลของสาขา #${b}`);
    if (!p.current) throw new HttpError(400, `สาขา "${p.name}" ไม่มีในระบบตอนนี้ — สร้างสาขาก่อน หรือกู้คืนทั้งไฟล์`);
  }

  // 1) สำรองข้อมูลปัจจุบันทั้งร้านก่อน
  const safety = writeBackup(join(LOCAL_BACKUPS, `ก่อนกู้คืน-${stamp()}-${randomBytes(2).toString('hex')}.db`));

  db.exec(`ATTACH DATABASE ${quote(file)} AS bk`);
  const result: RestoreResult = { branches: [], safetyBackup: safety };
  try {
    const mainT = tablesOf(db);
    const bkT = tablesOf(db, 'bk');
    const tables = BRANCH_DATA.filter((t) => mainT.has(t.table) && bkT.has(t.table));
    db.exec('PRAGMA foreign_keys = OFF'); // ตรวจเองด้านล่าง (foreign_key_check) ก่อน commit
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const b of pick) {
        // จำเลขที่เอกสารที่ออกไปแล้ว (ก่อนลบ) — เลขถัดไปจะไม่ซ้ำ
        rememberDocNos((db.prepare('SELECT order_no AS no FROM orders_all WHERE branch_id = ?').all(b) as { no: string }[]).map((r) => r.no));
        for (const t of ['tax_invoices', 'credit_notes']) {
          if (mainT.has(t)) rememberDocNos((db.prepare(`SELECT doc_no AS no FROM ${t} WHERE branch_id = ?`).all(b) as { no: string }[]).map((r) => r.no));
        }
        // สินค้า/ตัวเลือกที่บิลในไฟล์อ้างถึง แต่ถูกลบไปแล้ว → นำกลับมาแบบปิดขาย (บิลเก่ายังเปิดดูได้)
        reviveCatalog(b);
        let rows = 0;
        for (const t of [...tables].reverse()) db.prepare(`DELETE FROM main.${t.table} WHERE ${t.where('main')}`).run({ b });
        for (const t of tables) {
          const bkCols = new Set(colsOf(db, t.table, 'bk'));
          const cols = colsOf(db, t.table).filter((c) => bkCols.has(c)).join(', ');
          try {
            rows += Number(db.prepare(`INSERT INTO main.${t.table} (${cols}) SELECT ${cols} FROM bk.${t.table} WHERE ${t.where('bk')}`).run({ b }).changes);
          } catch (e) {
            throw new HttpError(409, `กู้คืน "${t.label}" ไม่สำเร็จ — ข้อมูลในไฟล์ชนกับข้อมูลปัจจุบัน (${(e as Error).message})`);
          }
        }
        const name = preview.branches.find((x) => x.id === b)!.name;
        result.branches.push({ id: b, name, rows });
      }
      const bad = [...tables.map((t) => t.table), 'products', 'variants_all'].flatMap((t) => db.prepare(`PRAGMA main.foreign_key_check(${t})`).all() as { table: string }[]);
      if (bad.length) throw new HttpError(409, `ข้อมูลอ้างอิงไม่ครบหลังกู้คืน (${[...new Set(bad.map((x) => x.table))].join(', ')}) — ยกเลิกการกู้คืน`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  } finally {
    db.exec('DETACH DATABASE bk');
  }
  console.log(`[backup] ${by} กู้คืนสาขา ${result.branches.map((x) => x.name).join(', ')} จาก ${preview.createdAt ?? 'ไฟล์'} · สำรองก่อนกู้คืน → ${safety}`);
  dropUpload(id);
  return result;
}

/** หมวดหมู่/สินค้า/ตัวเลือก ที่ข้อมูลสาขา b ในไฟล์อ้างถึง แต่ไม่มีในระบบแล้ว → เพิ่มกลับแบบปิดขาย */
function reviveCatalog(b: number) {
  const need = `SELECT variant_id FROM bk.order_items WHERE order_id IN (SELECT id FROM bk.orders_all WHERE branch_id = :b)
    UNION SELECT variant_id FROM bk.branch_stock WHERE branch_id = :b
    UNION SELECT variant_id FROM bk.stock_moves_all WHERE branch_id = :b`;
  const missing = (db.prepare(`SELECT v.id FROM bk.variants_all v WHERE v.id IN (${need}) AND v.id NOT IN (SELECT id FROM main.variants_all)`).all({ b }) as { id: number }[]).map((r) => r.id);
  if (!missing.length) return;
  const ids = missing.join(',');
  const copy = (table: string, where: string, renameSku: boolean) => {
    const bkCols = new Set(colsOf(db, table, 'bk'));
    const cols = colsOf(db, table).filter((c) => bkCols.has(c));
    const sel = cols.map((c) => {
      if (c === 'active') return '0';
      if (c === 'sku' && renameSku) return `CASE WHEN EXISTS (SELECT 1 FROM main.${table} m WHERE m.sku = x.sku) THEN x.sku || '-R' || x.id ELSE x.sku END`;
      return `x.${c}`;
    });
    db.exec(`INSERT OR IGNORE INTO main.${table} (${cols.join(', ')}) SELECT ${sel.join(', ')} FROM bk.${table} x WHERE ${where}`);
  };
  copy('categories', `x.id IN (SELECT category_id FROM bk.products WHERE id IN (SELECT product_id FROM bk.variants_all WHERE id IN (${ids})))`, false);
  copy('products', `x.id IN (SELECT product_id FROM bk.variants_all WHERE id IN (${ids})) AND x.id NOT IN (SELECT id FROM main.products)`, true);
  copy('variants_all', `x.id IN (${ids})`, true);
}
