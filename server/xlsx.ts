// สร้างไฟล์ Excel (.xlsx) โดยไม่ต้องติดตั้งไลบรารีเพิ่ม — .xlsx = zip ของไฟล์ XML
// รองรับหลายชีต · หัวตารางตัวหนา + ตรึงแถวหัว + ตัวกรอง (AutoFilter) · ตัวเลข/เงิน/เปอร์เซ็นต์/วันที่ เป็นค่าจริงที่คำนวณต่อได้
import { crc32, deflateRawSync } from 'node:zlib';

export type ColType = 'text' | 'int' | 'money' | 'pct' | 'date' | 'datetime' | 'num';
export interface Col<T> {
  header: string;
  /** ค่าของคอลัมน์ (ว่าง = null/undefined/'') */
  value: (row: T) => unknown;
  type?: ColType;
  width?: number;
}
/** แถวก่อนตาราง เช่น ชื่อรายงาน ช่วงวันที่ (ตัวหนาเฉพาะแถวแรก) */
export interface SheetSpec<T = any> {
  name: string;
  cols: Col<T>[];
  rows: T[];
  intro?: string[];
  /** ตรึงคอลัมน์ซ้ายสุด n คอลัมน์ (เช่น ชื่อสินค้า) */
  freezeCols?: number;
  /** แถวรวมท้ายตาราง (ตัวหนา · อยู่นอกช่วงตัวกรอง จึงไม่ถูกเรียง/กรองไปด้วย) */
  totals?: T;
}

