// ส่งออกสต็อกสินค้า (คุณสมบัติ) เป็น Excel
// ชีตแรก "สต็อก" = หัวคอลัมน์ตรงกับ "นำเข้าสินค้า" → แก้ไขใน Excel แล้วนำเข้ากลับได้ทันที
//   (เลือก "ตั้งเป็นจำนวนในไฟล์" + ติ๊ก "อัปเดตชื่อ / หมวดหมู่ / ราคา" — จับคู่ SKU ด้วยคอลัมน์ รหัส SKU (ระบบ))
// ชีตอื่น: สินค้าหมด/ใกล้หมด · สรุปตามสินค้า · สต็อกทุกสาขา (ผู้จัดการ) · วิธีนำเข้า
import { currentBranch, db } from './db.ts';
import { round2 } from './common.ts';
import { currentBranchInfo, listBranches } from './branches.ts';
import type { Me } from './auth.ts';
import { can } from './perms.ts';
import { buildXlsx, type Col, type SheetSpec } from './xlsx.ts';

/** หัวคอลัมน์ชีตแรก — ต้องตรงกับชื่อที่ ImportProductsSheet รู้จัก (src/components/stock/ImportProductsSheet.tsx) */
export const STOCK_HEADERS = {
  code: 'รหัสสินค้า',
  barcode: 'บาร์โค้ด',
  qty: 'คงเหลือ',
  name: 'ชื่อสินค้า',
  color: 'สี',
  size: 'ไซซ์',
  extra: 'คุณสมบัติอื่น',
  category: 'หมวดหมู่',
  lowStock: 'แจ้งเตือนเมื่อเหลือ',
  price: 'ราคาขาย',
  variantSku: 'รหัส SKU (ระบบ)',
} as const;

interface Row {
  variantId: number; productId: number; code: string; name: string; category: string | null; barcode: string | null;
  color: string; size: string; extra: string; stock: number; price: number; cost: number | null; lowStock: number;
  vActive: number; pActive: number; variantSku: string; sold30: number; lastSold: string | null;
}

const dash = (s: string) => (s === '-' ? '' : s);
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const statusOf = (r: Row) => (!r.pActive || !r.vActive ? 'ปิดขาย' : r.stock <= 0 ? 'หมด' : r.stock <= r.lowStock ? 'ใกล้หมด' : 'มีสินค้า');

