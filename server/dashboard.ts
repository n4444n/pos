// รายงาน / Dashboard สำหรับร้านเสื้อผ้า
// ยอดขายนับเฉพาะบิลที่ไม่ถูกยกเลิก (ยอดสุทธิหลังแก้ไขบิลแล้ว) — เทียบกับช่วงเวลาก่อนหน้าที่ยาวเท่ากัน
// ใบลดหนี้ (รับคืนสินค้า) หักออกตามวันที่ออกใบลดหนี้ — ยอดตรงกับรายงานยอดขาย / รายงานภาษีขาย
import { expenseTotal } from './expenses.ts';
import { db } from './db.ts';
import { HttpError, round2 } from './common.ts';
import { CN_RANGE, CNI_COST, CNI_FROM } from './creditAdj.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000) + 1;

type Gran = 'hour' | 'day' | 'month';
const BUCKET: Record<Gran, string> = {
  hour: "strftime('%H', o.created_at)",
  day: 'date(o.created_at)',
  month: "strftime('%Y-%m', o.created_at)",
};

const RANGE = "o.status != 'void' AND date(o.created_at) BETWEEN ? AND ?";
const ITEMS_JOIN = `FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN variants v ON v.id = oi.variant_id
  LEFT JOIN products p ON p.id = v.product_id`;

function kpis(from: string, to: string) {
  const o = db
    .prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS sales, COALESCE(SUM(vat), 0) AS vat,
                     COALESCE(SUM(discount), 0) AS discount FROM orders o WHERE ${RANGE}`)
    .get(from, to) as { bills: number; sales: number; vat: number; discount: number };
  const i = db
    .prepare(`SELECT COALESCE(SUM(oi.qty), 0) AS units, COALESCE(SUM(oi.qty * COALESCE(v.cost, p.cost, 0)), 0) AS cost
              ${ITEMS_JOIN} WHERE ${RANGE}`)
    .get(from, to) as { units: number; cost: number };
  // ใบลดหนี้ในช่วงนี้
  const c = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cn.total), 0) AS total, COALESCE(SUM(cn.vat), 0) AS vat FROM credit_notes cn WHERE ${CN_RANGE}`)
    .get(from, to) as { n: number; total: number; vat: number };
  const ci = db
    .prepare(`SELECT COALESCE(SUM(ci.qty), 0) AS units, COALESCE(SUM(${CNI_COST}), 0) AS cost ${CNI_FROM} WHERE ${CN_RANGE}`)
    .get(from, to) as { units: number; cost: number };
  o.sales -= c.total;
  o.vat -= c.vat;
  i.units -= ci.units;
  i.cost -= ci.cost;
  const netExVat = o.sales - o.vat;
  const profit = round2(netExVat - i.cost);
  return {
    sales: round2(o.sales),
    /** คืนเงินด้วยใบลดหนี้ (หักใน sales แล้ว) */
    refund: round2(c.total),
    creditNotes: c.n,
    bills: o.bills,
    units: i.units,
    discount: round2(o.discount),
    profit,
    margin: netExVat > 0 ? round2((profit / netExVat) * 100) : 0,
    aov: o.bills ? round2(o.sales / o.bills) : 0,
    upt: o.bills ? round2(i.units / o.bills) : 0,
  };
}

function buckets(from: string, to: string, g: Gran) {
  const keys: string[] = [];
  if (g === 'hour') for (let h = 0; h < 24; h++) keys.push(pad(h));
  else if (g === 'day') for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d);
  else {
    const s = parse(from);
    const e = parse(to);
    for (let d = new Date(s.getFullYear(), s.getMonth(), 1); d <= e; d.setMonth(d.getMonth() + 1)) {
      keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    }
  }
  return keys;
}

