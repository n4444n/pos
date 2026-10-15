// ส่งออกใบส่งของเป็น Excel — หน้าตาเดียวกับ "พิมพ์ใบส่งของ (A4)" (src/print.ts → printShipment)
// หัวเอกสาร · กล่องข้อมูลต้นทาง/ปลายทาง · หมายเหตุ · ตารางสินค้า (ลำดับ / รายการ / สี / ไซส์ / ส่งออก / หน้าร้านนับได้ / ผลตรวจ) · ช่องเซ็นชื่อ
// ตั้งหน้ากระดาษ A4 แนวตั้ง พอดีความกว้าง 1 หน้า · หัวตารางพิมพ์ซ้ำทุกหน้า
import { shipmentDetail } from './shipments.ts';
import { getSettings } from './settings.ts';
import { buildXlsx, LS, type LayoutSheet, type LCell } from './xlsx.ts';

const GREY = '6B7280';

export function shipmentXlsx(id: number): { file: Buffer; docNo: string } {
  const d = shipmentDetail(id);
  const s = d.shipment;
  const shop = getSettings().shop.name || 'โรงงานตัดเย็บเสื้อผ้าสำเร็จรูป';
  const units = d.items.reduce((a, i) => a + i.qty, 0);
  const statusText = s.status === 'shipped' ? 'ส่งออกจากโรงงานแล้ว' : s.status === 'cancelled' ? 'ยกเลิกแล้ว' : s.heldAt ? 'พักไว้ (ยังไม่ส่ง)' : 'กำลังจัดเตรียม (ยังไม่ส่ง)';
  const statusColor = s.status === 'shipped' ? '14935F' : s.status === 'cancelled' ? 'DC2626' : 'B26A00';
  const date = (s.shippedAt ?? s.createdAt) || '';
  const colorOf = (i: { color: string; extra: string }) => [i.color, i.extra].filter((x) => x && x !== '-').join(' · ') || '-';

  // คอลัมน์: A ลำดับ · B รายการสินค้า · C สี · D ไซส์ · E ส่งออก · F หน้าร้านนับได้ · G ผลตรวจ
  const widths = [7, 46, 14, 8, 11, 13, 9];
  const rows: LayoutSheet['rows'] = [];
  const merges: string[] = [];
  const add = (cells: (LCell | null)[], height?: number) => {
    rows.push({ cells, height });
    return rows.length;
  };
  const merge = (a: string, b: string, r: number) => merges.push(`${a}${r}:${b}${r}`);
  const fill = (n: number, st: number) => Array.from({ length: n }, () => ({ s: st }));

  // ---- หัวเอกสาร ----
  let r = add([{ v: ' ใบส่งสินค้า / ใบกำกับตรวจนับ (GARMENT DELIVERY MANIFEST)', s: LS.badge }, { s: LS.badge }, { v: s.docNo, s: LS.mono }], 20);
  merge('A', 'B', r);
  merge('C', 'G', r);
  r = add([{ v: shop, s: LS.h1 }, null, { rich: [{ t: 'เลขที่เอกสาร: ', color: '4B5563', sz: 10 }, { t: s.docNo, b: true, mono: true }], s: LS.right }], 32);
  merge('A', 'B', r);
  merge('C', 'G', r);
  r = add([{ v: 'ระบบจัดการจัดส่งและตรวจนับสต็อกแบบบาร์โค้ดดิจิทัล', s: LS.muted }, null, { v: `ส่งออกจากระบบ ${stamp()}`, s: LS.mutedR }]);
  merge('A', 'B', r);
  merge('C', 'G', r);
  add(fill(7, LS.rule), 6); // เส้นหนาใต้หัวเอกสาร
  add([], 10);

  // ---- กล่องข้อมูล ----
  const lab = (t: string) => ({ t, color: GREY });
  const info: [LCell, LCell][] = [
    [
      { rich: [lab(' 🏭 ต้นทาง: '), { t: s.sourceBranchName ? `${s.sourceBranchName} (ตัดสต็อก)` : 'โรงงาน (ไม่ตัดสต็อกสาขา)', b: true }], s: LS.infoL },
      { rich: [lab('วันที่ส่งของ: '), { t: date, mono: true }, { t: ' ' }], s: LS.infoR },
    ],
    [
      { rich: [lab(' 🏬 ปลายทาง: '), { t: s.destBranchName ?? '-', b: true, sz: 12 }], s: LS.infoL },
      { rich: [lab('จำนวนบรรจุภัณฑ์: '), { t: `${s.bags} ถุง/กล่อง`, b: true }, { t: ' ' }], s: LS.infoR },
    ],
    [
      { rich: [lab(' ผู้จัดส่ง / สแกนออก: '), { t: s.shippedBy ?? s.createdBy ?? '-' }], s: LS.infoL },
      { rich: [lab('สถานะเอกสาร: '), { t: statusText, b: true, color: statusColor }, { t: ' ' }], s: LS.infoR },
    ],
  ];
  for (const [l, rr] of info) {
    r = add([l, { s: LS.infoL }, { s: LS.infoL }, rr, { s: LS.infoR }, { s: LS.infoR }, { s: LS.infoR }], 24);
    merge('A', 'C', r);
    merge('D', 'G', r);
  }
  add([], 10);

  if (s.note) {
    r = add([{ rich: [{ t: ' หมายเหตุจากโรงงาน: ', b: true, color: '92400E' }, { t: s.note, color: '92400E' }], s: LS.note }, ...fill(6, LS.note)], 26);
    merge('A', 'G', r);
    add([], 10);
  }

  // ---- ตารางสินค้า ----
  const head = add(
    [
      { v: 'ลำดับ', s: LS.th },
      { v: 'รายการสินค้า / บาร์โค้ด', s: LS.thL },
      { v: 'สี', s: LS.th },
      { v: 'ไซส์', s: LS.th },
      { v: 'ส่งออก (ตัว)', s: LS.th },
      { v: 'หน้าร้าน\nนับได้', s: LS.th },
      { v: 'ผลตรวจ', s: LS.th },
    ],
    34,
  );
  d.items.forEach((i, n) => {
    const code = `${i.barcode && i.barcode !== i.sku ? `CODE : ${i.barcode}  |  ` : ''}SKU : ${i.sku}`;
    add(
      [
        { v: n + 1, s: LS.tdN },
        { rich: [{ t: i.name, b: true }, { t: `\n${code}`, mono: true, sz: 9, color: '475569' }], s: LS.tdL },
        { v: colorOf(i), s: LS.td },
        { v: i.size && i.size !== '-' ? i.size : '-', s: LS.tdB },
        { v: i.qty, s: LS.qty },
        { v: '', s: LS.td },
        { v: '☐', s: LS.td },
      ],
      34,
    );
  });
  r = add([{ v: `รวมทั้งหมด ${d.items.length} รายการ`, s: LS.tfLabel }, ...fill(3, LS.tfLabel), { v: units, s: LS.tfQty }, { s: LS.tfEmpty }, { s: LS.tfEmpty }], 26);
  merge('A', 'D', r);

  // ---- ช่องเซ็นชื่อ ----
  add([], 30);
  add([], 30);
  const signs: [string, string, string][] = [
    ['A', 'B', 'ผู้จัดของ / สแกนออก (โรงงาน)'],
    ['C', 'E', 'ผู้ขนส่ง'],
    ['F', 'G', `ผู้ตรวจรับ (${s.destBranchName ?? 'สาขา'})`],
  ];
  const idx = (c: string) => c.charCodeAt(0) - 65;
  // แบบฟอร์มไทย: ลงชื่อ ......... / (ตำแหน่ง) / วันที่
  const lines: (LCell | null)[][] = [[], [], []];
  for (const [a] of signs) {
    lines[0][idx(a)] = { v: 'ลงชื่อ ..............................', s: LS.sign };
    lines[2][idx(a)] = { v: 'วันที่ ____/____/______', s: LS.signDate };
  }
  signs.forEach(([a, , t]) => (lines[1][idx(a)] = { v: `( ${t} )`, s: LS.signDate }));
  const at = [add(lines[0], 24), add(lines[1], 18), add(lines[2], 18)];
  for (const [a, b] of signs) for (const row of at) merge(a, b, row);

  const sheet: LayoutSheet = { layout: true, name: s.docNo, widths, rows, merges, printTitleRows: [head, head] };
  return { file: buildXlsx([sheet]), docNo: s.docNo };
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
