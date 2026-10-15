// ส่งออกรายงานเป็น Excel สำหรับทีมการตลาด / วิเคราะห์ข้อมูล
// - ชีตสรุปตามมิติต่าง ๆ (วัน เดือน ชั่วโมง วันในสัปดาห์ สินค้า SKU ไซซ์ สี หมวด การชำระเงิน พนักงาน สาขา โปรโมชั่น)
// - ข้อมูลดิบ (บิล + รายการขายทีละบรรทัด) สำหรับทำ Pivot Table ต่อเอง
// ช่วงวันที่/สาขา ตามที่เลือกในหน้ารายงาน · ยอดขายไม่รวมบิลที่ยกเลิก (เหมือนหน้ารายงาน)
import { dashboard, type DashQuery } from './dashboard.ts';
import { db } from './db.ts';
import { round2 } from './common.ts';
import { getSettings } from './settings.ts';
import { buildXlsx, typed, type Col, type SheetSpec } from './xlsx.ts';

const WEEKDAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
/** ลำดับวันในสัปดาห์แบบไทย (จันทร์ก่อน) */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const STATUS_LABEL: Record<string, string> = { paid: 'ชำระแล้ว', edited: 'แก้ไขแล้ว', void: 'ยกเลิก' };
const pad = (n: number) => String(n).padStart(2, '0');
const parseDay = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const weekdayOf = (s: string) => parseDay(s).getDay();
const hourOf = (s: string) => Number(s.slice(11, 13)) || 0;
const ratio = (a: number, b: number) => (b ? a / b : null);
const dash = (s: string | null | undefined) => (!s || s === '-' ? '' : s);

interface OrderRow {
  id: number; orderNo: string; createdAt: string; status: string; customerName: string | null; salesperson: string | null;
  orderType: string | null; paymentMethod: string; promoCode: string | null; subtotal: number; discount: number; vat: number;
  total: number; fee: number; feePayer: string; branch: string | null; branchCode: string | null; items: number;
}
interface LineRow {
  orderId: number; orderNo: string; createdAt: string; status: string; salesperson: string | null; paymentMethod: string;
  customerName: string | null; promoCode: string | null; branch: string | null; variantId: number; productId: number | null;
  productCode: string | null; productName: string; category: string | null; variantSku: string; barcode: string | null;
  size: string; color: string; extra: string; qty: number; unitPrice: number; lineTotal: number; unitCost: number;
  subtotal: number; discount: number; vat: number; total: number;
}
interface Line extends LineRow { disc: number; net: number; exVat: number; cost: number; profit: number }

/** ตัวรวมยอดตามกลุ่ม */
class Agg {
  units = 0; gross = 0; disc = 0; net = 0; exVat = 0; cost = 0; profit = 0;
  bills = new Set<number>();
  products = new Set<number | string>();
  first = '';
  last = '';
  add(l: Line) {
    this.units += l.qty;
    this.gross += l.lineTotal;
    this.disc += l.disc;
    this.net += l.net;
    this.exVat += l.exVat;
    this.cost += l.cost;
    this.profit += l.profit;
    this.bills.add(l.orderId);
    this.products.add(l.productId ?? l.productName);
    if (!this.first || l.createdAt < this.first) this.first = l.createdAt;
    if (l.createdAt > this.last) this.last = l.createdAt;
  }
}
function groupBy<K>(lines: Line[], key: (l: Line) => K): Map<K, Agg> {
  const m = new Map<K, Agg>();
  for (const l of lines) {
    const k = key(l);
    let a = m.get(k);
    if (!a) m.set(k, (a = new Agg()));
    a.add(l);
  }
  return m;
}

export function reportFileName(f: DashQuery) {
  const d = dashboard(f);
  return `report-${d.range.from}-${d.range.to}.xlsx`;
}