// ---------- รูปแบบเซลล์ (index ตรงกับ cellXfs ใน styles.xml) ----------
const ST = { text: 0, header: 1, int: 2, money: 3, date: 4, datetime: 5, pct: 6, title: 7, num: 8, note: 9 } as const;
/** รูปแบบตัวหนาสำหรับแถวรวม */
const BOLD: Partial<Record<number, number>> = { [ST.text]: 10, [ST.int]: 11, [ST.money]: 12, [ST.pct]: 13, [ST.num]: 14 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="10"><font><sz val="11"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="14"/><name val="Tahoma"/><family val="2"/></font><font><sz val="10"/><color rgb="FF6B7280"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="11"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="18"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="12"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="11"/><name val="Consolas"/><family val="3"/></font><font><sz val="10"/><color rgb="FF6B7280"/><name val="Tahoma"/><family val="2"/></font></fonts>
<fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5BD8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111827"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFBEB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="5"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="medium"><color rgb="FF111827"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF111827"/></top><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFFDE68A"/></left><right style="thin"><color rgb="FFFDE68A"/></right><top style="thin"><color rgb="FFFDE68A"/></top><bottom style="thin"><color rgb="FFFDE68A"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="36">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="6" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="9" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="3" fontId="7" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="7" borderId="4" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="bottom"/></xf>
<xf numFmtId="0" fontId="9" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const esc = (s: string) =>
  s
    // ตัวอักษรควบคุมที่ XML ไม่รองรับ
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const EPOCH = Date.UTC(1899, 11, 30);
/** 'YYYY-MM-DD' หรือ 'YYYY-MM-DD HH:MM[:SS]' (เวลาท้องถิ่นในฐานข้อมูล) → เลขวันที่ของ Excel */
export function excelDate(v: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(v ?? ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return (t - EPOCH) / 86400000;
}

/** ค่าที่กำหนดรูปแบบเองรายเซลล์ (เช่น ชีตสรุปที่แต่ละแถวเป็นเงิน/จำนวน/เปอร์เซ็นต์ต่างกัน) */
export const typed = (v: unknown, t: ColType) => ({ __xl: true as const, v, t });

function cell(ref: string, v: unknown, type: ColType, bold = false): string {
  if (v && typeof v === 'object' && (v as { __xl?: boolean }).__xl) {
    const o = v as { v: unknown; t: ColType };
    return cell(ref, o.v, o.t, bold);
  }
  const st = (n: number) => (bold ? BOLD[n] ?? n : n);
  const sAttr = (n: number) => (st(n) ? ` s="${st(n)}"` : '');
  if (v === null || v === undefined || v === '') return bold ? `<c r="${ref}"${sAttr(ST.text)}/>` : '';
  if (type === 'date' || type === 'datetime') {
    const n = typeof v === 'number' ? v : excelDate(v);
    if (n !== null) return `<c r="${ref}" s="${type === 'date' ? ST.date : ST.datetime}"><v>${n}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${sAttr(ST.text)}><is><t>${esc(String(v))}</t></is></c>`;
  }
  if (type !== 'text') {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) return `<c r="${ref}"${sAttr(ST[type])}><v>${n}</v></c>`;
  }
  if (typeof v === 'boolean') return `<c r="${ref}" t="inlineStr"${sAttr(ST.text)}><is><t>${v ? 'ใช่' : 'ไม่'}</t></is></c>`;
  const s = String(v);
  return `<c r="${ref}" t="inlineStr"${sAttr(ST.text)}><is><t${/^\s|\s$/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></is></c>`;
}

/** ความกว้างคอลัมน์โดยประมาณจากข้อความ (อักษรไทยมีสระลอย/วรรณยุกต์ที่ไม่กินที่) */
const textWidth = (s: string) => s.replace(/[ัิ-ฺ็-๎]/g, '').length;

function sheetXml(spec: SheetSpec): string {
  const intro = spec.intro ?? [];
  const head = intro.length ? intro.length + 1 : 0; // เว้น 1 แถวหลังส่วนหัว
  const headerRow = head + 1;
  const rows: string[] = [];
  intro.forEach((t, i) => rows.push(`<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr" s="${i === 0 ? ST.title : ST.note}"><is><t>${esc(t)}</t></is></c></row>`));
  rows.push(
    `<row r="${headerRow}">${spec.cols.map((c, i) => `<c r="${colName(i)}${headerRow}" t="inlineStr" s="${ST.header}"><is><t>${esc(c.header)}</t></is></c>`).join('')}</row>`,
  );
  const widths = spec.cols.map((c) => Math.max(8, Math.min(48, textWidth(c.header) + 2)));
  spec.rows.forEach((r, i) => {
    const n = headerRow + 1 + i;
    const cells = spec.cols.map((c, j) => {
      const raw = c.value(r);
      const isTyped = !!raw && typeof raw === 'object' && (raw as { __xl?: boolean }).__xl;
      const v = isTyped ? (raw as { v: unknown }).v : raw;
      if (!c.width && v != null) {
        const t = isTyped ? (raw as { t: ColType }).t : c.type ?? 'text';
        const len = t === 'datetime' ? 16 : t === 'date' ? 11 : t === 'text' ? textWidth(String(v)) : String(typeof v === 'number' ? Math.round(v) : v).length + 4;
        if (len + 2 > widths[j]) widths[j] = Math.min(48, len + 2);
      }
      return cell(`${colName(j)}${n}`, raw, c.type ?? 'text');
    });
    rows.push(`<row r="${n}">${cells.join('')}</row>`);
  });
  const lastCol = colName(Math.max(0, spec.cols.length - 1));
  const lastRow = headerRow + spec.rows.length;
  if (spec.totals !== undefined) {
    const n = lastRow + 1;
    rows.push(`<row r="${n}">${spec.cols.map((c, j) => cell(`${colName(j)}${n}`, c.value(spec.totals), c.type ?? 'text', true)).join('')}</row>`);
  }
  const fc = spec.freezeCols ?? 0;
  const topLeft = `${colName(fc)}${headerRow + 1}`;
  const pane = fc
    ? `<pane xSplit="${fc}" ySplit="${headerRow}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>`
    : `<pane ySplit="${headerRow}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastCol}${lastRow + (spec.totals !== undefined ? 1 : 0)}"/>
<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${(spec.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? widths[i]}" customWidth="1"/>`)).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${spec.cols.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastRow}"/>` : ''}
</worksheet>`;
}

// ---------- ชีตแบบจัดหน้าเอง (เช่น ใบส่งของ — หน้าตาเหมือนใบพิมพ์ A4) ----------
/** รูปแบบเซลล์สำหรับชีตจัดหน้า (index ใน cellXfs) */
export const LS = {
  plain: 0, badge: 15, h1: 16, muted: 17, right: 18, mono: 19, rule: 20, infoL: 21, infoR: 22, th: 23, thL: 24,
  td: 25, tdL: 26, tdN: 27, qty: 28, tfLabel: 29, tfEmpty: 30, tfQty: 28, note: 31, sign: 32, signDate: 33, tdB: 34, mutedR: 35,
} as const;
/** ข้อความหลายรูปแบบในเซลล์เดียว (เช่น "ต้นทาง:" สีเทา + ชื่อสาขาตัวหนา) */
export interface Run { t: string; b?: boolean; color?: string; sz?: number; mono?: boolean }
export interface LCell { v?: string | number; rich?: Run[]; s?: number }
export interface LayoutSheet {
  layout: true;
  name: string;
  /** ความกว้างคอลัมน์ (หน่วยตัวอักษร) */
  widths: number[];
  /** แถว: index คอลัมน์ → เซลล์ (null = ว่าง) */
  rows: { height?: number; cells: (LCell | null | undefined)[] }[];
  /** ช่วงที่รวมเซลล์ เช่น 'A1:D1' */
  merges: string[];
  /** แถวที่พิมพ์ซ้ำทุกหน้า (หัวตาราง) เช่น [12, 12] */
  printTitleRows?: [number, number];
  landscape?: boolean;
}
const runXml = (r: Run) =>
  `<r><rPr>${r.b ? '<b/>' : ''}<sz val="${r.sz ?? 11}"/>${r.color ? `<color rgb="FF${r.color.replace('#', '')}"/>` : ''}<rFont val="${r.mono ? 'Consolas' : 'Tahoma'}"/></rPr><t xml:space="preserve">${esc(r.t)}</t></r>`;
function layoutXml(sh: LayoutSheet): string {
  const rows = sh.rows.map((r, i) => {
    const n = i + 1;
    const cells = r.cells
      .map((c, j) => {
        if (!c) return '';
        const ref = `${colName(j)}${n}`;
        const st = c.s ? ` s="${c.s}"` : '';
        if (c.rich) return `<c r="${ref}" t="inlineStr"${st}><is>${c.rich.map(runXml).join('')}</is></c>`;
        if (typeof c.v === 'number') return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
        if (c.v === undefined || c.v === '') return `<c r="${ref}"${st}/>`;
        return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(String(c.v))}</t></is></c>`;
      })
      .join('');
    return `<row r="${n}"${r.height ? ` ht="${r.height}" customHeight="1"` : ''}>${cells}</row>`;
  });
  const last = colName(sh.widths.length - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${last}${sh.rows.length}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.5" right="0.5" top="0.55" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>&amp;C&amp;9หน้า &amp;P / &amp;N</oddFooter></headerFooter>
</worksheet>`;
}

/** ชื่อชีต: ≤ 31 ตัวอักษร ห้าม : \ / ? * [ ] และห้ามซ้ำ */
function sheetNames(list: { name: string }[]): string[] {
  const used = new Set<string>();
  return list.map((s, i) => {
    let base = s.name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// ---------- zip ----------
function zip(files: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // วันที่ในไฟล์ zip (รูปแบบ DOS)
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = deflateRawSync(f.data, { level: 6 });
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // ชื่อไฟล์เป็น UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

/** สร้างไฟล์ .xlsx จากรายการชีต (ชีตแรก = sheet1.xml — ตัวนำเข้าสินค้าอ่านชีตนี้) */
export function buildXlsx(sheets: (SheetSpec | LayoutSheet)[]): Buffer {
  const names = sheetNames(sheets);
  const files: { name: string; data: Buffer }[] = [];
  const add = (name: string, s: string) => files.push({ name, data: Buffer.from(s, 'utf8') });
  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  );
  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  add(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Clothing POS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
  );
  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets
      .map((s, i) => {
        if ('layout' in s) {
          const pt = s.printTitleRows;
          return pt ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(names[i].replace(/'/g, "''"))}'!$${pt[0]}:$${pt[1]}</definedName>` : '';
        }
        if (!s.cols.length) return '';
        const hr = (s.intro?.length ? s.intro.length + 1 : 0) + 1;
        return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!$A$${hr}:$${colName(s.cols.length - 1)}$${hr + s.rows.length}</definedName>`;
      })
      .join('')}</definedNames></workbook>`,
  );
  add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  add('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, 'layout' in s ? layoutXml(s) : sheetXml(s)));
  return zip(files);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