export function stockXlsx(me: Me): Buffer {
  const manager = can(me, 'stock', 'edit');
  const since = new Date();
  since.setDate(since.getDate() - 29);
  const rows = db
    .prepare(
      `SELECT v.id AS variantId, p.id AS productId, p.sku AS code, p.name, c.name AS category, v.barcode, v.color, v.size, v.extra,
              v.stock, COALESCE(v.price, p.price) AS price, COALESCE(v.cost, p.cost) AS cost, p.low_stock AS lowStock,
              v.active AS vActive, p.active AS pActive, v.sku AS variantSku,
              COALESCE(s.sold30, 0) AS sold30, s.lastSold
         FROM products p
         JOIN variants v ON v.product_id = p.id AND instr(v.extra, char(1)) = 0
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN (SELECT oi.variant_id, SUM(CASE WHEN date(o.created_at) >= ? THEN oi.qty ELSE 0 END) AS sold30, MAX(o.created_at) AS lastSold
                      FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status != 'void' GROUP BY oi.variant_id) s ON s.variant_id = v.id
        WHERE p.deleted_at IS NULL
        ORDER BY p.sku COLLATE NOCASE, v.sort, v.id`,
    )
    .all(isoDay(since)) as unknown as Row[];

  const branch = currentBranch() === 0 ? 'รวมทุกสาขา' : currentBranchInfo().name;
  const now = new Date();
  const stamp = `${isoDay(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const H = STOCK_HEADERS;
  const sheets: SheetSpec[] = [];

  // ---------- 1) สต็อก (นำเข้ากลับได้) — ห้ามมีแถวหัวเรื่องก่อนตาราง เพื่อให้แก้ไขง่าย ----------
  const editable: Col<Row>[] = [
    { header: H.code, value: (r) => r.code },
    { header: H.name, value: (r) => r.name },
    { header: H.category, value: (r) => r.category ?? '' },
    { header: H.color, value: (r) => dash(r.color) },
    { header: H.size, value: (r) => dash(r.size) },
    { header: H.extra, value: (r) => r.extra },
    { header: H.barcode, value: (r) => r.barcode ?? '' },
    { header: H.qty, value: (r) => r.stock, type: 'int' },
    { header: H.price, value: (r) => r.price, type: 'money' },
    { header: H.lowStock, value: (r) => r.lowStock, type: 'int' },
    { header: H.variantSku, value: (r) => r.variantSku },
    // คอลัมน์ข้อมูลประกอบ — ตอนนำเข้าจะไม่อ่าน
    { header: 'สถานะ (ดูอย่างเดียว)', value: (r) => statusOf(r) },
    ...(manager ? [{ header: 'ต้นทุน (ดูอย่างเดียว)', value: (r: Row) => r.cost, type: 'money' as const }] : []),
    { header: 'ขาย 30 วัน (ดูอย่างเดียว)', value: (r) => r.sold30, type: 'int' },
  ];
  sheets.push({ name: 'สต็อก', cols: editable, rows, freezeCols: 2 });

  // ---------- 2) หมด / ใกล้หมด ----------
  const ORDER: Record<string, number> = { หมด: 0, ใกล้หมด: 1 };
  const low = rows
    .filter((r) => r.pActive && r.vActive && r.stock <= r.lowStock)
    .sort((a, b) => ORDER[statusOf(a)] - ORDER[statusOf(b)] || b.sold30 - a.sold30 || a.stock - b.stock);
  sheets.push({
    name: 'หมด-ใกล้หมด',
    intro: [
      'สินค้าที่หมดสต็อก / ใกล้หมด',
      `${branch} · ข้อมูล ณ ${stamp} · เฉพาะ SKU ที่เปิดขาย · ใกล้หมด = คงเหลือ ≤ ค่าแจ้งเตือนของสินค้า · เรียงจากหมดก่อน แล้วตามยอดขาย 30 วัน`,
    ],
    cols: [
      { header: 'สถานะ', value: (r: Row) => statusOf(r) },
      { header: 'รหัสสินค้า', value: (r) => r.code },
      { header: 'ชื่อสินค้า', value: (r) => r.name },
      { header: 'หมวดหมู่', value: (r) => r.category ?? '' },
      { header: 'สี', value: (r) => dash(r.color) },
      { header: 'ไซซ์', value: (r) => dash(r.size) },
      { header: 'คุณสมบัติอื่น', value: (r) => r.extra },
      { header: 'บาร์โค้ด', value: (r) => r.barcode ?? '' },
      { header: 'คงเหลือ', value: (r) => r.stock, type: 'int' },
      { header: 'แจ้งเตือนเมื่อเหลือ', value: (r) => r.lowStock, type: 'int' },
      { header: 'ขาย 30 วัน', value: (r) => r.sold30, type: 'int' },
      { header: 'เฉลี่ยขายต่อวัน', value: (r) => round2(r.sold30 / 30), type: 'num' },
      { header: 'ขายล่าสุด', value: (r) => r.lastSold, type: 'datetime' },
      { header: 'ราคาขาย', value: (r) => r.price, type: 'money' },
    ],
    rows: low,
    freezeCols: 3,
  });

  // ---------- 3) สรุปตามสินค้า ----------
  {
    interface P { code: string; name: string; category: string; active: boolean; skus: number; units: number; out: number; low: number; value: number; sold30: number }
    const m = new Map<number, P>();
    for (const r of rows) {
      const p = m.get(r.productId) ?? { code: r.code, name: r.name, category: r.category ?? '', active: !!r.pActive, skus: 0, units: 0, out: 0, low: 0, value: 0, sold30: 0 };
      p.skus++;
      p.units += r.stock;
      p.sold30 += r.sold30;
      if (r.vActive && r.pActive) {
        if (r.stock <= 0) p.out++;
        else if (r.stock <= r.lowStock) p.low++;
      }
      p.value += Math.max(0, r.stock) * (r.cost ?? 0);
      m.set(r.productId, p);
    }
    sheets.push({
      name: 'สรุปตามสินค้า',
      intro: ['สรุปสต็อกตามสินค้า', `${branch} · ข้อมูล ณ ${stamp}`],
      cols: [
        { header: 'รหัสสินค้า', value: (p: P) => p.code },
        { header: 'ชื่อสินค้า', value: (p) => p.name },
        { header: 'หมวดหมู่', value: (p) => p.category },
        { header: 'แสดงขาย', value: (p) => (p.active ? 'เปิด' : 'ปิด') },
        { header: 'จำนวน SKU', value: (p) => p.skus, type: 'int' },
        { header: 'คงเหลือรวม (ชิ้น)', value: (p) => p.units, type: 'int' },
        { header: 'SKU ที่หมด', value: (p) => p.out, type: 'int' },
        { header: 'SKU ใกล้หมด', value: (p) => p.low, type: 'int' },
        { header: 'ขาย 30 วัน', value: (p) => p.sold30, type: 'int' },
        { header: 'พอขายอีก (วัน)', value: (p) => (p.sold30 > 0 ? Math.floor(p.units / (p.sold30 / 30)) : null), type: 'int' },
        ...(manager ? [{ header: 'มูลค่าตามต้นทุน', value: (p: P) => round2(p.value), type: 'money' as const }] : []),
      ],
      rows: [...m.values()],
      freezeCols: 2,
    });
  }

  // ---------- 4) สต็อกทุกสาขา (ผู้จัดการ, มีมากกว่า 1 สาขา) ----------
  const branches = manager ? listBranches() : [];
  if (branches.length > 1) {
    const bs = new Map<string, number>();
    for (const r of db.prepare('SELECT branch_id AS b, variant_id AS v, stock FROM branch_stock').all() as { b: number; v: number; stock: number }[]) {
      bs.set(`${r.b}|${r.v}`, r.stock);
    }
    const at = (b: number, v: number) => bs.get(`${b}|${v}`) ?? 0;
    sheets.push({
      name: 'สต็อกทุกสาขา',
      intro: ['สต็อกคงเหลือแยกตามสาขา', `ข้อมูล ณ ${stamp} · ใช้ดูว่าควรโอนสินค้าจากสาขาไหนไปสาขาไหน`],
      cols: [
        { header: 'รหัสสินค้า', value: (r: Row) => r.code },
        { header: 'ชื่อสินค้า', value: (r) => r.name },
        { header: 'สี', value: (r) => dash(r.color) },
        { header: 'ไซซ์', value: (r) => dash(r.size) },
        { header: 'คุณสมบัติอื่น', value: (r) => r.extra },
        { header: 'บาร์โค้ด', value: (r) => r.barcode ?? '' },
        ...branches.map((b): Col<Row> => ({ header: b.name, value: (r) => at(b.id, r.variantId), type: 'int' })),
        { header: 'รวมทุกสาขา', value: (r) => branches.reduce((a, b) => a + at(b.id, r.variantId), 0), type: 'int' },
        { header: 'สาขาที่หมด', value: (r) => branches.filter((b) => at(b.id, r.variantId) <= 0).map((b) => b.name).join(', ') },
      ],
      rows,
      freezeCols: 2,
    });
  }

  // ---------- 5) วิธีนำเข้า ----------
  type I = [string, string];
  sheets.push({
    name: 'วิธีนำเข้ากลับ',
    intro: ['วิธีแก้ไขในไฟล์นี้แล้วนำเข้ากลับ'],
    cols: [
      { header: 'ขั้นตอน', value: (r: I) => r[0], width: 14 },
      { header: 'รายละเอียด', value: (r) => r[1], width: 110 },
    ],
    rows: [
      ['1', 'แก้ไขเฉพาะในชีต "สต็อก" (ชีตแรก) — ห้ามเปลี่ยนชื่อหัวคอลัมน์ และอย่าย้ายชีตอื่นมาไว้ก่อนชีตนี้'],
      ['2', `แก้ได้: ${H.qty} · ${H.price} · ${H.name} · ${H.category} · ${H.lowStock} · ${H.barcode} (เมื่อติ๊ก "อัปเดตชื่อ / หมวดหมู่ / ราคา")`],
      ['3', `ห้ามแก้: ${H.code} และ ${H.variantSku} — ใช้จับคู่กับสินค้า/SKU เดิมในระบบ (ลบคอลัมน์ ${H.variantSku} ออก = จับคู่ด้วย สี + ไซซ์ + คุณสมบัติอื่น)`],
      ['4', `เพิ่ม SKU ใหม่: เพิ่มแถว ใส่ ${H.code} เดิม + สี/ไซซ์ใหม่ และเว้น ${H.variantSku} ว่าง · เพิ่มสินค้าใหม่: ใส่ ${H.code} ใหม่`],
      ['5', 'คอลัมน์ที่มีคำว่า (ดูอย่างเดียว) ระบบจะไม่อ่านตอนนำเข้า · ลบแถวออกจากไฟล์ = ไม่เปลี่ยนแปลง SKU นั้น (ไม่ได้ลบออกจากระบบ)'],
      ['6', 'บันทึกเป็น .xlsx แล้วไปที่ สต็อกสินค้า (คุณสมบัติ) → ปุ่ม Excel → นำเข้าไฟล์ (ทำได้ที่สาขาหลัก โดยผู้จัดการ)'],
      ['7', 'เลือก "ตั้งเป็นจำนวนในไฟล์" เพื่อให้คงเหลือเท่ากับในไฟล์ (หรือ "บวกเพิ่ม" ถ้าในไฟล์คือจำนวนที่รับเข้าเพิ่ม) แล้วกดตรวจ — ระบบแสดงผลก่อนบันทึกจริงเสมอ'],
      ['ข้อควรระวัง', 'สต็อกที่ขายออกไประหว่างที่แก้ไฟล์จะถูกทับด้วยตัวเลขในไฟล์ (โหมด "ตั้งเป็นจำนวนในไฟล์") — ควร Export ใหม่ก่อนแก้ทุกครั้ง และนำเข้านอกเวลาขาย'],
    ] as I[],
  });

  return buildXlsx(sheets);
}