export function reportXlsx(f: DashQuery, scopeLabel: string): Buffer {
  const d = dashboard(f);
  const { from, to } = d.range;
  const args = [from, to];
  const payLabel = new Map(getSettings().payments.methods.map((m) => [m.id as string, m.label]));
  const pay = (id: string) => payLabel.get(id) ?? id;

  const orders = db
    .prepare(
      `SELECT o.id, o.order_no AS orderNo, o.created_at AS createdAt, o.status, o.customer_name AS customerName, o.salesperson,
              o.order_type AS orderType, o.payment_method AS paymentMethod, o.promo_code AS promoCode, o.subtotal, o.discount,
              o.vat, o.total, COALESCE(o.fee, 0) AS fee, o.fee_payer AS feePayer, b.name AS branch, b.code AS branchCode,
              (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o LEFT JOIN branches b ON b.id = o.branch_id
        WHERE date(o.created_at) BETWEEN ? AND ?
        ORDER BY o.created_at, o.id`,
    )
    .all(...args) as unknown as OrderRow[];
  const valid = orders.filter((o) => o.status !== 'void');

  const rawLines = db
    .prepare(
      `SELECT o.id AS orderId, o.order_no AS orderNo, o.created_at AS createdAt, o.status, o.salesperson, o.payment_method AS paymentMethod,
              o.customer_name AS customerName, o.promo_code AS promoCode, b.name AS branch,
              oi.variant_id AS variantId, p.id AS productId, p.sku AS productCode, oi.product_name AS productName, c.name AS category,
              oi.sku AS variantSku, v.barcode, oi.size, oi.color, COALESCE(oi.extra, '') AS extra, oi.qty, oi.unit_price AS unitPrice,
              oi.line_total AS lineTotal, COALESCE(v.cost, p.cost, 0) AS unitCost,
              o.subtotal, o.discount, o.vat, o.total
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN variants_all v ON v.id = oi.variant_id
         LEFT JOIN products p ON p.id = v.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN branches b ON b.id = o.branch_id
        WHERE o.status != 'void' AND date(o.created_at) BETWEEN ? AND ?
        ORDER BY o.created_at, o.id, oi.id`,
    )
    .all(...args) as unknown as LineRow[];
  // ปันส่วนส่วนลดท้ายบิล + VAT ลงแต่ละบรรทัด (ตามสัดส่วนยอดของบรรทัด)
  const lines: Line[] = rawLines.map((l) => {
    const disc = l.subtotal > 0 ? (l.discount * l.lineTotal) / l.subtotal : 0;
    const net = l.lineTotal - disc;
    const exVat = l.total > 0 ? (net * (l.total - l.vat)) / l.total : net;
    const cost = l.qty * l.unitCost;
    return { ...l, disc, net, exVat, cost, profit: exVat - cost };
  });

  // สต็อกคงเหลือตอนนี้ (ของสาขาที่เลือก / รวมทุกสาขา)
  const stockOf = new Map((db.prepare('SELECT id, stock FROM variants').all() as { id: number; stock: number }[]).map((r) => [r.id, r.stock]));
  const productStock = new Map<number, number>();
  for (const r of db.prepare('SELECT id, product_id AS pid FROM variants_all').all() as { id: number; pid: number }[]) {
    productStock.set(r.pid, (productStock.get(r.pid) ?? 0) + (stockOf.get(r.id) ?? 0));
  }

  const totalNet = lines.reduce((a, l) => a + l.net, 0);
  const totalUnits = lines.reduce((a, l) => a + l.qty, 0);
  const totalSales = valid.reduce((a, o) => a + o.total, 0);
  const generated = new Date();
  const stamp = `${generated.getFullYear()}-${pad(generated.getMonth() + 1)}-${pad(generated.getDate())} ${pad(generated.getHours())}:${pad(generated.getMinutes())}`;
  const intro = (title: string, ...more: string[]) => [title, `ช่วงวันที่ ${from} ถึง ${to} · ${scopeLabel}`, ...more];

  const sheets: SheetSpec[] = [];

  // ---------- 1) สรุป ----------
  {
    type R = { label: string; cur: unknown; prev: unknown; t: 'money' | 'int' | 'pct' | 'num'; note?: string };
    const k = d.kpis;
    const p = d.prev;
    const rows: R[] = [
      { label: 'ยอดขายสุทธิ (บาท)', cur: k.sales, prev: p.sales, t: 'money', note: 'ยอดรวมบิลที่ไม่ถูกยกเลิก (รวม VAT)' },
      { label: 'จำนวนบิล', cur: k.bills, prev: p.bills, t: 'int' },
      { label: 'จำนวนชิ้นที่ขาย', cur: k.units, prev: p.units, t: 'int' },
      { label: 'ยอดเฉลี่ยต่อบิล (AOV)', cur: k.aov, prev: p.aov, t: 'money' },
      { label: 'ชิ้นเฉลี่ยต่อบิล (UPT)', cur: k.upt, prev: p.upt, t: 'num' },
      { label: 'ส่วนลดท้ายบิล', cur: k.discount, prev: p.discount, t: 'money' },
      { label: 'กำไรขั้นต้น', cur: k.profit, prev: p.profit, t: 'money', note: 'ยอดขายไม่รวม VAT − ต้นทุนสินค้า' },
      { label: 'อัตรากำไรขั้นต้น', cur: k.margin / 100, prev: p.margin / 100, t: 'pct' },
      { label: 'ค่าใช้จ่ายร้าน', cur: d.expenses.total, prev: d.expenses.prev, t: 'money' },
      { label: 'กำไรสุทธิ', cur: round2(k.profit - d.expenses.total), prev: round2(p.profit - d.expenses.prev), t: 'money', note: 'กำไรขั้นต้น − ค่าใช้จ่ายร้าน' },
      { label: 'บิลที่แก้ไข (เปลี่ยน/คืนสินค้า)', cur: d.returns.edits, prev: null, t: 'int' },
      { label: 'บิลที่ยกเลิก', cur: d.returns.voids, prev: null, t: 'int' },
      { label: 'เงินที่คืนลูกค้า', cur: d.returns.refunded, prev: null, t: 'money' },
      { label: 'SKU ที่หมดสต็อก (ตอนนี้)', cur: d.stock.out, prev: null, t: 'int' },
      { label: 'SKU ที่ใกล้หมด (ตอนนี้)', cur: d.stock.low, prev: null, t: 'int' },
      { label: 'สต็อกคงเหลือ (ชิ้น)', cur: d.stock.units, prev: null, t: 'int' },
      { label: 'มูลค่าสต็อกตามต้นทุน', cur: d.stock.value, prev: null, t: 'money' },
    ];
    sheets.push({
      name: 'สรุป',
      intro: intro(
        'รายงานยอดขาย (สำหรับวิเคราะห์)',
        `ช่วงก่อนหน้าที่ใช้เทียบ ${d.prevRange.from} ถึง ${d.prevRange.to} · ออกรายงาน ${stamp}`,
        'ทุกชีตไม่รวมบิลที่ยกเลิก (ยกเว้นชีต "บิล" ที่มีคอลัมน์สถานะ) · ต้นทุนใช้ต้นทุนปัจจุบันของสินค้า · ชีต "รายการขาย" ใช้ทำ Pivot Table ต่อได้',
      ),
      cols: [
        { header: 'ตัวชี้วัด', value: (r: R) => r.label, width: 30 },
        { header: 'ช่วงนี้', value: (r: R) => typed(r.cur, r.t), width: 16 },
        { header: 'ช่วงก่อนหน้า', value: (r: R) => typed(r.prev, r.t), width: 16 },
        {
          header: 'เปลี่ยนแปลง',
          value: (r: R) => (typeof r.cur === 'number' && typeof r.prev === 'number' && r.prev !== 0 && r.t !== 'pct' ? (r.cur - r.prev) / Math.abs(r.prev) : null),
          type: 'pct',
          width: 14,
        },
        { header: 'หมายเหตุ', value: (r: R) => r.note ?? '', width: 44 },
      ],
      rows,
    });
  }

  // ---------- 2) รายวัน / รายเดือน ----------
  interface Period { key: string; bills: number; units: number; sales: number; discount: number; vat: number; fee: number; cost: number; days: number }
  const period = (keyOf: (createdAt: string) => string, keys: string[]) => {
    const m = new Map<string, Period>(keys.map((k) => [k, { key: k, bills: 0, units: 0, sales: 0, discount: 0, vat: 0, fee: 0, cost: 0, days: 0 }]));
    const get = (k: string) => {
      let p = m.get(k);
      if (!p) m.set(k, (p = { key: k, bills: 0, units: 0, sales: 0, discount: 0, vat: 0, fee: 0, cost: 0, days: 0 }));
      return p;
    };
    for (const o of valid) {
      const p = get(keyOf(o.createdAt));
      p.bills++;
      p.sales += o.total;
      p.discount += o.discount;
      p.vat += o.vat;
      p.fee += o.fee;
    }
    for (const l of lines) {
      const p = get(keyOf(l.createdAt));
      p.units += l.qty;
      p.cost += l.cost;
    }
    return [...m.values()];
  };
  const days: string[] = [];
  for (let x = parseDay(from); x <= parseDay(to); x.setDate(x.getDate() + 1)) days.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`);
  const months = [...new Set(days.map((x) => x.slice(0, 7)))];
  const periodCols = (first: Col<Period>[]): Col<Period>[] => [
    ...first,
    { header: 'จำนวนบิล', value: (p) => p.bills, type: 'int' },
    { header: 'ชิ้นที่ขาย', value: (p) => p.units, type: 'int' },
    { header: 'ยอดขายสุทธิ', value: (p) => round2(p.sales), type: 'money' },
    { header: 'ส่วนลดท้ายบิล', value: (p) => round2(p.discount), type: 'money' },
    { header: 'VAT', value: (p) => round2(p.vat), type: 'money' },
    { header: 'ยอดขายไม่รวม VAT', value: (p) => round2(p.sales - p.vat), type: 'money' },
    { header: 'ต้นทุนสินค้า', value: (p) => round2(p.cost), type: 'money' },
    { header: 'กำไรขั้นต้น', value: (p) => round2(p.sales - p.vat - p.cost), type: 'money' },
    { header: 'อัตรากำไร', value: (p) => ratio(p.sales - p.vat - p.cost, p.sales - p.vat), type: 'pct' },
    { header: 'เฉลี่ยต่อบิล', value: (p) => (p.bills ? round2(p.sales / p.bills) : null), type: 'money' },
    { header: 'ชิ้นต่อบิล', value: (p) => (p.bills ? round2(p.units / p.bills) : null), type: 'num' },
    { header: 'ค่าธรรมเนียมชำระเงิน', value: (p) => round2(p.fee), type: 'money' },
  ];
  sheets.push({
    name: 'รายวัน',
    intro: intro('ยอดขายรายวัน'),
    cols: periodCols([
      { header: 'วันที่', value: (p) => p.key, type: 'date' },
      { header: 'วัน', value: (p) => WEEKDAY[weekdayOf(p.key)] },
    ]),
    rows: period((s) => s.slice(0, 10), days),
    freezeCols: 1,
  });
  sheets.push({
    name: 'รายเดือน',
    intro: intro('ยอดขายรายเดือน'),
    cols: periodCols([{ header: 'เดือน', value: (p) => p.key }]),
    rows: period((s) => s.slice(0, 7), months),
    freezeCols: 1,
  });

  // ---------- 3) ช่วงเวลา ----------
  const hourRows = period((s) => pad(hourOf(s)), Array.from({ length: 24 }, (_, h) => pad(h)));
  sheets.push({
    name: 'รายชั่วโมง',
    intro: intro('ยอดขายตามช่วงเวลาของวัน (รวมทุกวันในช่วงที่เลือก)'),
    cols: [
      { header: 'ช่วงเวลา', value: (p: Period) => `${p.key}:00–${p.key}:59` },
      { header: 'จำนวนบิล', value: (p) => p.bills, type: 'int' },
      { header: 'ชิ้นที่ขาย', value: (p) => p.units, type: 'int' },
      { header: 'ยอดขายสุทธิ', value: (p) => round2(p.sales), type: 'money' },
      { header: 'สัดส่วนยอดขาย', value: (p) => ratio(p.sales, totalSales), type: 'pct' },
      { header: 'เฉลี่ยต่อบิล', value: (p) => (p.bills ? round2(p.sales / p.bills) : null), type: 'money' },
      { header: 'เฉลี่ยบิลต่อวัน', value: (p) => round2(p.bills / days.length), type: 'num' },
    ],
    rows: hourRows,
  });
  {
    const dayCount = new Map<number, number>();
    for (const x of days) dayCount.set(weekdayOf(x), (dayCount.get(weekdayOf(x)) ?? 0) + 1);
    const wk = period((s) => String(weekdayOf(s)), WEEK_ORDER.map(String));
    sheets.push({
      name: 'วันในสัปดาห์',
      intro: intro('ยอดขายตามวันในสัปดาห์'),
      cols: [
        { header: 'วัน', value: (p: Period) => WEEKDAY[Number(p.key)] },
        { header: 'จำนวนวันในช่วง', value: (p) => dayCount.get(Number(p.key)) ?? 0, type: 'int' },
        { header: 'จำนวนบิล', value: (p) => p.bills, type: 'int' },
        { header: 'ชิ้นที่ขาย', value: (p) => p.units, type: 'int' },
        { header: 'ยอดขายสุทธิ', value: (p) => round2(p.sales), type: 'money' },
        { header: 'สัดส่วนยอดขาย', value: (p) => ratio(p.sales, totalSales), type: 'pct' },
        { header: 'ยอดขายเฉลี่ยต่อวัน', value: (p) => { const n = dayCount.get(Number(p.key)) ?? 0; return n ? round2(p.sales / n) : null; }, type: 'money' },
        { header: 'เฉลี่ยต่อบิล', value: (p) => (p.bills ? round2(p.sales / p.bills) : null), type: 'money' },
      ],
      rows: wk,
    });
    // ตาราง วัน × ชั่วโมง (ยอดขาย และ จำนวนบิล)
    const grid = new Map<string, { sales: number; bills: number }>();
    for (const o of valid) {
      const key = `${weekdayOf(o.createdAt)}|${hourOf(o.createdAt)}`;
      const g = grid.get(key) ?? { sales: 0, bills: 0 };
      g.sales += o.total;
      g.bills++;
      grid.set(key, g);
    }
    const hrs = Array.from({ length: 24 }, (_, h) => h);
    type GR = { label: string; wd: number; metric: 'sales' | 'bills' };
    const gRows: GR[] = [
      ...WEEK_ORDER.map((wd) => ({ label: `${WEEKDAY[wd]} · ยอดขาย`, wd, metric: 'sales' as const })),
      ...WEEK_ORDER.map((wd) => ({ label: `${WEEKDAY[wd]} · จำนวนบิล`, wd, metric: 'bills' as const })),
    ];
    sheets.push({
      name: 'วัน×ชั่วโมง',
      intro: intro('ยอดขาย และ จำนวนบิล ตามวันในสัปดาห์ × ชั่วโมง (ใช้ดูช่วงเวลาขายดี / ทำ Heatmap)'),
      cols: [
        { header: 'วัน · ข้อมูล', value: (r: GR) => r.label, width: 22 },
        ...hrs.map((h): Col<GR> => ({
          header: `${pad(h)}:00`,
          value: (r) => { const g = grid.get(`${r.wd}|${h}`); return g ? (r.metric === 'sales' ? round2(g.sales) : g.bills) : 0; },
          type: 'int',
          width: 9,
        })),
        { header: 'รวม', value: (r: GR) => hrs.reduce((a, h) => a + ((grid.get(`${r.wd}|${h}`)?.[r.metric]) ?? 0), 0), type: 'int', width: 12 },
      ],
      rows: gRows,
      freezeCols: 1,
    });
  }

  // ---------- 4) สินค้า / SKU ----------
  {
    const byProduct = groupBy(lines, (l) => l.productId ?? `name:${l.productName}`);
    const info = new Map<number | string, Line>();
    for (const l of lines) if (!info.has(l.productId ?? `name:${l.productName}`)) info.set(l.productId ?? `name:${l.productName}`, l);
    const rows = [...byProduct.entries()].sort((a, b) => b[1].units - a[1].units || b[1].net - a[1].net);
    type PR = [number | string, Agg];
    const rank = new Map(rows.map(([k], i) => [k, i + 1]));
    sheets.push({
      name: 'สินค้าขายดี',
      intro: intro('ยอดขายแยกตามสินค้า (เรียงจากขายได้มากสุด)', 'ยอดขายสุทธิ = ราคาในบิล − ส่วนลดท้ายบิลที่ปันส่วน (รวม VAT) · กำไรขั้นต้นคิดจากยอดไม่รวม VAT'),
      cols: [
        { header: 'อันดับ', value: (r: PR) => rank.get(r[0]), type: 'int', width: 8 },
        { header: 'รหัสสินค้า', value: ([k]) => info.get(k)?.productCode ?? '' },
        { header: 'ชื่อสินค้า', value: ([k]) => info.get(k)?.productName ?? '' },
        { header: 'หมวดหมู่', value: ([k]) => info.get(k)?.category ?? '' },
        { header: 'จำนวนบิล', value: ([, a]) => a.bills.size, type: 'int' },
        { header: 'ชิ้นที่ขาย', value: ([, a]) => a.units, type: 'int' },
        { header: 'สัดส่วนชิ้น', value: ([, a]) => ratio(a.units, totalUnits), type: 'pct' },
        { header: 'ยอดตามราคาในบิล', value: ([, a]) => round2(a.gross), type: 'money' },
        { header: 'ส่วนลดท้ายบิล (ปันส่วน)', value: ([, a]) => round2(a.disc), type: 'money' },
        { header: 'ยอดขายสุทธิ', value: ([, a]) => round2(a.net), type: 'money' },
        { header: 'สัดส่วนยอดขาย', value: ([, a]) => ratio(a.net, totalNet), type: 'pct' },
        { header: 'ราคาเฉลี่ยต่อชิ้น', value: ([, a]) => (a.units ? round2(a.net / a.units) : null), type: 'money' },
        { header: 'ต้นทุน', value: ([, a]) => round2(a.cost), type: 'money' },
        { header: 'กำไรขั้นต้น', value: ([, a]) => round2(a.profit), type: 'money' },
        { header: 'อัตรากำไร', value: ([, a]) => ratio(a.profit, a.exVat), type: 'pct' },
        { header: 'สต็อกคงเหลือตอนนี้', value: ([k]) => (typeof k === 'number' ? productStock.get(k) ?? 0 : null), type: 'int' },
        { header: 'ขายครั้งแรกในช่วง', value: ([, a]) => a.first, type: 'datetime' },
        { header: 'ขายล่าสุด', value: ([, a]) => a.last, type: 'datetime' },
      ],
      rows,
      freezeCols: 3,
    });

    const bySku = groupBy(lines, (l) => l.variantId);
    const skuInfo = new Map<number, Line>();
    for (const l of lines) if (!skuInfo.has(l.variantId)) skuInfo.set(l.variantId, l);
    const skuRows = [...bySku.entries()].sort((a, b) => b[1].units - a[1].units || b[1].net - a[1].net);
    type SR = [number, Agg];
    const skuRank = new Map(skuRows.map(([k], i) => [k, i + 1]));
    sheets.push({
      name: 'SKU ขายดี',
      intro: intro('ยอดขายแยกตาม SKU (สี × ไซซ์)', 'อัตราขายออก = ชิ้นที่ขาย ÷ (ชิ้นที่ขาย + สต็อกคงเหลือตอนนี้)'),
      cols: [
        { header: 'อันดับ', value: (r: SR) => skuRank.get(r[0]), type: 'int', width: 8 },
        { header: 'รหัส SKU (ระบบ)', value: ([k]) => skuInfo.get(k)?.variantSku ?? '' },
        { header: 'บาร์โค้ด', value: ([k]) => skuInfo.get(k)?.barcode ?? '' },
        { header: 'รหัสสินค้า', value: ([k]) => skuInfo.get(k)?.productCode ?? '' },
        { header: 'ชื่อสินค้า', value: ([k]) => skuInfo.get(k)?.productName ?? '' },
        { header: 'หมวดหมู่', value: ([k]) => skuInfo.get(k)?.category ?? '' },
        { header: 'สี', value: ([k]) => dash(skuInfo.get(k)?.color) },
        { header: 'ไซซ์', value: ([k]) => dash(skuInfo.get(k)?.size) },
        { header: 'คุณสมบัติอื่น', value: ([k]) => skuInfo.get(k)?.extra ?? '' },
        { header: 'จำนวนบิล', value: ([, a]) => a.bills.size, type: 'int' },
        { header: 'ชิ้นที่ขาย', value: ([, a]) => a.units, type: 'int' },
        { header: 'ยอดขายสุทธิ', value: ([, a]) => round2(a.net), type: 'money' },
        { header: 'กำไรขั้นต้น', value: ([, a]) => round2(a.profit), type: 'money' },
        { header: 'สต็อกคงเหลือตอนนี้', value: ([k]) => stockOf.get(k) ?? 0, type: 'int' },
        { header: 'อัตราขายออก', value: ([k, a]) => ratio(a.units, a.units + Math.max(0, stockOf.get(k) ?? 0)), type: 'pct' },
        { header: 'ขายล่าสุด', value: ([, a]) => a.last, type: 'datetime' },
      ],
      rows: skuRows,
      freezeCols: 2,
    });
  }

  // ---------- 5) ไซซ์ / สี / หมวดหมู่ ----------
  type GR = [string, Agg];
  const dimCols = (label: string): Col<GR>[] => [
    { header: label, value: ([k]) => k },
    { header: 'ชิ้นที่ขาย', value: ([, a]) => a.units, type: 'int' },
    { header: 'สัดส่วนชิ้น', value: ([, a]) => ratio(a.units, totalUnits), type: 'pct' },
    { header: 'ยอดขายสุทธิ', value: ([, a]) => round2(a.net), type: 'money' },
    { header: 'สัดส่วนยอดขาย', value: ([, a]) => ratio(a.net, totalNet), type: 'pct' },
    { header: 'จำนวนบิล', value: ([, a]) => a.bills.size, type: 'int' },
    { header: 'จำนวนสินค้า (รุ่น)', value: ([, a]) => a.products.size, type: 'int' },
    { header: 'ราคาเฉลี่ยต่อชิ้น', value: ([, a]) => (a.units ? round2(a.net / a.units) : null), type: 'money' },
    { header: 'กำไรขั้นต้น', value: ([, a]) => round2(a.profit), type: 'money' },
    { header: 'อัตรากำไร', value: ([, a]) => ratio(a.profit, a.exVat), type: 'pct' },
  ];
  const sorted = (m: Map<string, Agg>) => [...m.entries()].sort((a, b) => b[1].units - a[1].units || b[1].net - a[1].net);
  const sizeRows = sorted(groupBy(lines, (l) => dash(l.size) || 'ไม่มีไซซ์'));
  const colorRows = sorted(groupBy(lines, (l) => dash(l.color) || 'ไม่มีสี'));
  sheets.push({ name: 'ไซซ์ขายดี', intro: intro('ยอดขายแยกตามไซซ์'), cols: dimCols('ไซซ์'), rows: sizeRows });
  sheets.push({ name: 'สีขายดี', intro: intro('ยอดขายแยกตามสี'), cols: dimCols('สี'), rows: colorRows });
  {
    // สี × ไซซ์ (จำนวนชิ้น)
    const sizes = sizeRows.map(([k]) => k);
    const cross = groupBy(lines, (l) => `${dash(l.color) || 'ไม่มีสี'}|${dash(l.size) || 'ไม่มีไซซ์'}`);
    sheets.push({
      name: 'สี×ไซซ์',
      intro: intro('จำนวนชิ้นที่ขาย แยกตาม สี × ไซซ์ (ใช้วางแผนสั่งผลิต/สต็อก)'),
      cols: [
        { header: 'สี', value: ([k]: GR) => k },
        ...sizes.map((sz): Col<GR> => ({ header: sz, value: ([c]) => cross.get(`${c}|${sz}`)?.units ?? 0, type: 'int', width: Math.max(8, sz.length + 3) })),
        { header: 'รวม', value: ([, a]) => a.units, type: 'int' },
      ],
      rows: colorRows,
      freezeCols: 1,
    });
  }
  sheets.push({ name: 'หมวดหมู่', intro: intro('ยอดขายแยกตามหมวดหมู่'), cols: dimCols('หมวดหมู่'), rows: sorted(groupBy(lines, (l) => l.category ?? 'ไม่ระบุ')) });

  // ---------- 6) การชำระเงิน / พนักงาน / สาขา / โปรโมชั่น ----------
  interface OG { key: string; bills: number; sales: number; fee: number; discount: number; units: number }
  const byOrder = (key: (o: OrderRow) => string) => {
    const m = new Map<string, OG>();
    for (const o of valid) {
      const k = key(o);
      const g = m.get(k) ?? { key: k, bills: 0, sales: 0, fee: 0, discount: 0, units: 0 };
      g.bills++;
      g.sales += o.total;
      g.fee += o.fee;
      g.discount += o.discount;
      g.units += o.items;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.sales - a.sales);
  };
  const ogCols = (label: string, extra: Col<OG>[] = []): Col<OG>[] => [
    { header: label, value: (g) => g.key },
    { header: 'จำนวนบิล', value: (g) => g.bills, type: 'int' },
    { header: 'ชิ้นที่ขาย', value: (g) => g.units, type: 'int' },
    { header: 'ยอดขายสุทธิ', value: (g) => round2(g.sales), type: 'money' },
    { header: 'สัดส่วนยอดขาย', value: (g) => ratio(g.sales, totalSales), type: 'pct' },
    { header: 'เฉลี่ยต่อบิล', value: (g) => (g.bills ? round2(g.sales / g.bills) : null), type: 'money' },
    { header: 'ชิ้นต่อบิล', value: (g) => (g.bills ? round2(g.units / g.bills) : null), type: 'num' },
    ...extra,
  ];
  sheets.push({
    name: 'การชำระเงิน',
    intro: intro('ยอดขายแยกตามวิธีชำระเงิน'),
    cols: ogCols('วิธีชำระเงิน', [{ header: 'ค่าธรรมเนียม', value: (g) => round2(g.fee), type: 'money' }]),
    rows: byOrder((o) => pay(o.paymentMethod)),
  });
  sheets.push({ name: 'พนักงานขาย', intro: intro('ยอดขายแยกตามพนักงานขาย'), cols: ogCols('พนักงาน'), rows: byOrder((o) => o.salesperson || 'ไม่ระบุ') });
  const branchRows = byOrder((o) => o.branch ?? 'ไม่ระบุ');
  if (branchRows.length > 1) sheets.push({ name: 'สาขา', intro: intro('ยอดขายแยกตามสาขา'), cols: ogCols('สาขา'), rows: branchRows });
  const promoRows = byOrder((o) => o.promoCode || '').filter((g) => g.key);
  if (promoRows.length) {
    sheets.push({
      name: 'โปรโมชั่น',
      intro: intro('บิลที่ใช้โค้ดส่วนลด'),
      cols: ogCols('โค้ดส่วนลด', [{ header: 'ส่วนลดรวม', value: (g) => round2(g.discount), type: 'money' }]),
      rows: promoRows,
    });
  }

  // ---------- 7) แก้ไข / ยกเลิกบิล ----------
  {
    const edits = db
      .prepare(
        `SELECT e.edited_at AS at, o.order_no AS orderNo, e.kind, e.staff, e.reason, e.summary, e.old_total AS oldTotal,
                e.new_total AS newTotal, e.diff, e.settle_method AS settle, b.name AS branch
           FROM order_edits e JOIN orders o ON o.id = e.order_id LEFT JOIN branches b ON b.id = o.branch_id
          WHERE date(e.edited_at) BETWEEN ? AND ? ORDER BY e.edited_at, e.id`,
      )
      .all(...args) as Record<string, any>[];
    if (edits.length) {
      sheets.push({
        name: 'แก้ไข-ยกเลิกบิล',
        intro: intro('ประวัติการเปลี่ยน/คืนสินค้า และยกเลิกบิล (ตามวันที่ทำรายการ)'),
        cols: [
          { header: 'วันเวลา', value: (r) => r.at, type: 'datetime' },
          { header: 'สาขา', value: (r) => r.branch ?? '' },
          { header: 'เลขที่บิล', value: (r) => r.orderNo },
          { header: 'ประเภท', value: (r) => (r.kind === 'void' ? 'ยกเลิกบิล' : 'แก้ไขบิล') },
          { header: 'พนักงาน', value: (r) => r.staff },
          { header: 'เหตุผล', value: (r) => r.reason },
          { header: 'รายละเอียด', value: (r) => r.summary, width: 48 },
          { header: 'ยอดเดิม', value: (r) => r.oldTotal, type: 'money' },
          { header: 'ยอดใหม่', value: (r) => r.newTotal, type: 'money' },
          { header: 'ส่วนต่าง (+เก็บเพิ่ม/−คืน)', value: (r) => r.diff, type: 'money' },
          { header: 'ชำระส่วนต่างด้วย', value: (r) => (r.settle ? pay(r.settle) : '') },
        ],
        rows: edits,
      });
    }
  }

  // ---------- 8) ข้อมูลดิบ ----------
  sheets.push({
    name: 'บิล',
    intro: intro('ข้อมูลดิบ: บิลทั้งหมดในช่วง (รวมบิลที่ยกเลิก — กรองด้วยคอลัมน์ "สถานะ")'),
    cols: [
      { header: 'เลขที่บิล', value: (o: OrderRow) => o.orderNo },
      { header: 'วันเวลา', value: (o) => o.createdAt, type: 'datetime' },
      { header: 'วันที่', value: (o) => o.createdAt.slice(0, 10), type: 'date' },
      { header: 'วัน', value: (o) => WEEKDAY[weekdayOf(o.createdAt)] },
      { header: 'ชั่วโมง', value: (o) => hourOf(o.createdAt), type: 'int' },
      { header: 'สาขา', value: (o) => o.branch ?? '' },
      { header: 'สถานะ', value: (o) => STATUS_LABEL[o.status] ?? o.status },
      { header: 'ลูกค้า', value: (o) => o.customerName ?? '' },
      { header: 'พนักงานขาย', value: (o) => o.salesperson ?? '' },
      { header: 'ประเภทการขาย', value: (o) => o.orderType ?? '' },
      { header: 'จำนวนชิ้น', value: (o) => o.items, type: 'int' },
      { header: 'ยอดก่อนส่วนลด', value: (o) => o.subtotal, type: 'money' },
      { header: 'ส่วนลด', value: (o) => o.discount, type: 'money' },
      { header: 'โค้ดส่วนลด', value: (o) => o.promoCode ?? '' },
      { header: 'ค่าธรรมเนียม', value: (o) => o.fee, type: 'money' },
      { header: 'VAT', value: (o) => o.vat, type: 'money' },
      { header: 'ยอดสุทธิ', value: (o) => o.total, type: 'money' },
      { header: 'วิธีชำระเงิน', value: (o) => pay(o.paymentMethod) },
    ],
    rows: orders,
    freezeCols: 1,
  });
  sheets.push({
    name: 'รายการขาย',
    intro: intro('ข้อมูลดิบ: สินค้าที่ขายทีละรายการ (ไม่รวมบิลที่ยกเลิก) — เลือกทั้งตารางแล้ว แทรก → PivotTable เพื่อวิเคราะห์ต่อ'),
    cols: [
      { header: 'เลขที่บิล', value: (l: Line) => l.orderNo },
      { header: 'วันเวลา', value: (l) => l.createdAt, type: 'datetime' },
      { header: 'วันที่', value: (l) => l.createdAt.slice(0, 10), type: 'date' },
      { header: 'เดือน', value: (l) => l.createdAt.slice(0, 7) },
      { header: 'วัน', value: (l) => WEEKDAY[weekdayOf(l.createdAt)] },
      { header: 'ชั่วโมง', value: (l) => hourOf(l.createdAt), type: 'int' },
      { header: 'สาขา', value: (l) => l.branch ?? '' },
      { header: 'พนักงานขาย', value: (l) => l.salesperson ?? '' },
      { header: 'ลูกค้า', value: (l) => l.customerName ?? '' },
      { header: 'วิธีชำระเงิน', value: (l) => pay(l.paymentMethod) },
      { header: 'โค้ดส่วนลด', value: (l) => l.promoCode ?? '' },
      { header: 'รหัสสินค้า', value: (l) => l.productCode ?? '' },
      { header: 'ชื่อสินค้า', value: (l) => l.productName },
      { header: 'หมวดหมู่', value: (l) => l.category ?? '' },
      { header: 'สี', value: (l) => dash(l.color) },
      { header: 'ไซซ์', value: (l) => dash(l.size) },
      { header: 'คุณสมบัติอื่น', value: (l) => l.extra },
      { header: 'รหัส SKU (ระบบ)', value: (l) => l.variantSku },
      { header: 'บาร์โค้ด', value: (l) => l.barcode ?? '' },
      { header: 'จำนวน', value: (l) => l.qty, type: 'int' },
      { header: 'ราคาต่อชิ้น', value: (l) => l.unitPrice, type: 'money' },
      { header: 'ยอดตามราคา', value: (l) => l.lineTotal, type: 'money' },
      { header: 'ส่วนลดท้ายบิล (ปันส่วน)', value: (l) => round2(l.disc), type: 'money' },
      { header: 'ยอดสุทธิ', value: (l) => round2(l.net), type: 'money' },
      { header: 'ยอดไม่รวม VAT', value: (l) => round2(l.exVat), type: 'money' },
      { header: 'ต้นทุน', value: (l) => round2(l.cost), type: 'money' },
      { header: 'กำไรขั้นต้น', value: (l) => round2(l.profit), type: 'money' },
    ],
    rows: lines,
    freezeCols: 1,
  });

  return buildXlsx(sheets);
}
