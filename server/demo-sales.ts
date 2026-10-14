// สร้างข้อมูลการขายตัวอย่างย้อนหลัง (สำหรับทดลองดูหน้ารายงาน)
// รัน: npm run db:demo            (ทำงานเฉพาะเมื่อยังไม่มีบิลจริง)
//      npm run db:demo -- --force  (เพิ่มข้อมูลตัวอย่างแม้มีบิลอยู่แล้ว)
// หมายเหตุ: ไม่ตัดสต็อก เพื่อไม่ให้สต็อกตัวอย่างหมด
import { db, tx } from './db.ts';
import './auth.ts'; // ให้มีรายชื่อพนักงาน/PIN ก่อน
import { round2, vatOf } from './common.ts';

const DAYS = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 60);
const force = process.argv.includes('--force');

const { n: existing } = db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number };
if (existing > 0 && !force) {
  console.log(`มีบิลอยู่แล้ว ${existing} บิล — ไม่สร้างข้อมูลตัวอย่าง (ใช้ --force ถ้าต้องการเพิ่ม)`);
  process.exit(0);
}
if (db.prepare("SELECT 1 FROM shifts WHERE status = 'open'").get()) {
  console.log('มีกะที่เปิดอยู่ กรุณาปิดกะก่อนสร้างข้อมูลตัวอย่าง');
  process.exit(1);
}

// สุ่มแบบกำหนดค่าเริ่มต้น → ได้ข้อมูลเหมือนเดิมทุกครั้ง
let seed = 20261011;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(arr: T[], w?: number[]) => {
  if (!w) return arr[Math.floor(rnd() * arr.length)];
  const t = w.reduce((a, b) => a + b, 0);
  let r = rnd() * t;
  for (let i = 0; i < arr.length; i++) if ((r -= w[i]) < 0) return arr[i];
  return arr[arr.length - 1];
};

type V = { id: number; productId: number; size: string; color: string; sku: string; name: string; price: number };
const variants = db
  .prepare('SELECT v.id, v.product_id AS productId, v.size, v.color, v.sku, p.name, p.price FROM variants v JOIN products p ON p.id = v.product_id WHERE p.active = 1')
  .all() as V[];
const products = [...new Set(variants.map((v) => v.productId))];
// สินค้าบางตัวขายดีกว่า (power-law)
const pWeight = new Map(products.map((id, i) => [id, 1 / Math.pow(((i * 7) % products.length) + 1, 0.8)]));
const sizeWeight: Record<string, number> = { S: 2, M: 5, L: 4, XL: 2, '28': 2, '30': 4, '32': 4, '34': 2, FREE: 3, '90': 1, '100': 2, '110': 1 };
const staff = (db.prepare("SELECT name FROM staff WHERE active = 1 AND role = 'staff'").all() as { name: string }[]).map((s) => s.name);
const hours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const hourW = [2, 3, 5, 4, 3, 3, 4, 6, 8, 8, 6, 3];

