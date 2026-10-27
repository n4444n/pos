// รายงานภาษีขาย (สำหรับฝ่ายบัญชี / ยื่น ภ.พ.30)
// 1) สรุปรายวันต่อเครื่อง POS: เลขที่บิลแรก–สุดท้าย · ยอดขาย · ฐานภาษี · VAT · ยอดยกเว้น · บิลยกเลิก · Grand Total สะสม
// 2) รายบิล (รายงานภาษีขาย): ทุกบิลในช่วงวันที่ พร้อมอัตรา VAT ที่ใช้จริงในบิล
// 3) บิลยกเลิก: เหตุผล · ผู้ทำรายการ · ผู้อนุมัติ · เวลา
// ใช้ view "orders" (สาขาที่เลือก หรือทุกสาขา) · บิลยกเลิกไม่นับในยอดขาย แต่แสดงไว้ทุกใบ
import { db } from './db.ts';
import { round2 } from './common.ts';
import { getBranch } from './branches.ts';
import { getSettings } from './settings.ts';
import { taxBranchText, today } from './tax.ts';
import { buildXlsx, type Col } from './xlsx.ts';
import { creditNotesIn, taxInvoicesIn } from './taxDocs.ts';

export interface TaxQuery { from?: string; to?: string; terminal?: string; page?: string | number; limit?: string | number }

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const dayText = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y + 543}`;
};

function range(f: TaxQuery) {
  const t = today();
  let from = isDay(f.from) ? f.from : `${t.slice(0, 8)}01`;
  let to = isDay(f.to) ? f.to : t;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}
/** เงื่อนไขช่วงวันที่ (+ เครื่อง: 'none' = บิลที่ไม่ระบุเครื่อง) */
function where(f: TaxQuery) {
  const r = range(f);
  const sql = ['substr(o.created_at, 1, 10) BETWEEN ? AND ?'];
  const args: (string | number)[] = [r.from, r.to];
  if (f.terminal === 'none') sql.push('o.terminal_id IS NULL');
  else if (Number(f.terminal) > 0) {
    sql.push('o.terminal_id = ?');
    args.push(Number(f.terminal));
  }
  return { sql: sql.join(' AND '), args, range: r };
}

const terminalStmt = db.prepare('SELECT code, rd_no AS rdNo, name FROM pos_terminals WHERE id = ?');
const terminalOf = (id: number | null) => (id ? (terminalStmt.get(id) as { code: string; rdNo: string; name: string } | undefined) ?? null : null);
const branchOf = (id: number) => getBranch(id);

/** ยอดขายสะสม (Grand Total) ของเครื่องก่อนวันที่ระบุ — ไม่รวมบิลยกเลิก · ไม่รีเซ็ต */
const gtBefore = db.prepare(
  `SELECT COALESCE(SUM(total), 0) AS gt FROM orders_all
    WHERE status <> 'void' AND branch_id = ? AND COALESCE(terminal_id, 0) = ? AND substr(created_at, 1, 10) < ?`,
);
const noOf = db.prepare('SELECT order_no AS no FROM orders_all WHERE id = ?');
const seqOf = (no: string) => Number(/(\d+)$/.exec(no)?.[1] ?? NaN);

interface DayRow {
  day: string; branchId: number; terminalId: number; bills: number; voids: number; voidTotal: number;
  total: number; vatBase: number; vat: number; exempt: number; firstId: number; lastId: number;
}

function daily(f: TaxQuery) {
  const w = where(f);
  const rows = db
    .prepare(
      `SELECT substr(o.created_at, 1, 10) AS day, o.branch_id AS branchId, COALESCE(o.terminal_id, 0) AS terminalId,
              COUNT(*) AS bills,
              SUM(CASE WHEN o.status = 'void' THEN 1 ELSE 0 END) AS voids,
              COALESCE(SUM(CASE WHEN o.status = 'void' THEN o.total END), 0) AS voidTotal,
              COALESCE(SUM(CASE WHEN o.status <> 'void' THEN o.total END), 0) AS total,
              COALESCE(SUM(CASE WHEN o.status <> 'void' THEN COALESCE(o.vat_base, o.total - o.vat) END), 0) AS vatBase,
              COALESCE(SUM(CASE WHEN o.status <> 'void' THEN o.vat END), 0) AS vat,
              COALESCE(SUM(CASE WHEN o.status <> 'void' THEN o.exempt_amount END), 0) AS exempt,
              MIN(o.id) AS firstId, MAX(o.id) AS lastId
         FROM orders o WHERE ${w.sql}
        GROUP BY day, o.branch_id, COALESCE(o.terminal_id, 0)
        ORDER BY day, o.branch_id, terminalId`,
    )
    .all(...w.args) as unknown as DayRow[];
  return rows.map((r) => {
    const t = terminalOf(r.terminalId || null);
    const b = branchOf(r.branchId);
    const firstNo = (noOf.get(r.firstId) as { no: string }).no;
    const lastNo = (noOf.get(r.lastId) as { no: string }).no;
    // เลขที่บิลต่อเนื่องหรือไม่ (รูปแบบเดียวกัน · จำนวนบิล = ช่วงเลข)
    const a = seqOf(firstNo);
    const z = seqOf(lastNo);
    const samePrefix = firstNo.replace(/\d+$/, '') === lastNo.replace(/\d+$/, '');
    const continuous = samePrefix && Number.isFinite(a) && Number.isFinite(z) ? z - a + 1 === r.bills : null;
    const gtStart = round2((gtBefore.get(r.branchId, r.terminalId, r.day) as { gt: number }).gt);
    return {
      ...r,
      total: round2(r.total), vatBase: round2(r.vatBase), vat: round2(r.vat), exempt: round2(r.exempt), voidTotal: round2(r.voidTotal),
      branch: b ? b.name : `สาขา #${r.branchId}`, taxBranch: b ? taxBranchText(b.taxBranchNo) : '',
      terminal: t ? t.code : null, rdNo: t?.rdNo ?? '', terminalName: t?.name ?? '',
      firstNo, lastNo, continuous,
      gtStart, gtEnd: round2(gtStart + r.total),
    };
  });
}

