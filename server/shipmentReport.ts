// ส่งของจากโรงงาน → รายงานการส่ง: ใบส่งของ (DO) ที่ส่งออกแล้วในช่วงวันที่ — เลขที่ / วันที่ส่ง / ต้นทาง / ปลายทาง / ถุง / รายการ / ชิ้น
// กรองสาขาปลายทาง · ค้นหาเลขที่ / หมายเหตุ / ผู้ส่ง · กดเลขที่เพื่อดูรายการสินค้าทั้งหมดในใบ (ใช้ /api/shipments/:id เดิม)
// ส่งออก Excel: แผ่นที่ 1 = รายการใบส่งของ · แผ่นที่ 2 = สินค้าทุกรายการที่ส่งในช่วงนั้น
import { db } from './db.ts';
import { getBranch } from './branches.ts';
import { variantLabel } from './products.ts';
import { buildXlsx, type Col } from './xlsx.ts';
import './shipments.ts'; // สร้างตาราง shipments ก่อน

export interface ShipReportQuery {
  from?: string; to?: string; dest?: string; q?: string; sort?: string; dir?: string; page?: string | number; limit?: string | number;
}
interface DocRow {
  id: number; docNo: string; shippedAt: string; createdAt: string; destBranchId: number; sourceBranchId: number | null;
  bags: number; note: string | null; shippedBy: string | null; createdBy: string | null; units: number; lines: number;
}
interface ItemRow {
  docNo: string; shippedAt: string; destBranchId: number; sourceBranchId: number | null;
  name: string; sku: string; barcode: string | null; color: string; size: string; extra: string; qty: number;
}

