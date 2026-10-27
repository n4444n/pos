// รายงานย่อย (เมนู รายงาน → ยอดขาย / สินค้า) + ส่งออก Excel
// - ยอดขาย: แยกรายวัน / รายสัปดาห์ / รายเดือน — ยอดขาย ส่วนลด คืนเงิน ยอดสุทธิ ต้นทุน กำไร
// - สินค้า: ขายได้กี่ชิ้น ยอดขาย ต้นทุน/ราคาขายเฉลี่ย กำไร คงเหลือ — ดูรายสินค้า หรือแยกตาม SKU
// - รายบิล: ทุกบิลในช่วงวันที่ — ยอดขาย ส่วนลด ยอดสุทธิ VAT ต้นทุน กำไร วิธีชำระ สถานะ (ค้นหา / กรองวิธีชำระ / สถานะ)
// ตัวเลขยอดขายตรงกับหน้า "รายงานรวม" (ไม่รวมบิลที่ยกเลิก · ยอดหลังแก้ไขบิลแล้ว) · ข้อมูลตามสาขาที่เลือก (หรือรวมทุกสาขา)
import { db } from './db.ts';
import { HttpError, PAYMENT_METHODS, round2 } from './common.ts';
import { getSettings } from './settings.ts';
import { buildXlsx, type Col } from './xlsx.ts';
import { CN_PER_BILL, CN_RANGE, CNI_COST, CNI_EXVAT, CNI_FROM } from './creditAdj.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WD_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
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
/** 15 ต.ค. 2026 */
const dayText = (s: string) => {
  const d = parse(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
/** วันจันทร์ของสัปดาห์ */
const monday = (s: string) => addDays(s, -((parse(s).getDay() + 6) % 7));

function range(f: { from?: string; to?: string }) {
  const today = iso(new Date());
  const to = f.to && DATE.test(f.to) ? f.to : today;
  const from = f.from && DATE.test(f.from) ? f.from : addDays(to, -6);
  if (from > to) throw new HttpError(422, 'ช่วงวันที่ไม่ถูกต้อง');
  if ((parse(to).getTime() - parse(from).getTime()) / 86400000 > 731) throw new HttpError(422, 'เลือกช่วงได้ไม่เกิน 2 ปี');
  return { from, to, today };
}

// =====================================================================
// ยอดขาย
// =====================================================================
export type Group = 'day' | 'week' | 'month';
export interface SalesRow {
  key: string; label: string; from: string; to: string;
  bills: number; units: number; gross: number; discount: number; refund: number; net: number; vat: number; cost: number; profit: number;
}
export interface SalesQuery { from?: string; to?: string; group?: string }

export function salesReport(f: SalesQuery) {
  const { from, to, today } = range(f);
  const group: Group = f.group === 'week' || f.group === 'month' ? f.group : 'day';
  const RANGE = "o.status != 'void' AND date(o.created_at) BETWEEN ? AND ?";
  const byDay = new Map<string, { bills: number; gross: number; discount: number; net: number; vat: number; units: number; cost: number; refund: number }>();
  const day = (d: string) => {
    let r = byDay.get(d);
    if (!r) byDay.set(d, (r = { bills: 0, gross: 0, discount: 0, net: 0, vat: 0, units: 0, cost: 0, refund: 0 }));
    return r;
  };
  for (const r of db
    .prepare(
      `SELECT date(o.created_at) AS d, COUNT(*) AS bills, SUM(o.subtotal) AS gross, SUM(o.discount) AS discount, SUM(o.total) AS net, SUM(o.vat) AS vat
         FROM orders o WHERE ${RANGE} GROUP BY d`,
    )
    .all(from, to) as { d: string; bills: number; gross: number; discount: number; net: number; vat: number }[]) {
    Object.assign(day(r.d), { bills: r.bills, gross: r.gross, discount: r.discount, net: r.net, vat: r.vat });
  }
  for (const r of db
    .prepare(
      `SELECT date(o.created_at) AS d, SUM(oi.qty) AS units, SUM(oi.qty * COALESCE(v.cost, p.cost, 0)) AS cost
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         LEFT JOIN variants_all v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = v.product_id
        WHERE ${RANGE} GROUP BY d`,
    )
    .all(from, to) as { d: string; units: number; cost: number }[]) {
    Object.assign(day(r.d), { units: r.units, cost: r.cost });
  }
  // คืนเงิน = เงินที่คืนลูกค้าตอนเปลี่ยน/คืนสินค้า (ตามวันที่ทำรายการ) — ยอดขายของบิลนั้นถูกปรับลดให้แล้ว
  for (const r of db
    .prepare(
      `SELECT date(e.edited_at) AS d, SUM(-e.diff) AS refund FROM order_edits e JOIN orders o ON o.id = e.order_id
        WHERE e.kind = 'edit' AND e.diff < 0 AND date(e.edited_at) BETWEEN ? AND ? GROUP BY d`,
    )
    .all(from, to) as { d: string; refund: number }[]) {
    day(r.d).refund = r.refund;
  }
  // ใบลดหนี้ (รับคืนสินค้า): บิลเดิมไม่เปลี่ยน → หักยอดสุทธิ / VAT / ชิ้น / ต้นทุน ในวันที่ออกใบลดหนี้ และนับเป็น "คืนเงิน"
  for (const r of db
    .prepare(`SELECT date(cn.issued_at) AS d, SUM(cn.total) AS total, SUM(cn.vat) AS vat FROM credit_notes cn WHERE ${CN_RANGE} GROUP BY d`)
    .all(from, to) as { d: string; total: number; vat: number }[]) {
    const x = day(r.d);
    x.refund += r.total;
    x.net -= r.total;
    x.vat -= r.vat;
  }
  for (const r of db
    .prepare(`SELECT date(cn.issued_at) AS d, SUM(ci.qty) AS units, SUM(${CNI_COST}) AS cost ${CNI_FROM} WHERE ${CN_RANGE} GROUP BY d`)
    .all(from, to) as { d: string; units: number; cost: number }[]) {
    const x = day(r.d);
    x.units -= r.units;
    x.cost -= r.cost;
  }

  const rows = new Map<string, SalesRow>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const key = group === 'day' ? d : group === 'week' ? monday(d) : d.slice(0, 7);
    let r = rows.get(key);
    if (!r) {
      rows.set(key, (r = { key, label: '', from: d, to: d, bills: 0, units: 0, gross: 0, discount: 0, refund: 0, net: 0, vat: 0, cost: 0, profit: 0 }));
    }
    r.to = d;
    const x = byDay.get(d);
    if (x) {
      r.bills += x.bills;
      r.units += x.units;
      r.gross += x.gross;
      r.discount += x.discount;
      r.refund += x.refund;
      r.net += x.net;
      r.vat += x.vat;
      r.cost += x.cost;
    }
  }
  const list = [...rows.values()].map((r) => {
    let label: string;
    if (group === 'day') label = `${dayText(r.key)} ${r.key === today ? 'วันนี้' : WD_SHORT[parse(r.key).getDay()]}`;
    else if (group === 'month') label = `${MONTHS[Number(r.key.slice(5, 7)) - 1]} ${r.key.slice(0, 4)}`;
    else {
      const a = parse(r.from);
      const b = parse(r.to);
      label = r.from === r.to ? dayText(r.from)
        : a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
        : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${dayText(r.to)}`;
    }
    const out = { ...r, label };
    for (const k of ['gross', 'discount', 'refund', 'net', 'vat', 'cost'] as const) out[k] = round2(out[k]);
    out.profit = round2(r.net - r.vat - r.cost);
    return out;
  });
  const total = list.reduce(
    (a, r) => {
      for (const k of ['bills', 'units', 'gross', 'discount', 'refund', 'net', 'vat', 'cost', 'profit'] as const) a[k] += r[k];
      return a;
    },
    { bills: 0, units: 0, gross: 0, discount: 0, refund: 0, net: 0, vat: 0, cost: 0, profit: 0 },
  );
  for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] = round2(total[k]);
  return { range: { from, to }, group, rows: list, total };
}

const GROUP_LABEL: Record<Group, string> = { day: 'รายวัน', week: 'รายสัปดาห์', month: 'รายเดือน' };

export function salesReportXlsx(f: SalesQuery, scope: string): Buffer {
  const d = salesReport(f);
  type R = SalesReport['rows'][number];
  const cols: Col<R>[] = [
    { header: d.group === 'day' ? 'วันที่' : d.group === 'week' ? 'สัปดาห์' : 'เดือน', value: (r) => r.label },
    { header: 'จำนวนบิล', value: (r) => r.bills, type: 'int' },
    { header: 'จำนวนชิ้น', value: (r) => r.units, type: 'int' },
    { header: 'ยอดขาย', value: (r) => r.gross, type: 'money' },
    { header: 'ส่วนลด', value: (r) => r.discount, type: 'money' },
    { header: 'คืนเงิน', value: (r) => r.refund, type: 'money' },
    { header: 'ยอดสุทธิ', value: (r) => r.net, type: 'money' },
    { header: 'VAT', value: (r) => r.vat, type: 'money' },
    { header: 'ต้นทุน', value: (r) => r.cost, type: 'money' },
    { header: 'กำไร', value: (r) => r.profit, type: 'money' },
    { header: d.group === 'day' ? 'วันที่ (ตัวเลข)' : 'ตั้งแต่วันที่', value: (r) => r.from, type: 'date' },
    ...(d.group === 'day' ? [] : [{ header: 'ถึงวันที่', value: (r: R) => r.to, type: 'date' as const }]),
  ];
  return buildXlsx([
    {
      name: `ยอดขาย${GROUP_LABEL[d.group]}`,
      intro: [
        `รายงานยอดขาย${GROUP_LABEL[d.group]}`,
        `${dayText(d.range.from)} – ${dayText(d.range.to)} · ${scope}`,
        'ยอดขาย = ก่อนส่วนลดท้ายบิล · ยอดสุทธิ = ยอดที่เก็บจริง (หลังแก้ไขบิล และหักใบลดหนี้ตามวันที่ออกใบลดหนี้ รวม VAT) · คืนเงิน = เงินที่คืนจากการเปลี่ยน/คืนสินค้า และใบลดหนี้ (หักในยอดแล้ว) · กำไร = ยอดสุทธิ − VAT − ต้นทุน · ไม่รวมบิลที่ยกเลิก',
      ],
      cols,
      rows: d.rows,
      totals: { ...d.total, key: '', label: 'รวม', from: '', to: '' } as R,
    },
  ]);
}
type SalesReport = ReturnType<typeof salesReport>;

// =====================================================================
// สินค้า
// =====================================================================
export interface ProductQuery {
  from?: string; to?: string; q?: string; category?: string;
  /** product = รวมต่อสินค้า · sku = แยกตาม SKU */
  mode?: string;
  /** '0' = แสดงสินค้าที่ยังไม่มียอดขายด้วย */
  sold?: string;
  productId?: string;
  sort?: string; dir?: string; page?: string; limit?: string;
}
export interface ProductRow {
  key: string; productId: number | null; code: string; name: string; category: string; categoryId: string | null;
  variantId: number | null; sku: string; barcode: string; attribute: string; skuCount: number;
  units: number; bills: number; sales: number; cost: number; profit: number; avgCost: number | null; avgSell: number | null;
  stock: number | null; price: number | null;
}

interface V {
  variantId: number; productId: number; code: string; name: string; category: string | null; categoryId: string | null; sku: string;
  barcode: string | null; color: string; size: string; extra: string; stock: number; price: number; unitCost: number; live: number;
}
interface S { variantId: number; productName: string; units: number; bills: number; sales: number; exVat: number; cost: number }

const attrText = (v: { color: string; size: string; extra: string }) => [v.color, v.size, v.extra].filter((x) => x && x !== '-').join(', ');

function productRows(f: ProductQuery) {
  const { from, to } = range(f);
  const mode = f.mode === 'sku' ? 'sku' : 'product';
  const soldOnly = f.sold !== '0';
  const vars = db
    .prepare(
      `SELECT v.id AS variantId, p.id AS productId, p.sku AS code, p.name, c.name AS category, p.category_id AS categoryId, v.sku, v.barcode,
              v.color, v.size, v.extra, v.stock, COALESCE(v.price, p.price) AS price, COALESCE(v.cost, p.cost, 0) AS unitCost,
              CASE WHEN p.deleted_at IS NULL AND instr(v.extra, char(1)) = 0 THEN 1 ELSE 0 END AS live
         FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN categories c ON c.id = p.category_id`,
    )
    .all() as unknown as V[];
  const vMap = new Map(vars.map((v) => [v.variantId, v]));
  // ยอดขายต่อ SKU (ยอดตามราคาในบิล = ยังไม่หักส่วนลดท้ายบิล)
  const sold = db
    .prepare(
      `SELECT oi.variant_id AS variantId, MAX(oi.product_name) AS productName, SUM(oi.qty) AS units, COUNT(DISTINCT o.id) AS bills,
              SUM(oi.line_total) AS sales,
              SUM(CASE WHEN o.total > 0 THEN oi.line_total * (o.total - o.vat) / o.total ELSE oi.line_total END) AS exVat,
              SUM(oi.qty * COALESCE(v.cost, p.cost, 0)) AS cost
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         LEFT JOIN variants_all v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = v.product_id
        WHERE o.status != 'void' AND date(o.created_at) BETWEEN ? AND ?
        GROUP BY oi.variant_id`,
    )
    .all(from, to) as unknown as S[];
  // ใบลดหนี้ในช่วงนี้ (ตามวันที่ออก) → หักชิ้น / ยอดขาย / ต้นทุน ของ SKU ที่คืน
  const returned = db
    .prepare(
      `SELECT ci.variant_id AS variantId, MAX(ci.product_name) AS productName, SUM(ci.qty) AS units, SUM(ci.line_total) AS sales,
              SUM(${CNI_EXVAT}) AS exVat, SUM(${CNI_COST}) AS cost
         ${CNI_FROM} WHERE ${CN_RANGE} AND ci.variant_id IS NOT NULL GROUP BY ci.variant_id`,
    )
    .all(from, to) as unknown as S[];
  for (const r of returned) {
    const s = sold.find((x) => x.variantId === r.variantId);
    if (s) {
      s.units -= r.units;
      s.sales -= r.sales;
      s.exVat -= r.exVat;
      s.cost -= r.cost;
    } else sold.push({ ...r, bills: 0, units: -r.units, sales: -r.sales, exVat: -r.exVat, cost: -r.cost });
  }
  const sMap = new Map(sold.map((s) => [s.variantId, s]));

  const q = (f.q ?? '').trim().toLowerCase();
  const pid = Number(f.productId) || 0;
  const keep = (v: V) =>
    (!f.category || v.categoryId === f.category) &&
    (!pid || v.productId === pid) &&
    (!q || [v.code, v.name, v.sku, v.barcode ?? '', attrText(v)].some((x) => x.toLowerCase().includes(q)));
  const ids = new Set<number>();
  for (const s of sold) if (vMap.has(s.variantId)) ids.add(s.variantId);
  if (!soldOnly) for (const v of vars) if (v.live) ids.add(v.variantId);

  const skuRows: ProductRow[] = [];
  for (const id of ids) {
    const v = vMap.get(id)!;
    if (!keep(v)) continue;
    const s = sMap.get(id);
    const units = s?.units ?? 0;
    skuRows.push({
      key: `v${id}`, productId: v.productId, code: v.code, name: v.name, category: v.category ?? 'ไม่ระบุ', categoryId: v.categoryId,
      variantId: id, sku: v.sku, barcode: v.barcode ?? '', attribute: attrText(v), skuCount: 1,
      units, bills: s?.bills ?? 0, sales: s?.sales ?? 0, cost: s?.cost ?? 0, profit: (s?.exVat ?? 0) - (s?.cost ?? 0),
      avgCost: units ? (s!.cost / units) : null, avgSell: units ? s!.sales / units : null,
      stock: v.live ? v.stock : null, price: v.price,
    });
  }
  // SKU ที่ถูกลบไปแล้วแต่มียอดขายในช่วงนี้ (ไม่พบใน variants) — แสดงตามชื่อสินค้าในบิล
  for (const s of sold) {
    if (vMap.has(s.variantId) || pid || f.category) continue;
    if (q && !s.productName.toLowerCase().includes(q)) continue;
    skuRows.push({
      key: `x${s.variantId}`, productId: null, code: '', name: s.productName, category: 'ไม่ระบุ', categoryId: null, variantId: s.variantId,
      sku: '', barcode: '', attribute: '', skuCount: 1, units: s.units, bills: s.bills, sales: s.sales, cost: s.cost, profit: s.exVat - s.cost,
      avgCost: s.units ? s.cost / s.units : null, avgSell: s.units ? s.sales / s.units : null, stock: null, price: null,
    });
  }

  let rows = skuRows;
  if (mode === 'product') {
    const m = new Map<string, ProductRow>();
    for (const r of skuRows) {
      const k = r.productId ? `p${r.productId}` : `n${r.name}`;
      const p = m.get(k);
      if (!p) {
        m.set(k, { ...r, key: k, variantId: null, sku: '', barcode: '', attribute: '' });
        continue;
      }
      p.skuCount++;
      p.units += r.units;
      p.bills += r.bills; // ใช้กับสินค้าที่ถูกลบแล้ว — สินค้าปกตินับบิลใหม่ด้านล่าง (บิลเดียวซื้อหลายสี/ไซซ์ = 1 บิล)
      p.sales += r.sales;
      p.cost += r.cost;
      p.profit += r.profit;
      p.stock = p.stock == null && r.stock == null ? null : (p.stock ?? 0) + (r.stock ?? 0);
      p.price = p.price == null ? r.price : r.price == null ? p.price : Math.min(p.price, r.price);
    }
    // จำนวนบิลที่ถูกต้องต่อสินค้า (บิลเดียวซื้อหลายสี/ไซซ์ = 1 บิล)
    const billRows = db
      .prepare(
        `SELECT v.product_id AS pid, COUNT(DISTINCT o.id) AS bills FROM order_items oi JOIN orders o ON o.id = oi.order_id
           JOIN variants_all v ON v.id = oi.variant_id WHERE o.status != 'void' AND date(o.created_at) BETWEEN ? AND ? GROUP BY v.product_id`,
      )
      .all(from, to) as { pid: number; bills: number }[];
    const bm = new Map(billRows.map((b) => [b.pid, b.bills]));
    rows = [...m.values()].map((p) => ({
      ...p,
      bills: p.productId ? bm.get(p.productId) ?? 0 : p.bills,
      avgCost: p.units ? p.cost / p.units : null,
      avgSell: p.units ? p.sales / p.units : null,
    }));
  }
  for (const r of rows) {
    r.sales = round2(r.sales);
    r.cost = round2(r.cost);
    r.profit = round2(r.profit);
    r.avgCost = r.avgCost == null ? null : round2(r.avgCost);
    r.avgSell = r.avgSell == null ? null : round2(r.avgSell);
  }

  const SORT: Record<string, (r: ProductRow) => number | string> = {
    code: (r) => r.code.toLowerCase(), name: (r) => r.name.toLowerCase(), units: (r) => r.units, sales: (r) => r.sales,
    profit: (r) => r.profit, stock: (r) => r.stock ?? -Infinity, cost: (r) => r.avgCost ?? -Infinity, sell: (r) => r.avgSell ?? -Infinity,
  };
  const key = SORT[f.sort ?? ''] ? f.sort! : 'units';
  const dir = f.dir === 'asc' ? 1 : f.dir === 'desc' ? -1 : key === 'code' || key === 'name' ? 1 : -1;
  const get = SORT[key];
  rows.sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return c * dir || b.sales - a.sales || a.code.localeCompare(b.code) || a.sku.localeCompare(b.sku);
  });
  const total = {
    rows: rows.length,
    units: rows.reduce((a, r) => a + r.units, 0),
    sales: round2(rows.reduce((a, r) => a + r.sales, 0)),
    cost: round2(rows.reduce((a, r) => a + r.cost, 0)),
    profit: round2(rows.reduce((a, r) => a + r.profit, 0)),
    stock: rows.reduce((a, r) => a + (r.stock ?? 0), 0),
  };
  return { range: { from, to }, mode, soldOnly, sort: key, dir: dir === 1 ? 'asc' : 'desc', rows, total };
}

export function productReport(f: ProductQuery) {
  const d = productRows(f);
  const limit = Math.min(500, Math.max(10, Number(f.limit) || 50));
  const pages = Math.max(1, Math.ceil(d.rows.length / limit));
  const page = Math.min(pages, Math.max(1, Number(f.page) || 1));
  return { ...d, page, pages, limit, rows: d.rows.slice((page - 1) * limit, page * limit) };
}

export function productReportXlsx(f: ProductQuery, scope: string): Buffer {
  const bySku = productRows({ ...f, mode: 'sku', productId: undefined });
  const byProduct = productRows({ ...f, mode: 'product', productId: undefined });
  const intro = (title: string) => [
    title,
    `${dayText(bySku.range.from)} – ${dayText(bySku.range.to)} · ${scope}${bySku.soldOnly ? ' · เฉพาะที่ขายได้' : ' · รวมสินค้าที่ยังไม่มียอดขาย'}${f.q ? ` · ค้นหา "${f.q}"` : ''}`,
    'ยอดขายและกำไร ยังไม่หักส่วนลดท้ายบิล · กำไร = ยอดขายไม่รวม VAT − ต้นทุน · คงเหลือ = สต็อกตอนนี้',
  ];
  const skuCols: Col<ProductRow>[] = [
    { header: 'รหัสสินค้า', value: (r) => r.code },
    { header: 'ชื่อสินค้า', value: (r) => r.name },
    { header: 'หมวดหมู่', value: (r) => r.category },
    { header: 'รหัส SKU', value: (r) => r.sku },
    { header: 'คุณสมบัติ', value: (r) => r.attribute },
    { header: 'บาร์โค้ด', value: (r) => r.barcode },
    { header: 'คงเหลือ', value: (r) => r.stock, type: 'int' },
    { header: 'ขายได้ (ชิ้น)', value: (r) => r.units, type: 'int' },
    { header: 'ยอดขาย', value: (r) => r.sales, type: 'money' },
    { header: 'ต้นทุนเฉลี่ย', value: (r) => r.avgCost, type: 'money' },
    { header: 'ราคาขายเฉลี่ย', value: (r) => r.avgSell, type: 'money' },
    { header: 'ต้นทุนรวม', value: (r) => r.cost, type: 'money' },
    { header: 'กำไร', value: (r) => r.profit, type: 'money' },
    { header: 'จำนวนบิล', value: (r) => (r.key ? r.bills : null), type: 'int' },
  ];
  const prodCols: Col<ProductRow>[] = [
    { header: 'รหัสสินค้า', value: (r) => r.code },
    { header: 'ชื่อสินค้า', value: (r) => r.name },
    { header: 'หมวดหมู่', value: (r) => r.category },
    { header: 'จำนวน SKU', value: (r) => r.skuCount, type: 'int' },
    { header: 'คงเหลือ', value: (r) => r.stock, type: 'int' },
    { header: 'ขายได้ (ชิ้น)', value: (r) => r.units, type: 'int' },
    { header: 'ยอดขาย', value: (r) => r.sales, type: 'money' },
    { header: 'ต้นทุนเฉลี่ย', value: (r) => r.avgCost, type: 'money' },
    { header: 'ราคาขายเฉลี่ย', value: (r) => r.avgSell, type: 'money' },
    { header: 'ต้นทุนรวม', value: (r) => r.cost, type: 'money' },
    { header: 'กำไร', value: (r) => r.profit, type: 'money' },
    { header: 'จำนวนบิล', value: (r) => (r.key ? r.bills : null), type: 'int' },
  ];
  const totalsOf = (t: typeof bySku.total, skus: number): ProductRow => ({
    key: '', productId: null, code: 'รวม', name: `${t.rows} รายการ`, category: '', categoryId: null, variantId: null, sku: '', barcode: '',
    attribute: '', skuCount: skus, units: t.units, bills: 0, sales: t.sales, cost: t.cost, profit: t.profit, avgCost: null, avgSell: null,
    stock: t.stock, price: null,
  });
  return buildXlsx([
    { name: 'สินค้าตาม SKU', intro: intro('รายงานสินค้า (แยกตาม SKU)'), cols: skuCols, rows: bySku.rows, totals: totalsOf(bySku.total, bySku.rows.length), freezeCols: 2 },
    { name: 'สรุปตามสินค้า', intro: intro('รายงานสินค้า (รวมต่อสินค้า)'), cols: prodCols, rows: byProduct.rows, totals: totalsOf(byProduct.total, bySku.rows.length), freezeCols: 2 },
  ]);
}

// =====================================================================
// รายบิล
// =====================================================================
export interface BillQuery {
  from?: string; to?: string; q?: string; payment?: string; status?: string;
  sort?: string; dir?: string; page?: string | number; limit?: string | number;
}
export interface BillRow {
  id: number; orderNo: string; createdAt: string; branch: string | null; salesperson: string | null; customer: string | null;
  orderType: string | null; payment: string; paymentLabel: string; lines: number; units: number;
  gross: number; discount: number; fee: number; net: number; vat: number; cost: number; profit: number;
  status: 'paid' | 'edited' | 'void'; editCount: number; voidReason: string | null;
  /** คืนเงินด้วยใบลดหนี้ (หักออกจากยอดสุทธิ / VAT / ชิ้น / ต้นทุนของบิลนี้แล้ว) */
  refund: number;
}

const BILL_SORT: Record<string, string> = {
  time: 'o.id', no: 'o.order_no', staff: "COALESCE(o.salesperson, '')", customer: "COALESCE(o.customer_name, '')",
  payment: 'o.payment_method', units: 'COALESCE(it.units, 0) - COALESCE(ri.units, 0)', gross: 'o.subtotal', discount: 'o.discount',
  net: 'o.total - COALESCE(cr.refund, 0)', vat: 'o.vat - COALESCE(cr.vat, 0)', refund: 'COALESCE(cr.refund, 0)',
  cost: 'COALESCE(it.cost, 0) - COALESCE(ri.cost, 0)',
  profit: "(CASE WHEN o.status = 'void' THEN 0 ELSE (o.total - COALESCE(cr.refund, 0)) - (o.vat - COALESCE(cr.vat, 0)) - (COALESCE(it.cost, 0) - COALESCE(ri.cost, 0)) END)",
  status: 'o.status',
};

function billWhere(f: BillQuery) {
  const { from, to } = range(f);
  const conds = ['date(o.created_at) BETWEEN ? AND ?'];
  const args: (string | number)[] = [from, to];
  const q = (f.q ?? '').trim().slice(0, 60);
  if (q) {
    conds.push("(o.order_no LIKE ? OR COALESCE(o.customer_name, '') LIKE ? OR COALESCE(o.salesperson, '') LIKE ?)");
    const like = `%${q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like);
  }
  if (f.payment && PAYMENT_METHODS.includes(f.payment)) { conds.push('o.payment_method = ?'); args.push(f.payment); }
  if (f.status && ['paid', 'edited', 'void'].includes(f.status)) { conds.push('o.status = ?'); args.push(f.status); }
  return { from, to, where: conds.join(' AND '), args };
}

// จำนวนชิ้น / รายการ / ต้นทุน ต่อบิล
const BILL_FROM = `FROM orders o
  LEFT JOIN branches b ON b.id = o.branch_id
  LEFT JOIN (
    SELECT oi.order_id, COUNT(*) AS lines, SUM(oi.qty) AS units, SUM(oi.qty * COALESCE(v.cost, p.cost, 0)) AS cost
      FROM order_items oi LEFT JOIN variants_all v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = v.product_id
     GROUP BY oi.order_id
  ) it ON it.order_id = o.id
  ${CN_PER_BILL}`;
const BILL_COLS = `o.id, o.order_no AS orderNo, o.created_at AS createdAt, b.name AS branch, o.salesperson, o.customer_name AS customer,
  o.order_type AS orderType, o.payment_method AS payment, COALESCE(it.lines, 0) AS lines, COALESCE(it.units, 0) - COALESCE(ri.units, 0) AS units,
  o.subtotal AS gross, o.discount, COALESCE(o.fee, 0) AS fee, o.total - COALESCE(cr.refund, 0) AS net, o.vat - COALESCE(cr.vat, 0) AS vat,
  COALESCE(it.cost, 0) - COALESCE(ri.cost, 0) AS cost, COALESCE(cr.refund, 0) AS refund,
  o.status, o.edit_count AS editCount, o.void_reason AS voidReason`;

function billRows(f: BillQuery, limit: number, offset: number) {
  const w = billWhere(f);
  const col = BILL_SORT[f.sort ?? ''] ?? 'o.id';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const labels = new Map(getSettings().payments.methods.map((m) => [m.id as string, m.label]));
  const rows = (db
    .prepare(`SELECT ${BILL_COLS} ${BILL_FROM} WHERE ${w.where} ORDER BY ${col} ${dir}, o.id ${dir} LIMIT ? OFFSET ?`)
    .all(...w.args, limit, offset) as Omit<BillRow, 'profit' | 'paymentLabel'>[]).map((r) => ({
    ...r,
    paymentLabel: labels.get(r.payment) ?? r.payment,
    gross: round2(r.gross), discount: round2(r.discount), fee: round2(r.fee), net: round2(r.net), vat: round2(r.vat), cost: round2(r.cost), refund: round2(r.refund),
    // บิลที่ยกเลิก: ไม่มีกำไร (ไม่นับในยอดรวม)
    profit: r.status === 'void' ? 0 : round2(r.net - r.vat - r.cost),
  })) as BillRow[];
  return { w, rows };
}

function billTotals(f: BillQuery) {
  const w = billWhere(f);
  const t = db
    .prepare(
      `SELECT COUNT(*) AS all_, SUM(CASE WHEN o.status = 'void' THEN 1 ELSE 0 END) AS voided,
              SUM(CASE WHEN o.status = 'edited' THEN 1 ELSE 0 END) AS edited,
              ${['units', 'gross', 'discount', 'fee', 'net', 'vat', 'cost', 'refund']
                .map((k) => {
                  const e = k === 'fee' ? 'COALESCE(o.fee, 0)' : k === 'gross' ? 'o.subtotal' : k === 'discount' ? 'o.discount' : BILL_SORT[k];
                  return `COALESCE(SUM(CASE WHEN o.status != 'void' THEN ${e} END), 0) AS ${k}`;
                })
                .join(', ')}
         ${BILL_FROM} WHERE ${w.where}`,
    )
    .get(...w.args) as Record<string, number>;
  const total = {
    rows: t.all_, bills: t.all_ - (t.voided ?? 0), voided: t.voided ?? 0, edited: t.edited ?? 0,
    units: t.units, gross: round2(t.gross), discount: round2(t.discount), fee: round2(t.fee), net: round2(t.net), vat: round2(t.vat), cost: round2(t.cost),
    refund: round2(t.refund),
    profit: round2(t.net - t.vat - t.cost),
  };
  // แยกตามวิธีชำระ (ไม่รวมบิลที่ยกเลิก) — ผลรวม = ยอดสุทธิรวม
  const labels = new Map(getSettings().payments.methods.map((m) => [m.id as string, m.label]));
  const byPayment = (db
    .prepare(`SELECT o.payment_method AS payment, COUNT(*) AS bills, COALESCE(SUM(o.total - COALESCE(cr.refund, 0)), 0) AS net ${BILL_FROM} WHERE ${w.where} AND o.status != 'void' GROUP BY o.payment_method ORDER BY net DESC`)
    .all(...w.args) as { payment: string; bills: number; net: number }[]).map((r) => ({ ...r, label: labels.get(r.payment) ?? r.payment, net: round2(r.net) }));
  return { range: { from: w.from, to: w.to }, total, byPayment };
}

export function billReport(f: BillQuery) {
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const t = billTotals(f);
  const pages = Math.max(1, Math.ceil(t.total.rows / limit));
  const page = Math.min(Math.max(Number(f.page) || 1, 1), pages);
  const { rows } = billRows(f, limit, (page - 1) * limit);
  return { ...t, rows, page, pages, limit };
}

const BILL_STATUS: Record<string, string> = { paid: 'ชำระแล้ว', edited: 'แก้ไขแล้ว', void: 'ยกเลิก' };

export function billReportXlsx(f: BillQuery, scope: string, allBranches: boolean): Buffer {
  const t = billTotals(f);
  const { rows } = billRows(f, 50000, 0);
  const cols: Col<BillRow>[] = [
    { header: 'เลขที่บิล', value: (r) => r.orderNo },
    { header: 'วันที่-เวลา', value: (r) => r.createdAt, type: 'datetime' },
    ...(allBranches ? [{ header: 'สาขา', value: (r: BillRow) => r.branch ?? '' }] : []),
    { header: 'พนักงานขาย', value: (r) => r.salesperson ?? '' },
    { header: 'ลูกค้า', value: (r) => r.customer ?? '' },
    { header: 'ประเภทการขาย', value: (r) => r.orderType ?? '' },
    { header: 'วิธีชำระเงิน', value: (r) => r.paymentLabel },
    { header: 'จำนวนรายการ', value: (r) => r.lines, type: 'int' },
    { header: 'จำนวนชิ้น', value: (r) => r.units, type: 'int' },
    { header: 'ยอดขาย', value: (r) => r.gross, type: 'money' },
    { header: 'ส่วนลด', value: (r) => r.discount, type: 'money' },
    { header: 'ค่าธรรมเนียม', value: (r) => r.fee, type: 'money' },
    { header: 'คืนเงิน (ใบลดหนี้)', value: (r) => r.refund || '', type: 'money' },
    { header: 'ยอดสุทธิ', value: (r) => r.net, type: 'money' },
    { header: 'VAT', value: (r) => r.vat, type: 'money' },
    { header: 'ต้นทุน', value: (r) => r.cost, type: 'money' },
    { header: 'กำไร', value: (r) => r.profit, type: 'money' },
    { header: 'สถานะ', value: (r) => BILL_STATUS[r.status] ?? r.status },
    { header: 'แก้ไข (ครั้ง)', value: (r) => r.editCount || '', type: 'int' },
    { header: 'เหตุผลยกเลิก', value: (r) => r.voidReason ?? '' },
  ];
  const x = t.total;
  const totals = {
    orderNo: `รวม ${x.bills} บิล`, createdAt: '', lines: null, units: x.units, gross: x.gross, discount: x.discount, fee: x.fee,
    net: x.net, vat: x.vat, cost: x.cost, profit: x.profit, refund: x.refund, paymentLabel: '', status: '', editCount: 0,
  } as unknown as BillRow;
  const filters = [
    f.q ? `ค้นหา "${f.q}"` : '',
    f.payment && PAYMENT_METHODS.includes(f.payment) ? `ชำระด้วย ${getSettings().payments.methods.find((m) => m.id === f.payment)?.label ?? f.payment}` : '',
    f.status && BILL_STATUS[f.status] ? `สถานะ ${BILL_STATUS[f.status]}` : '',
  ].filter(Boolean).join(' · ');
  return buildXlsx([
    {
      name: 'ยอดขายรายบิล',
      intro: [
        'รายงานยอดขายรายบิล',
        `${dayText(t.range.from)} – ${dayText(t.range.to)} · ${scope}${filters ? ` · ${filters}` : ''}`,
        `ยอดสุทธิ = ยอดที่เก็บจริง (หลังแก้ไขบิล และหักใบลดหนี้ของบิลนั้นแล้ว รวม VAT) · กำไร = ยอดสุทธิ − VAT − ต้นทุน · บิลที่ยกเลิกแสดงไว้แต่ไม่นับในยอดรวม (ยกเลิก ${x.voided} บิล)`,
      ],
      cols,
      rows,
      totals,
    },
    {
      name: 'แยกตามวิธีชำระ',
      intro: ['ยอดขายรายบิล แยกตามวิธีชำระเงิน', `${dayText(t.range.from)} – ${dayText(t.range.to)} · ${scope} · ไม่รวมบิลที่ยกเลิก`],
      cols: [
        { header: 'วิธีชำระเงิน', value: (r: (typeof t.byPayment)[number]) => r.label },
        { header: 'จำนวนบิล', value: (r: (typeof t.byPayment)[number]) => r.bills, type: 'int' },
        { header: 'ยอดสุทธิ', value: (r: (typeof t.byPayment)[number]) => r.net, type: 'money' },
      ],
      rows: t.byPayment,
      totals: { label: 'รวม', bills: x.bills, net: x.net, payment: '' },
    },
  ]);
}