const p2 = (n: number) => String(n).padStart(2, '0');
const insShift = db.prepare(
  `INSERT INTO shifts_all (shift_no, business_date, status, opened_at, opened_by, opening_cash, closed_at, closed_by, counted_cash,
                       expected_cash, diff, cash_sales, cash_in, cash_out, total_sales, bill_count)
   VALUES (1, ?, 'closed', ?, ?, 2000, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
);
const insOrder = db.prepare(
  `INSERT INTO orders_all (order_no, customer_name, salesperson, order_type, subtotal, discount, vat, total, promo_code,
                       payment_method, cash_received, change_due, status, created_at, shift_id)
   VALUES (?, NULL, ?, 'หน้าร้าน', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
);
const insItem = db.prepare(
  'INSERT INTO order_items (order_id, variant_id, product_name, sku, size, color, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const insPay = db.prepare('INSERT INTO payments_all (shift_id, order_id, kind, method, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const insEdit = db.prepare(
  `INSERT INTO order_edits (order_id, kind, edited_at, staff, reason, summary, old_total, new_total, diff, settle_method, before_json, after_json)
   VALUES (?, 'void', ?, 'ผู้จัดการ', 'ข้อมูลตัวอย่าง', 'ยกเลิกบิล', ?, 0, ?, ?, '[]', '[]')`,
);
const updShift = db.prepare('UPDATE shifts SET counted_cash = ?, expected_cash = ?, diff = ?, cash_sales = ?, total_sales = ?, bill_count = ? WHERE id = ?');

let totalBills = 0;
tx(() => {
  const now = new Date();
  for (let back = DAYS; back >= 1; back--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const date = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    if (db.prepare('SELECT 1 FROM shifts WHERE business_date = ?').get(date)) continue;
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const payday = d.getDate() >= 25 || d.getDate() <= 2;
    const trend = 1 + (DAYS - back) / DAYS / 3; // ยอดค่อย ๆ โตขึ้น
    const bills = Math.round((8 + (weekend ? 7 : 0) + (payday ? 4 : 0) + rnd() * 5) * trend);
    const who = pick(staff.length ? staff : ['ผู้จัดการ']);
    const shiftId = Number(
      insShift.run(date, `${date} 10:00:00`, who, `${date} 21:45:00`, who, 0, 0, 0, 0, 0, 0).lastInsertRowid,
    );
    let cash = 0;
    let all = 0;
    let count = 0;
    const times = Array.from({ length: bills }, () => `${p2(pick(hours, hourW))}:${p2(Math.floor(rnd() * 60))}:${p2(Math.floor(rnd() * 60))}`).sort();
    times.forEach((t, i) => {
      const lines = new Map<number, V>();
      const nLines = pick([1, 2, 3, 4], [5, 4, 2, 1]);
      while (lines.size < nLines) {
        const pid = pick(products, products.map((x) => pWeight.get(x)!));
        const opts = variants.filter((v) => v.productId === pid);
        const v = pick(opts, opts.map((o) => sizeWeight[o.size] ?? 1));
        lines.set(v.id, v);
      }
      const items = [...lines.values()].map((v) => ({ v, qty: rnd() < 0.15 ? 2 : 1 }));
      const subtotal = round2(items.reduce((a, x) => a + x.v.price * x.qty, 0));
      const promo = rnd() < 0.1 ? 'WELCOME10' : null;
      const discount = promo ? round2(subtotal * 0.1) : 0;
      const total = round2(subtotal - discount);
      const method = pick(['cash', 'promptpay', 'card', 'transfer'], [45, 35, 15, 5]);
      const voided = rnd() < 0.02;
      const created = `${date} ${t}`;
      const orderNo = `INV-${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${String(i + 1).padStart(4, '0')}`;
      const oid = Number(
        insOrder.run(orderNo, pick(staff.length ? staff : ['ผู้จัดการ']), subtotal, discount, vatOf(total), total, promo, method,
          method === 'cash' ? total : null, voided ? 'void' : 'paid', created, shiftId).lastInsertRowid,
      );
      for (const x of items) insItem.run(oid, x.v.id, x.v.name, x.v.sku, x.v.size, x.v.color, x.qty, x.v.price, round2(x.v.price * x.qty));
      insPay.run(shiftId, oid, 'sale', method, total, created);
      count++;
      all += total;
      if (method === 'cash') cash += total;
      if (voided) {
        insPay.run(shiftId, oid, 'void', method, -total, created);
        insEdit.run(oid, created, total, -total, method);
        all -= total;
        if (method === 'cash') cash -= total;
      }
    });
    const expected = round2(2000 + cash);
    const diff = rnd() < 0.15 ? pick([-20, -50, 10, -100, 20]) : 0;
    updShift.run(round2(expected + diff), expected, diff, round2(cash), round2(all), count, shiftId);
    totalBills += count;
  }
});
console.log(`สร้างข้อมูลตัวอย่าง ${totalBills} บิล ย้อนหลัง ${DAYS} วันเรียบร้อย`);