interface BillRow {
  id: number; orderNo: string; createdAt: string; branchId: number; terminalId: number | null; customer: string | null;
  status: string; vatRate: number | null; vatBase: number | null; vat: number; exempt: number; total: number; paymentMethod: string;
  voidReason: string | null; voidedAt: string | null; voidedBy: string | null; voidApprover: string | null;
}
const BILL_COLS = `o.id, o.order_no AS orderNo, o.created_at AS createdAt, o.branch_id AS branchId, o.terminal_id AS terminalId,
  o.customer_name AS customer, o.status, o.vat_rate AS vatRate, COALESCE(o.vat_base, o.total - o.vat) AS vatBase, o.vat,
  o.exempt_amount AS exempt, o.total, o.payment_method AS paymentMethod,
  o.void_reason AS voidReason, o.voided_at AS voidedAt, o.voided_by AS voidedBy, o.void_approver AS voidApprover`;
const presentBill = (r: BillRow) => {
  const t = terminalOf(r.terminalId);
  return { ...r, terminal: t?.code ?? null, rdNo: t?.rdNo ?? '', branch: branchOf(r.branchId)?.name ?? '' };
};

function bills(f: TaxQuery, limit: number, offset: number, voidOnly = false) {
  const w = where(f);
  return (
    db
      .prepare(`SELECT ${BILL_COLS} FROM orders o WHERE ${w.sql}${voidOnly ? " AND o.status = 'void'" : ''} ORDER BY o.created_at, o.id LIMIT ? OFFSET ?`)
      .all(...w.args, limit, offset) as unknown as BillRow[]
  ).map(presentBill);
}