function series(from: string, to: string, g: Gran) {
  const b = BUCKET[g];
  const o = db
    .prepare(`SELECT ${b} AS k, COUNT(*) AS bills, SUM(total) AS sales, SUM(vat) AS vat FROM orders o WHERE ${RANGE} GROUP BY k`)
    .all(from, to) as { k: string; bills: number; sales: number; vat: number }[];
  const i = db
    .prepare(`SELECT ${b} AS k, SUM(oi.qty) AS units, SUM(oi.qty * COALESCE(v.cost, p.cost, 0)) AS cost ${ITEMS_JOIN} WHERE ${RANGE} GROUP BY k`)
    .all(from, to) as { k: string; units: number; cost: number }[];
  const om = new Map(o.map((r) => [r.k, r]));
  const im = new Map(i.map((r) => [r.k, r]));
  // ใบลดหนี้: หักในช่วงเวลา (ชั่วโมง/วัน/เดือน) ที่ออกใบลดหนี้
  const cb = b.replace('o.created_at', 'cn.issued_at');
  for (const r of db
    .prepare(`SELECT ${cb} AS k, SUM(cn.total) AS sales, SUM(cn.vat) AS vat FROM credit_notes cn WHERE ${CN_RANGE} GROUP BY k`)
    .all(from, to) as { k: string; sales: number; vat: number }[]) {
    const a = om.get(r.k) ?? { k: r.k, bills: 0, sales: 0, vat: 0 };
    a.sales -= r.sales;
    a.vat -= r.vat;
    om.set(r.k, a);
  }
  for (const r of db
    .prepare(`SELECT ${cb} AS k, SUM(ci.qty) AS units, SUM(${CNI_COST}) AS cost ${CNI_FROM} WHERE ${CN_RANGE} GROUP BY k`)
    .all(from, to) as { k: string; units: number; cost: number }[]) {
    const x = im.get(r.k) ?? { k: r.k, units: 0, cost: 0 };
    x.units -= r.units;
    x.cost -= r.cost;
    im.set(r.k, x);
  }
  return buckets(from, to, g).map((k) => {
    const a = om.get(k);
    const c = im.get(k);
    return {
      key: k,
      sales: round2(a?.sales ?? 0),
      bills: a?.bills ?? 0,
      units: c?.units ?? 0,
      profit: round2((a?.sales ?? 0) - (a?.vat ?? 0) - (c?.cost ?? 0)),
    };
  });
}

export interface DashQuery { from?: string; to?: string }

