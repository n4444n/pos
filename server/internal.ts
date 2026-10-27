// API ภายในสำหรับเซิร์ฟเวอร์ license (ร้านทดลอง) — สถิติร้าน (สำรองข้อมูลอยู่ที่ backup.ts)
// เปิดเฉพาะเมื่อตั้ง POS_INTERNAL_TOKEN และคำขอส่ง header X-POS-Internal ตรงกัน (ไม่ตรง/ไม่ได้ตั้ง = 404 เหมือนไม่มี)
import type { IncomingMessage } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db, DB_PATH } from './db.ts';
import { getSettings } from './settings.ts';

const TOKEN = process.env.POS_INTERNAL_TOKEN ?? '';
const sha = (s: string) => createHash('sha256').update(s).digest();

export function internalAllowed(req: IncomingMessage) {
  const got = String(req.headers['x-pos-internal'] ?? '');
  return TOKEN.length >= 32 && !!got && timingSafeEqual(sha(got), sha(TOKEN));
}

const one = (sql: string) => (db.prepare(sql).get() as { n: number | null } | undefined)?.n ?? 0;
const text = (sql: string) => ((db.prepare(sql).get() as { v: string | null } | undefined)?.v ?? null);

/** ตัวเลขสรุปของร้าน (ทุกสาขารวมกัน) */
export function shopStats() {
  const size = (f: string) => (existsSync(f) ? statSync(f).size : 0);
  return {
    shopName: getSettings().shop.name,
    products: one('SELECT COUNT(*) n FROM products WHERE active = 1'),
    variants: one('SELECT COUNT(*) n FROM variants_all WHERE active = 1'),
    stockUnits: one('SELECT COALESCE(SUM(stock), 0) n FROM branch_stock'),
    bills: one("SELECT COUNT(*) n FROM orders_all WHERE status <> 'void'"),
    voided: one("SELECT COUNT(*) n FROM orders_all WHERE status = 'void'"),
    salesTotal: one("SELECT ROUND(COALESCE(SUM(total), 0), 2) n FROM orders_all WHERE status <> 'void'"),
    todayBills: one("SELECT COUNT(*) n FROM orders_all WHERE status <> 'void' AND date(created_at) = date('now', 'localtime')"),
    todaySales: one("SELECT ROUND(COALESCE(SUM(total), 0), 2) n FROM orders_all WHERE status <> 'void' AND date(created_at) = date('now', 'localtime')"),
    creditNotes: one('SELECT COUNT(*) n FROM credit_notes'),
    firstSaleAt: text('SELECT MIN(created_at) v FROM orders_all'),
    lastSaleAt: text('SELECT MAX(created_at) v FROM orders_all'),
    staff: one('SELECT COUNT(*) n FROM staff'),
    branches: one('SELECT COUNT(*) n FROM branches WHERE deleted_at IS NULL'),
    dbBytes: size(DB_PATH) + size(`${DB_PATH}-wal`),
    branchList: db.prepare(
      `SELECT b.id, b.name, b.code, b.is_main AS isMain,
              (SELECT COUNT(*) FROM orders_all o WHERE o.branch_id = b.id AND o.status <> 'void') AS bills,
              (SELECT MAX(created_at) FROM orders_all o WHERE o.branch_id = b.id) AS lastBillAt
         FROM branches b WHERE b.deleted_at IS NULL ORDER BY b.is_main DESC, b.id`,
    ).all(),
  };
}