function totals(f: TaxQuery) {
  const w = where(f);
  const t = db
    .prepare(
      `SELECT COUNT(*) AS bills,
              SUM(CASE WHEN o.status = 'void' THEN 1 ELSE 0 END) AS voids,
              COALESCE(SUM(CASE WHEN o.status = 'void' THEN o.total END), 0) AS voidTotal,
              COALESCE(SUM(CASE WHEN o.status <> 'void' THEN o.total END), 0) AS total,
              COALESCE(SUM(CASE WHEN o.status <> 'void' THEN COALESCE(o.vat_base, o.total - o.vat) END), 0) AS vatBase,
              COALESCE(SUM(CASE WHEN o.status <> 'void' THEN o.vat END), 0) AS vat,
              COALESCE(SUM(CASE WHEN o.status <> 'void' THEN o.exempt_amount END), 0) AS exempt,
              SUM(CASE WHEN o.status = 'edited' THEN 1 ELSE 0 END) AS edited,
              SUM(CASE WHEN o.terminal_id IS NULL THEN 1 ELSE 0 END) AS noTerminal
         FROM orders o WHERE ${w.sql}`,
    )
    .get(...w.args) as Record<string, number>;
  // แยกตามอัตรา VAT (กรณีช่วงวันที่คร่อมการเปลี่ยนอัตรา)
  const byRate = (
    db
      .prepare(
        `SELECT COALESCE(o.vat_rate, 0) AS rate, COUNT(*) AS bills, COALESCE(SUM(COALESCE(o.vat_base, o.total - o.vat)), 0) AS vatBase,
                COALESCE(SUM(o.vat), 0) AS vat, COALESCE(SUM(o.exempt_amount), 0) AS exempt, COALESCE(SUM(o.total), 0) AS total
           FROM orders o WHERE ${w.sql} AND o.status <> 'void' GROUP BY COALESCE(o.vat_rate, 0) ORDER BY rate DESC`,
      )
      .all(...w.args) as { rate: number; bills: number; vatBase: number; vat: number; exempt: number; total: number }[]
  ).map((x) => ({ ...x, vatBase: round2(x.vatBase), vat: round2(x.vat), exempt: round2(x.exempt), total: round2(x.total) }));
  const r2 = (k: string) => round2(t[k] ?? 0);
  return {
    w,
    total: {
      bills: t.bills ?? 0, voids: t.voids ?? 0, edited: t.edited ?? 0, noTerminal: t.noTerminal ?? 0,
      voidTotal: r2('voidTotal'), total: r2('total'), vatBase: r2('vatBase'), vat: r2('vat'), exempt: r2('exempt'),
    },
    byRate,
  };
}