export function dashboard(f: DashQuery) {
  const today = iso(new Date());
  const to = f.to && DATE.test(f.to) ? f.to : today;
  const from = f.from && DATE.test(f.from) ? f.from : addDays(to, -6);
  if (from > to) throw new HttpError(422, 'ช่วงวันที่ไม่ถูกต้อง');
  const n = daysBetween(from, to);
  if (n > 731) throw new HttpError(422, 'เลือกช่วงได้ไม่เกิน 2 ปี');
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  const gran: Gran = n === 1 ? 'hour' : n <= 62 ? 'day' : 'month';

  const args = [from, to];
  /** หักสินค้าที่คืนด้วยใบลดหนี้ (ตามคีย์) แล้วเรียงใหม่ · ตัดรายการที่เหลือ 0 */
  const minus = <T extends { units: number; sales: number }>(rows: T[], key: (r: T) => unknown, sql: string, sort: (a: T, b: T) => number, limit = 1000) => {
    const ret = db.prepare(sql).all(...args) as { k: unknown; units: number; sales: number }[];
    for (const r of ret) {
      const x = rows.find((y) => key(y) === r.k);
      if (!x) continue;
      x.units -= r.units;
      x.sales = round2(x.sales - r.sales);
    }
    return rows.filter((x) => x.units > 0 || x.sales > 0).sort(sort).slice(0, limit);
  };
  const byUnits = (a: { units: number; sales: number }, b: { units: number; sales: number }) => b.units - a.units || b.sales - a.sales;
  const bySales = (a: { sales: number }, b: { sales: number }) => b.sales - a.sales;
  const cnItems = (k: string, extra = '') =>
    `SELECT ${k} AS k, SUM(ci.qty) AS units, SUM(ci.line_total) AS sales ${CNI_FROM} ${extra} WHERE ${CN_RANGE} GROUP BY k`;
  const topProducts = db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.art, p.tint, p.category_id AS categoryId, c.name AS category,
              SUM(oi.qty) AS units, ROUND(SUM(oi.line_total), 2) AS sales
         ${ITEMS_JOIN} LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${RANGE} AND p.id IS NOT NULL
        GROUP BY p.id ORDER BY units DESC, sales DESC`,
    )
    .all(...args) as { id: number; units: number; sales: number }[];
  const topProductsNet = minus(topProducts, (r) => r.id, cnItems('p.id'), byUnits, 10);
  const sizes = db
    .prepare(`SELECT oi.size AS label, SUM(oi.qty) AS units, ROUND(SUM(oi.line_total), 2) AS sales
                ${ITEMS_JOIN} WHERE ${RANGE} AND oi.size != '-' GROUP BY oi.size ORDER BY units DESC`)
    .all(...args) as { label: string; units: number; sales: number }[];
  const sizesNet = minus(sizes, (r) => r.label, cnItems('ci.size'), byUnits, 10);
  const colors = db
    .prepare(`SELECT oi.color AS label, MAX(v.color_hex) AS hex, SUM(oi.qty) AS units, ROUND(SUM(oi.line_total), 2) AS sales
                ${ITEMS_JOIN} WHERE ${RANGE} AND oi.color != '-' GROUP BY oi.color ORDER BY units DESC`)
    .all(...args) as { label: string; units: number; sales: number }[];
  const colorsNet = minus(colors, (r) => r.label, cnItems('ci.color'), byUnits, 10);
  const categories = db
    .prepare(
      `SELECT c.id, c.name AS label, SUM(oi.qty) AS units, ROUND(SUM(oi.line_total), 2) AS sales
         ${ITEMS_JOIN} JOIN categories c ON c.id = p.category_id
        WHERE ${RANGE} GROUP BY c.id ORDER BY sales DESC`,
    )
    .all(...args) as { id: string; units: number; sales: number }[];
  const categoriesNet = minus(categories, (r) => r.id, cnItems('p.category_id'), bySales);
  const payments = db
    .prepare(`SELECT payment_method AS method, COUNT(*) AS bills, ROUND(SUM(total), 2) AS sales, ROUND(COALESCE(SUM(fee), 0), 2) AS fees
                FROM orders o WHERE ${RANGE} GROUP BY payment_method ORDER BY sales DESC`)
    .all(...args) as { method: string; bills: number; sales: number; fees: number }[];
  // คืนเงินด้วยใบลดหนี้ → หักจากวิธีที่คืนเงิน
  for (const r of db
    .prepare(`SELECT cn.refund_method AS k, SUM(cn.total) AS sales FROM credit_notes cn WHERE ${CN_RANGE} GROUP BY k`)
    .all(...args) as { k: string; sales: number }[]) {
    const x = payments.find((y) => y.method === r.k);
    if (x) x.sales = round2(x.sales - r.sales);
  }
  payments.sort(bySales);
  const hourRows = db
    .prepare(`SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS h, COUNT(*) AS bills, ROUND(SUM(total), 2) AS sales
                FROM orders o WHERE ${RANGE} GROUP BY h`)
    .all(...args) as { h: number; bills: number; sales: number }[];
  for (const r of db
    .prepare(`SELECT CAST(strftime('%H', cn.issued_at) AS INTEGER) AS h, SUM(cn.total) AS sales FROM credit_notes cn WHERE ${CN_RANGE} GROUP BY h`)
    .all(...args) as { h: number; sales: number }[]) {
    const x = hourRows.find((y) => y.h === r.h);
    if (x) x.sales = round2(x.sales - r.sales);
  }
  const hm = new Map(hourRows.map((r) => [r.h, r]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, bills: hm.get(h)?.bills ?? 0, sales: hm.get(h)?.sales ?? 0 }));
  const staff = db
    .prepare(`SELECT COALESCE(salesperson, 'ไม่ระบุ') AS name, COUNT(*) AS bills, ROUND(SUM(total), 2) AS sales
                FROM orders o WHERE ${RANGE} GROUP BY name ORDER BY sales DESC`)
    .all(...args) as { name: string; bills: number; sales: number }[];
  // ใบลดหนี้ → หักยอดของพนักงานที่ขายบิลเดิม
  for (const r of db
    .prepare(`SELECT COALESCE(o.salesperson, 'ไม่ระบุ') AS k, SUM(cn.total) AS sales FROM credit_notes cn JOIN orders_all o ON o.id = cn.order_id
               WHERE ${CN_RANGE} GROUP BY k`)
    .all(...args) as { k: string; sales: number }[]) {
    const x = staff.find((y) => y.name === r.k);
    if (x) x.sales = round2(x.sales - r.sales);
  }
  const staffNet = staff.sort(bySales).slice(0, 8);

  // สต็อกใกล้หมด: ไซซ์/สีที่เหลือ ≤ 3 — เรียงจากที่ขายดีใน 30 วันล่าสุดก่อน
  const lowStock = db
    .prepare(
      `SELECT v.id AS variantId, p.id AS productId, p.name, p.art, v.size, v.color, v.extra, v.color_hex AS colorHex, v.stock, p.low_stock AS lowStock,
              COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                         WHERE oi.variant_id = v.id AND o.status != 'void' AND date(o.created_at) >= ?), 0) AS sold30
         FROM variants v JOIN products p ON p.id = v.product_id
        WHERE p.active = 1 AND v.active = 1 AND v.stock <= p.low_stock
        ORDER BY sold30 DESC, v.stock ASC LIMIT 12`,
    )
    .all(addDays(today, -29));
  const stockCounts = db
    .prepare(
      `SELECT SUM(CASE WHEN v.stock = 0 THEN 1 ELSE 0 END) AS out, SUM(CASE WHEN v.stock > 0 AND v.stock <= p.low_stock THEN 1 ELSE 0 END) AS low,
              COUNT(*) AS total, COALESCE(SUM(v.stock), 0) AS units, COALESCE(SUM(v.stock * COALESCE(v.cost, p.cost, 0)), 0) AS value
         FROM variants v JOIN products p ON p.id = v.product_id WHERE p.active = 1 AND v.active = 1`,
    )
    .get() as { out: number; low: number; total: number; units: number; value: number };

  // คืน / เปลี่ยนสินค้า (ตามวันที่ทำรายการ)
  const ret = db
    .prepare(
      `SELECT SUM(CASE WHEN kind = 'edit' THEN 1 ELSE 0 END) AS edits, SUM(CASE WHEN kind = 'void' THEN 1 ELSE 0 END) AS voids,
              COALESCE(SUM(CASE WHEN diff < 0 THEN -diff END), 0) AS refunded, COALESCE(SUM(CASE WHEN diff > 0 THEN diff END), 0) AS collected
         FROM order_edits WHERE date(edited_at) BETWEEN ? AND ?`,
    )
    .get(...args) as { edits: number | null; voids: number | null; refunded: number; collected: number };

  const recent = db
    .prepare(
      `SELECT o.id, o.order_no AS orderNo, o.created_at AS createdAt, o.customer_name AS customerName, o.salesperson,
              o.total, o.payment_method AS paymentMethod, o.status,
              (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id) AS itemCount
         FROM orders o WHERE date(o.created_at) BETWEEN ? AND ? ORDER BY o.id DESC LIMIT 8`,
    )
    .all(...args);

  const cur = kpis(from, to);
  const curSeries = series(from, to, gran);
  // ช่วงก่อนหน้า: จัดให้ตรงตำแหน่งกับช่วงปัจจุบัน (วันที่ 1 เทียบวันที่ 1 …)
  const prevSeries = series(prevFrom, prevTo, gran);

  return {
    range: { from, to, days: n, granularity: gran },
    prevRange: { from: prevFrom, to: prevTo },
    kpis: cur,
    prev: kpis(prevFrom, prevTo),
    // ค่าใช้จ่ายร้าน → กำไรสุทธิ = กำไรขั้นต้น − ค่าใช้จ่าย
    expenses: { ...expenseTotal(from, to), prev: expenseTotal(prevFrom, prevTo).total },
    series: curSeries,
    prevSeries,
    topProducts: topProductsNet,
    sizes: sizesNet,
    colors: colorsNet,
    categories: categoriesNet,
    payments,
    hours,
    staff: staffNet,
    lowStock,
    stock: { out: stockCounts.out ?? 0, low: stockCounts.low ?? 0, variants: stockCounts.total, units: stockCounts.units, value: round2(stockCounts.value) },
    // refunded รวมใบลดหนี้อยู่แล้ว (order_edits kind = 'credit')
    returns: { edits: ret.edits ?? 0, voids: ret.voids ?? 0, creditNotes: cur.creditNotes, refunded: round2(ret.refunded), collected: round2(ret.collected) },
    recent,
  };
}

export function dashboardCsv(f: DashQuery) {
  const d = dashboard(f);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  const row = (...c: unknown[]) => lines.push(c.map(esc).join(','));
  row('รายงานยอดขาย', `${d.range.from} ถึง ${d.range.to}`);
  row();
  row('ตัวชี้วัด', 'ช่วงนี้', 'ช่วงก่อนหน้า');
  row('ยอดขายสุทธิ', d.kpis.sales, d.prev.sales);
  row('กำไรขั้นต้น', d.kpis.profit, d.prev.profit);
  row('ค่าใช้จ่ายร้าน', d.expenses.total, d.expenses.prev);
  row('กำไรสุทธิ', round2(d.kpis.profit - d.expenses.total), round2(d.prev.profit - d.expenses.prev));
  row('จำนวนบิล', d.kpis.bills, d.prev.bills);
  row('จำนวนชิ้น', d.kpis.units, d.prev.units);
  row('เฉลี่ยต่อบิล', d.kpis.aov, d.prev.aov);
  row();
  row(d.range.granularity === 'hour' ? 'ชั่วโมง' : d.range.granularity === 'day' ? 'วันที่' : 'เดือน', 'ยอดขาย', 'กำไรขั้นต้น', 'บิล', 'ชิ้น');
  for (const s of d.series) row(s.key, s.sales, s.profit, s.bills, s.units);
  row();
  row('สินค้าขายดี', 'SKU', 'หมวด', 'ชิ้น', 'ยอดขาย');
  for (const p of d.topProducts as Record<string, unknown>[]) row(p.name, p.sku, p.category, p.units, p.sales);
  return '﻿' + lines.join('\r\n');
}
