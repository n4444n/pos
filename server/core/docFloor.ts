// เลขที่เอกสารขั้นต่ำ — หลังกู้คืนข้อมูลสาขา บิล/เอกสารที่ออกไปแล้วอาจหายจากฐานข้อมูล
// จึงจำเลขสูงสุดที่เคยออกจริงไว้ เลขถัดไปจะรันต่อจากค่านี้ (ไม่ออกเลขซ้ำกับเอกสารที่ลูกค้าได้ไปแล้ว)
import { db } from './db.ts';

db.exec('CREATE TABLE IF NOT EXISTS doc_floor (prefix TEXT PRIMARY KEY, n INTEGER NOT NULL)');

const get = db.prepare('SELECT n FROM doc_floor WHERE prefix = ?');
const up = db.prepare('INSERT INTO doc_floor (prefix, n) VALUES (?, ?) ON CONFLICT (prefix) DO UPDATE SET n = MAX(n, excluded.n)');

/** เลขล่าสุดที่เคยออกของ prefix นี้ (0 = ไม่มีบันทึก) */
export const docFloor = (prefix: string) => (get.get(prefix) as { n: number } | undefined)?.n ?? 0;

/** จำเลขสูงสุดของเอกสารชุดนี้ เช่น ['INV-B02-261027-0007', ...] → INV-B02-261027- = 7 */
export function rememberDocNos(nos: Iterable<string>) {
  const max = new Map<string, number>();
  for (const no of nos) {
    const m = /^(.*-)(\d+)$/.exec(no);
    if (m) max.set(m[1], Math.max(max.get(m[1]) ?? 0, Number(m[2])));
  }
  for (const [p, n] of max) up.run(p, n);
}