/** ใบลดหนี้ในช่วง (ตามวันที่ออกใบลดหนี้) → หักภาษีขายของงวดนั้น · แยกตามอัตรา */
function creditSummary(f: TaxQuery, range: { from: string; to: string }) {
  const notes = creditNotesIn({ ...range, terminal: f.terminal });
  const sum = (k: 'total' | 'vatBase' | 'vat' | 'exempt', list = notes) => round2(list.reduce((a, c) => a + c[k], 0));
  const rates = [...new Set(notes.map((c) => c.vatRate))];
  return {
    notes,
    total: { count: notes.length, total: sum('total'), vatBase: sum('vatBase'), vat: sum('vat'), exempt: sum('exempt') },
    byRate: new Map(rates.map((r) => {
      const l = notes.filter((c) => c.vatRate === r);
      return [r, { count: l.length, total: sum('total', l), vatBase: sum('vatBase', l), vat: sum('vat', l), exempt: sum('exempt', l) }];
    })),
  };
}
/** รวมยอดขายกับใบลดหนี้ → ยอดสุทธิของงวด (ใช้ยื่น ภ.พ.30) */
function withCredits(total: { total: number; vatBase: number; vat: number; exempt: number }, byRate: { rate: number; total: number; vatBase: number; vat: number; exempt: number; bills: number }[], cn: ReturnType<typeof creditSummary>) {
  const rates = [...new Set([...byRate.map((x) => x.rate), ...cn.byRate.keys()])].sort((a, b) => b - a);
  const zero = { count: 0, total: 0, vatBase: 0, vat: 0, exempt: 0 };
  return {
    net: {
      total: round2(total.total - cn.total.total), vatBase: round2(total.vatBase - cn.total.vatBase),
      vat: round2(total.vat - cn.total.vat), exempt: round2(total.exempt - cn.total.exempt),
    },
    byRate: rates.map((rate) => {
      const s = byRate.find((x) => x.rate === rate) ?? { rate, bills: 0, total: 0, vatBase: 0, vat: 0, exempt: 0 };
      const c = cn.byRate.get(rate) ?? zero;
      return {
        ...s, cnCount: c.count, cnVatBase: c.vatBase, cnVat: c.vat, cnTotal: c.total,
        netVatBase: round2(s.vatBase - c.vatBase), netVat: round2(s.vat - c.vat), netExempt: round2(s.exempt - c.exempt), netTotal: round2(s.total - c.total),
      };
    }),
  };
}

/** หัวรายงาน: ผู้ประกอบการ / เลขผู้เสียภาษี / สาขา */
function header(scopeBranches: number[]) {
  const s = getSettings();
  const bs = scopeBranches.map((id) => getBranch(id)).filter(Boolean);
  return {
    legalName: s.tax.legalName || s.shop.name,
    taxId: s.shop.taxId,
    branches: bs.map((b) => ({ id: b!.id, name: b!.name, taxBranch: taxBranchText(b!.taxBranchNo), vatRegistered: b!.vatRegistered })),
  };
}

export function taxReport(f: TaxQuery) {
  const limit = Math.min(500, Math.max(1, Number(f.limit) || 100));
  const { w, total, byRate } = totals(f);
  const pages = Math.max(1, Math.ceil(total.bills / limit));
  const page = Math.min(pages, Math.max(1, Number(f.page) || 1));
  const days = daily(f);
  const branchIds = (db.prepare(`SELECT DISTINCT o.branch_id AS b FROM orders o WHERE ${w.sql}`).all(...w.args) as { b: number }[]).map((x) => x.b);
  const terminals = db
    .prepare(
      `SELECT DISTINCT o.terminal_id AS id FROM orders o WHERE ${w.sql} AND o.terminal_id IS NOT NULL`,
    )
    .all(...w.args) as { id: number }[];
  const cn = creditSummary(f, w.range);
  const net = withCredits(total, byRate, cn);
  return {
    range: w.range, header: header(branchIds), total, byRate: net.byRate, net: net.net, days,
    creditNotes: cn.notes, creditTotal: cn.total, taxInvoices: taxInvoicesIn({ ...w.range, terminal: f.terminal }),
    bills: bills(f, limit, (page - 1) * limit), page, pages,
    voids: bills(f, 500, 0, true),
    terminals: terminals.map((x) => ({ id: x.id, ...terminalOf(x.id)! })),
  };
}

const STATUS: Record<string, string> = { paid: 'ปกติ', edited: 'แก้ไขแล้ว', void: 'ยกเลิก' };