const SORT: Record<string, string> = {
  date: 's.shipped_at', no: 's.doc_no', dest: 's.dest_branch_id', source: 's.source_branch_id', bags: 's.bags', lines: 'lines', units: 'units', by: 's.shipped_by',
};
const UNITS = 'COALESCE((SELECT SUM(qty) FROM shipment_items i WHERE i.shipment_id = s.id), 0)';
const LINES = '(SELECT COUNT(*) FROM shipment_items i WHERE i.shipment_id = s.id)';
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const branchName = (id: number | null) => (id ? getBranch(id)?.name ?? `สาขา #${id}` : null);
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const dayText = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y + 543}`;
};

/** เงื่อนไขร่วม (รายการ / ยอดรวม / Excel) */
function where(f: ShipReportQuery) {
  const t = today();
  let from = isDay(f.from) ? f.from : `${t.slice(0, 8)}01`;
  let to = isDay(f.to) ? f.to : t;
  if (from > to) [from, to] = [to, from];
  const sql: string[] = ["s.status = 'shipped'", 'date(s.shipped_at) BETWEEN ? AND ?'];
  const args: (string | number)[] = [from, to];
  const dest = Number(f.dest);
  if (Number.isInteger(dest) && dest > 0) {
    sql.push('s.dest_branch_id = ?');
    args.push(dest);
  }
  const q = String(f.q ?? '').trim().slice(0, 60);
  if (q) {
    sql.push("(s.doc_no LIKE ? OR IFNULL(s.note, '') LIKE ? OR IFNULL(s.shipped_by, '') LIKE ?)");
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  return { sql: sql.join(' AND '), args, range: { from, to }, dest: dest > 0 ? dest : null, q };
}

const present = (r: DocRow) => ({ ...r, destBranchName: branchName(r.destBranchId), sourceBranchName: branchName(r.sourceBranchId) });

function docRows(f: ShipReportQuery, limit: number, offset: number) {
  const w = where(f);
  const col = SORT[String(f.sort)] ?? SORT.date;
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = db
    .prepare(
      `SELECT s.id, s.doc_no AS docNo, s.shipped_at AS shippedAt, s.created_at AS createdAt, s.dest_branch_id AS destBranchId,
              s.source_branch_id AS sourceBranchId, s.bags, s.note, s.shipped_by AS shippedBy, s.created_by AS createdBy,
              ${UNITS} AS units, ${LINES} AS lines
         FROM shipments s WHERE ${w.sql}
        ORDER BY ${col} ${dir}, s.id ${dir} LIMIT ? OFFSET ?`,
    )
    .all(...w.args, limit, offset) as unknown as DocRow[];
  return { w, rows: rows.map(present) };
}

function totals(f: ShipReportQuery) {
  const w = where(f);
  const t = db
    .prepare(`SELECT COUNT(*) AS docs, COALESCE(SUM(s.bags), 0) AS bags, COALESCE(SUM(${UNITS}), 0) AS units, COALESCE(SUM(${LINES}), 0) AS lines FROM shipments s WHERE ${w.sql}`)
    .get(...w.args) as { docs: number; bags: number; units: number; lines: number };
  const byDest = (
    db
      .prepare(
        `SELECT s.dest_branch_id AS destBranchId, COUNT(*) AS docs, COALESCE(SUM(${UNITS}), 0) AS units, COALESCE(SUM(s.bags), 0) AS bags
           FROM shipments s WHERE ${w.sql} GROUP BY s.dest_branch_id ORDER BY units DESC`,
      )
      .all(...w.args) as { destBranchId: number; docs: number; units: number; bags: number }[]
  ).map((x) => ({ ...x, destBranchName: branchName(x.destBranchId) }));
  return { w, total: t, byDest };
}

/** รายงานการส่ง (แบ่งหน้า) */
export function shipmentReport(f: ShipReportQuery) {
  const limit = Math.min(200, Math.max(1, Number(f.limit) || 50));
  const { w, total, byDest } = totals(f);
  const pages = Math.max(1, Math.ceil(total.docs / limit));
  const page = Math.min(pages, Math.max(1, Number(f.page) || 1));
  const { rows } = docRows(f, limit, (page - 1) * limit);
  return { range: w.range, rows, total, byDest, page, pages };
}

/** Excel: รายการใบส่งของ + สินค้าทุกรายการที่ส่ง */
export function shipmentReportXlsx(f: ShipReportQuery): { file: Buffer; range: { from: string; to: string } } {
  const { w, total } = totals(f);
  const { rows } = docRows(f, 100000, 0);
  const items = db
    .prepare(
      `SELECT s.doc_no AS docNo, s.shipped_at AS shippedAt, s.dest_branch_id AS destBranchId, s.source_branch_id AS sourceBranchId,
              p.name, v.sku, v.barcode, v.color, v.size, v.extra, i.qty
         FROM shipments s
         JOIN shipment_items i ON i.shipment_id = s.id
         JOIN main.variants_all v ON v.id = i.variant_id
         JOIN products p ON p.id = v.product_id
        WHERE ${w.sql}
        ORDER BY s.shipped_at, s.id, p.name, v.color, v.size`,
    )
    .all(...w.args) as unknown as ItemRow[];
  type D = (typeof rows)[number];
  const head = `${dayText(w.range.from)} – ${dayText(w.range.to)}${w.dest ? ` · ปลายทาง ${branchName(w.dest)}` : ' · ทุกสาขาปลายทาง'}${w.q ? ` · ค้นหา "${w.q}"` : ''}`;
  const docCols: Col<D>[] = [
    { header: 'เลขที่ใบส่งของ', value: (r) => r.docNo },
    { header: 'วันที่ส่ง', value: (r) => r.shippedAt, type: 'datetime' },
    { header: 'ต้นทาง', value: (r) => r.sourceBranchName ?? (r.id ? 'โรงงาน (ไม่ตัดสต็อก)' : '') },
    { header: 'ปลายทาง', value: (r) => r.destBranchName ?? '' },
    { header: 'ถุง/กล่อง', value: (r) => r.bags, type: 'int' },
    { header: 'จำนวนรายการ', value: (r) => r.lines, type: 'int' },
    { header: 'จำนวนชิ้น', value: (r) => r.units, type: 'int' },
    { header: 'ผู้ส่ง', value: (r) => r.shippedBy ?? r.createdBy ?? '' },
    { header: 'หมายเหตุ', value: (r) => r.note ?? '' },
  ];
  const itemCols: Col<ItemRow>[] = [
    { header: 'เลขที่ใบส่งของ', value: (r) => r.docNo },
    { header: 'วันที่ส่ง', value: (r) => r.shippedAt, type: 'datetime' },
    { header: 'ปลายทาง', value: (r) => branchName(r.destBranchId) ?? '' },
    { header: 'สินค้า', value: (r) => r.name },
    { header: 'สี / ไซส์', value: (r) => (r.name ? variantLabel(r) : '') },
    { header: 'รหัส SKU', value: (r) => r.sku },
    { header: 'บาร์โค้ด', value: (r) => r.barcode ?? '' },
    { header: 'จำนวน (ชิ้น)', value: (r) => r.qty, type: 'int' },
  ];
  const file = buildXlsx([
    {
      name: 'ใบส่งของ',
      intro: ['รายงานการส่งของจากโรงงาน', head, 'เฉพาะใบที่ส่งออกแล้ว (ไม่รวมฉบับร่าง / ใบที่ยกเลิก)'],
      cols: docCols,
      rows,
      totals: { docNo: `รวม ${total.docs} ใบ`, shippedAt: '', bags: total.bags, lines: total.lines, units: total.units } as unknown as D,
    },
    {
      name: 'รายการสินค้า',
      intro: ['สินค้าทุกรายการที่ส่ง', head],
      cols: itemCols,
      rows: items,
      freezeCols: 1,
      totals: { docNo: `รวม ${items.length} รายการ`, shippedAt: '', qty: total.units, name: '' } as unknown as ItemRow,
    },
  ]);
  return { file, range: w.range };
}