export function taxReportXlsx(f: TaxQuery): { file: Buffer; range: { from: string; to: string } } {
  const { w, total, byRate: saleRates } = totals(f);
  const cn = creditSummary(f, w.range);
  const { byRate, net } = withCredits(total, saleRates, cn);
  const invoices = taxInvoicesIn({ ...w.range, terminal: f.terminal });
  const days = daily(f);
  const all = bills(f, 200000, 0);
  const voids = all.filter((b) => b.status === 'void');
  const branchIds = [...new Set(all.map((b) => b.branchId))];
  const h = header(branchIds.length ? branchIds : (db.prepare('SELECT DISTINCT o.branch_id AS b FROM orders o').all() as { b: number }[]).map((x) => x.b));
  const head = [
    `ผู้ประกอบการ: ${h.legalName}${h.taxId ? ` · เลขประจำตัวผู้เสียภาษี ${h.taxId}` : ''}`,
    `${h.branches.map((b) => `${b.name}${b.taxBranch ? ` (${b.taxBranch})` : ''}`).join(', ')} · ช่วงวันที่ ${dayText(w.range.from)} – ${dayText(w.range.to)}`,
  ];
  type D = (typeof days)[number];
  type B = (typeof all)[number];
  const dayCols: Col<D>[] = [
    { header: 'วันที่', value: (r) => r.day, type: 'date' },
    { header: 'สาขา', value: (r) => r.branch },
    { header: 'เครื่อง POS', value: (r) => r.terminal ?? (r.day ? 'ไม่ระบุเครื่อง' : '') },
    { header: 'หมายเลขเครื่อง (สรรพากร)', value: (r) => r.rdNo },
    { header: 'เลขที่บิลแรก', value: (r) => r.firstNo },
    { header: 'เลขที่บิลสุดท้าย', value: (r) => r.lastNo },
    { header: 'จำนวนบิล', value: (r) => r.bills, type: 'int' },
    { header: 'ยอดขาย (รวม VAT)', value: (r) => r.total, type: 'money' },
    { header: 'ฐานภาษี', value: (r) => r.vatBase, type: 'money' },
    { header: 'ภาษีขาย (VAT)', value: (r) => r.vat, type: 'money' },
    { header: 'ยอดยกเว้น VAT', value: (r) => r.exempt, type: 'money' },
    { header: 'บิลยกเลิก (ใบ)', value: (r) => r.voids, type: 'int' },
    { header: 'ยอดบิลยกเลิก', value: (r) => r.voidTotal, type: 'money' },
    { header: 'Grand Total ยกมา', value: (r) => (r.day ? r.gtStart : ''), type: 'money' },
    { header: 'Grand Total สะสม', value: (r) => (r.day ? r.gtEnd : ''), type: 'money' },
    { header: 'เลขที่ต่อเนื่อง', value: (r) => (r.continuous === null ? '' : r.continuous ? 'ต่อเนื่อง' : 'ไม่ต่อเนื่อง — ตรวจสอบ') },
  ];
  const billCols: Col<B>[] = [
    { header: 'วันที่-เวลา', value: (r) => r.createdAt, type: 'datetime' },
    { header: 'เลขที่บิล', value: (r) => r.orderNo },
    { header: 'สาขา', value: (r) => r.branch },
    { header: 'เครื่อง POS', value: (r) => r.terminal ?? '' },
    { header: 'ลูกค้า', value: (r) => r.customer ?? '' },
    { header: 'อัตรา VAT (%)', value: (r) => r.vatRate ?? '', type: 'num' },
    { header: 'ฐานภาษี', value: (r) => r.vatBase, type: 'money' },
    { header: 'VAT', value: (r) => r.vat, type: 'money' },
    { header: 'ยกเว้น VAT', value: (r) => r.exempt, type: 'money' },
    { header: 'รวมทั้งสิ้น', value: (r) => r.total, type: 'money' },
    { header: 'สถานะ', value: (r) => STATUS[r.status] ?? r.status },
  ];
  const voidCols: Col<B>[] = [
    { header: 'เลขที่บิล', value: (r) => r.orderNo },
    { header: 'วันที่ออกบิล', value: (r) => r.createdAt, type: 'datetime' },
    { header: 'เครื่อง POS', value: (r) => r.terminal ?? '' },
    { header: 'ยอดบิล', value: (r) => r.total, type: 'money' },
    { header: 'VAT', value: (r) => r.vat, type: 'money' },
    { header: 'เวลายกเลิก', value: (r) => r.voidedAt ?? '', type: 'datetime' },
    { header: 'เหตุผล', value: (r) => r.voidReason ?? '' },
    { header: 'ผู้ทำรายการ', value: (r) => r.voidedBy ?? '' },
    { header: 'ผู้อนุมัติ', value: (r) => r.voidApprover ?? '' },
  ];
  const sumDays = {
    day: '', branch: '', terminal: null, rdNo: '', firstNo: 'รวม', lastNo: '', bills: total.bills, total: total.total, vatBase: total.vatBase, vat: total.vat,
    exempt: total.exempt, voids: total.voids, voidTotal: total.voidTotal, continuous: null,
  } as unknown as D;
  const file = buildXlsx([
    {
      name: 'สรุปรายวันต่อเครื่อง',
      intro: ['รายงานภาษีขาย — สรุปรายวันต่อเครื่อง POS', ...head, 'ยอดขาย/ฐานภาษี/VAT ไม่รวมบิลยกเลิก · Grand Total = ยอดขายสะสมของเครื่อง (ไม่รีเซ็ต ไม่รวมบิลยกเลิก)'],
      cols: dayCols,
      rows: days,
      totals: sumDays,
    },
    {
      name: 'รายงานภาษีขาย',
      intro: ['รายงานภาษีขาย (รายบิล)', ...head, 'บิลยกเลิกแสดงไว้ทุกใบ แต่ไม่นับในยอดรวม'],
      cols: billCols,
      rows: all,
      freezeCols: 2,
      totals: { createdAt: '', orderNo: `รวม ${total.bills - total.voids} ใบ (ยกเลิก ${total.voids})`, vatBase: total.vatBase, vat: total.vat, exempt: total.exempt, total: total.total, vatRate: null } as unknown as B,
    },
    {
      name: 'สรุปตามอัตรา VAT',
      intro: ['สรุปยอดตามอัตรา VAT (ใช้ประกอบ ภ.พ.30)', ...head],
      cols: [
        { header: 'อัตรา VAT (%)', value: (r: (typeof byRate)[number]) => r.rate, type: 'num' },
        { header: 'จำนวนบิล', value: (r: (typeof byRate)[number]) => r.bills, type: 'int' },
        { header: 'ฐานภาษี', value: (r: (typeof byRate)[number]) => r.vatBase, type: 'money' },
        { header: 'ภาษีขาย', value: (r: (typeof byRate)[number]) => r.vat, type: 'money' },
        { header: 'ยกเว้น VAT', value: (r: (typeof byRate)[number]) => r.exempt, type: 'money' },
        { header: 'ยอดขายรวม', value: (r: (typeof byRate)[number]) => r.total, type: 'money' },
        { header: 'ใบลดหนี้ (ใบ)', value: (r: (typeof byRate)[number]) => r.cnCount, type: 'int' },
        { header: 'ฐานภาษีใบลดหนี้', value: (r: (typeof byRate)[number]) => r.cnVatBase, type: 'money' },
        { header: 'VAT ใบลดหนี้', value: (r: (typeof byRate)[number]) => r.cnVat, type: 'money' },
        { header: 'ฐานภาษีสุทธิ', value: (r: (typeof byRate)[number]) => r.netVatBase, type: 'money' },
        { header: 'ภาษีขายสุทธิ', value: (r: (typeof byRate)[number]) => r.netVat, type: 'money' },
      ],
      rows: byRate,
      totals: {
        rate: null, bills: total.bills - total.voids, vatBase: total.vatBase, vat: total.vat, exempt: total.exempt, total: total.total,
        cnCount: cn.total.count, cnVatBase: cn.total.vatBase, cnVat: cn.total.vat, netVatBase: net.vatBase, netVat: net.vat,
      } as never,
    },
    {
      name: 'ใบลดหนี้',
      intro: ['ใบลดหนี้ (รับคืนสินค้า) — หักภาษีขายในเดือนที่ออกใบลดหนี้', ...head],
      cols: [
        { header: 'เลขที่ใบลดหนี้', value: (r: (typeof cn.notes)[number]) => r.docNo },
        { header: 'วันที่', value: (r: (typeof cn.notes)[number]) => r.issuedAt, type: 'datetime' },
        { header: 'อ้างอิงบิล', value: (r: (typeof cn.notes)[number]) => r.orderNo },
        { header: 'วันที่บิลเดิม', value: (r: (typeof cn.notes)[number]) => r.orderDate, type: 'datetime' },
        { header: 'อัตรา VAT (%)', value: (r: (typeof cn.notes)[number]) => r.vatRate, type: 'num' },
        { header: 'ฐานภาษี', value: (r: (typeof cn.notes)[number]) => r.vatBase, type: 'money' },
        { header: 'VAT', value: (r: (typeof cn.notes)[number]) => r.vat, type: 'money' },
        { header: 'ยกเว้น VAT', value: (r: (typeof cn.notes)[number]) => r.exempt, type: 'money' },
        { header: 'ยอดคืน', value: (r: (typeof cn.notes)[number]) => r.total, type: 'money' },
        { header: 'เหตุผล', value: (r: (typeof cn.notes)[number]) => r.reason },
        { header: 'ผู้ทำรายการ', value: (r: (typeof cn.notes)[number]) => r.issuedBy },
        { header: 'ผู้อนุมัติ', value: (r: (typeof cn.notes)[number]) => r.approver },
      ],
      rows: cn.notes,
      totals: { docNo: `รวม ${cn.total.count} ใบ`, issuedAt: '', orderDate: '', vatRate: null, vatBase: cn.total.vatBase, vat: cn.total.vat, exempt: cn.total.exempt, total: cn.total.total } as never,
    },
    {
      name: 'ใบกำกับภาษีเต็มรูป',
      intro: ['ใบกำกับภาษีเต็มรูปที่ออกให้ลูกค้า (ยอดรวมอยู่ในบิลเดิมแล้ว — ไม่นับซ้ำ)', ...head],
      cols: [
        { header: 'เลขที่', value: (r: Record<string, any>) => r.docNo },
        { header: 'วันที่', value: (r: Record<string, any>) => r.issuedAt, type: 'datetime' },
        { header: 'อ้างอิงบิล', value: (r: Record<string, any>) => r.orderNo },
        { header: 'ผู้ซื้อ', value: (r: Record<string, any>) => r.buyerName },
        { header: 'เลขประจำตัวผู้เสียภาษี', value: (r: Record<string, any>) => r.buyerTaxId },
        { header: 'สาขา', value: (r: Record<string, any>) => r.buyerBranchText },
        { header: 'ฐานภาษี', value: (r: Record<string, any>) => r.vatBase, type: 'money' },
        { header: 'VAT', value: (r: Record<string, any>) => r.vat, type: 'money' },
        { header: 'รวม', value: (r: Record<string, any>) => r.total, type: 'money' },
        { header: 'สถานะ', value: (r: Record<string, any>) => (r.status === 'cancelled' ? `ยกเลิก: ${r.cancelReason ?? ''}` : 'ใช้งาน') },
      ],
      rows: invoices,
    },
    {
      name: 'บิลยกเลิก',
      intro: ['บิลยกเลิก (เก็บไว้ทุกใบ ไม่ถูกลบ)', ...head],
      cols: voidCols,
      rows: voids,
      totals: { orderNo: `รวม ${voids.length} ใบ`, createdAt: '', voidedAt: '', total: total.voidTotal, vat: round2(voids.reduce((a, b) => a + b.vat, 0)) } as unknown as B,
    },
  ]);
  return { file, range: w.range };
}
