// ภาษีมูลค่าเพิ่มตามข้อกำหนดกรมสรรพากร
// - ตารางอัตรา VAT (มีวันเริ่ม/สิ้นสุด) — ไม่มีอัตราตายตัวในโค้ด · บิลแต่ละใบเก็บอัตราที่ใช้จริงไว้ (orders.vat_rate)
// - เครื่อง POS (หมายเลขเครื่องต่อเครื่อง) — บิลเก็บ terminal_id · เลขที่บิลรันต่อเครื่อง
// - สินค้าแต่ละรายการ: เสีย VAT / ยกเว้น VAT (products.vat_exempt · snapshot ใน order_items.vat_exempt)
// - สาขาตามทะเบียนภาษี (สำนักงานใหญ่ / สาขาที่ xxxxx) + จด VAT รายสาขา
import { currentBranch, db, mainBranchId } from './db.ts';
import { HttpError, round2, setVatRateProvider } from './common.ts';
import { currentBranchInfo, getBranch, listBranches } from './branches.ts';
import { getSettings, saveSection } from './settings.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS vat_rates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rate       REAL NOT NULL CHECK (rate >= 0 AND rate <= 30),   -- เปอร์เซ็นต์ เช่น 7
    start_date TEXT NOT NULL,                                     -- YYYY-MM-DD (มีผลตั้งแต่วันนี้)
    end_date   TEXT,                                              -- YYYY-MM-DD (ถึงวันนี้) · NULL = ไม่มีกำหนดสิ้นสุด
    note       TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS pos_terminals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id  INTEGER NOT NULL REFERENCES branches(id),
    code       TEXT NOT NULL,                  -- รหัสเครื่องในระบบ เช่น POS01 (ใช้ในเลขที่บิล)
    rd_no      TEXT NOT NULL DEFAULT '',       -- หมายเลขเครื่องที่ได้รับอนุมัติจากกรมสรรพากร
    name       TEXT NOT NULL DEFAULT '',       -- ชื่อเรียก เช่น แคชเชียร์หน้าร้าน
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_code ON pos_terminals(branch_id, code);
`);

const pad = (n: number) => String(n).padStart(2, '0');
/** วันที่วันนี้ตามเวลาเครื่อง (YYYY-MM-DD) */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ---------- ย้ายอัตราเดิมเข้าตาราง (ครั้งแรก) ----------
// ใช้ค่าที่ร้านเคยบันทึกไว้ในตั้งค่า หรือคำนวณย้อนจากบิลล่าสุดที่มี VAT — ไม่ใช้ค่าตายตัว
{
  const has = (db.prepare('SELECT COUNT(*) AS n FROM vat_rates').get() as { n: number }).n > 0;
  if (!has) {
    let rate: number | null = null;
    let note = '';
    const row = db.prepare("SELECT value FROM settings WHERE section = 'payments'").get() as { value: string } | undefined;
    try {
      const r = Number(JSON.parse(row?.value ?? '{}')?.vat?.rate);
      if (Number.isFinite(r) && r > 0 && r <= 30) {
        rate = r;
        note = 'ย้ายจากตั้งค่าเดิม (วิธีชำระเงิน)';
      }
    } catch {
      /* ข้าม */
    }
    if (rate === null) {
      const o = db.prepare('SELECT vat, total FROM orders_all WHERE vat > 0 AND total > vat ORDER BY id DESC LIMIT 1').get() as { vat: number; total: number } | undefined;
      if (o) {
        rate = Math.round((o.vat * 100 * 100) / (o.total - o.vat)) / 100;
        rate = Math.round(rate * 4) / 4; // ปัดเศษจากการปัดยอด VAT (เช่น 6.99 → 7)
        note = 'คำนวณจากบิลเดิมในระบบ';
      }
    }
    if (rate !== null) {
      const first = db.prepare('SELECT substr(MIN(created_at), 1, 10) AS d FROM orders_all').get() as { d: string | null };
      db.prepare('INSERT INTO vat_rates (rate, start_date, note, created_by) VALUES (?, ?, ?, ?)').run(rate, first.d || today(), note, 'ระบบ');
      console.log(`[tax] ตั้งอัตรา VAT เริ่มต้น ${rate}% (${note})`);
    }
  }
}

const q = {
  rateOn: db.prepare(
    `SELECT rate FROM vat_rates WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC, id DESC LIMIT 1`,
  ),
  rates: db.prepare(
    `SELECT id, rate, start_date AS startDate, end_date AS endDate, note, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt,
            (SELECT COUNT(*) FROM orders_all o WHERE substr(o.created_at, 1, 10) BETWEEN r.start_date AND COALESCE(r.end_date, '9999-12-31')) AS bills
       FROM vat_rates r ORDER BY start_date DESC, id DESC`,
  ),
  rate: db.prepare('SELECT id, rate, start_date AS startDate, end_date AS endDate, note FROM vat_rates WHERE id = ?'),
  terminals: db.prepare(
    `SELECT t.id, t.branch_id AS branchId, t.code, t.rd_no AS rdNo, t.name, t.active, t.created_at AS createdAt,
            (SELECT COUNT(*) FROM orders_all o WHERE o.terminal_id = t.id) AS bills,
            (SELECT MAX(o.created_at) FROM orders_all o WHERE o.terminal_id = t.id) AS lastBillAt
       FROM pos_terminals t ORDER BY t.branch_id, t.code`,
  ),
  terminal: db.prepare('SELECT id, branch_id AS branchId, code, rd_no AS rdNo, name, active FROM pos_terminals WHERE id = ?'),
};

/** อัตรา VAT (%) ที่มีผลในวันที่ระบุ · null = ไม่มีอัตราครอบคลุม */
export function rateOn(date: string): number | null {
  const r = q.rateOn.get(date, date) as { rate: number } | undefined;
  return r ? r.rate : null;
}
setVatRateProvider(() => rateOn(today()));

// ---------- คำนวณภาษีของบิล ----------
export interface TaxLine { lineTotal: number; exempt: boolean }
export interface BillTax {
  /** อัตรา % ที่ใช้ (0 = ไม่คิด VAT) */
  vatRate: number;
  vat: number;
  /** ฐานภาษี = มูลค่าสินค้า/บริการที่เสีย VAT ก่อนรวม VAT */
  vatBase: number;
  /** มูลค่าสินค้ายกเว้น VAT (หลังหักส่วนลดตามสัดส่วน) */
  exempt: number;
}
/**
 * ราคาสินค้ารวม VAT แล้ว · ส่วนลดท้ายบิลเฉลี่ยตามสัดส่วนมูลค่า (เสีย VAT / ยกเว้น)
 * ค่าธรรมเนียมที่ลูกค้าจ่าย (รวมใน total) นับเป็นส่วนที่เสีย VAT
 */
export function billTax(lines: TaxLine[], subtotal: number, discount: number, total: number, ratePct: number): BillTax {
  const exemptGross = round2(lines.filter((l) => l.exempt).reduce((s, l) => s + l.lineTotal, 0));
  const exemptDisc = subtotal > 0 ? round2((discount * exemptGross) / subtotal) : 0;
  const exempt = Math.max(0, round2(exemptGross - exemptDisc));
  const vatable = Math.max(0, round2(total - exempt));
  const r = ratePct > 0 ? ratePct / 100 : 0;
  const vat = r ? round2((vatable * r) / (1 + r)) : 0;
  return { vatRate: r ? ratePct : 0, vat, vatBase: round2(vatable - vat), exempt };
}

/**
 * ภาษีของบิลขายใหม่ในสาขาปัจจุบัน (อัตรา ณ วันนี้)
 * ระบบภาษีเป็นของ "ตั้งเพิ่มถ้าต้องการ" — ไม่บังคับตั้งค่าก่อนขาย
 * สาขาไม่ได้จด VAT หรือยังไม่มีอัตราที่มีผลวันนี้ → ออกบิลได้ตามปกติ โดยไม่คิด VAT
 */
export function saleTax(lines: TaxLine[], subtotal: number, discount: number, total: number): BillTax {
  const b = currentBranchInfo();
  if (!b.vatRegistered) return billTax(lines, subtotal, discount, total, 0);
  return billTax(lines, subtotal, discount, total, rateOn(today()) ?? 0);
}

/** สินค้า (variant) ไหนยกเว้น VAT */
const exemptStmt = db.prepare('SELECT p.vat_exempt AS e FROM variants_all v JOIN products p ON p.id = v.product_id WHERE v.id = ?');
export const isExempt = (variantId: number) => ((exemptStmt.get(variantId) as { e: number } | undefined)?.e ?? 0) === 1;

// ---------- เครื่อง POS ----------
export interface Terminal { id: number; branchId: number; code: string; rdNo: string; name: string; active: boolean }
const toTerminal = (r: Record<string, any>): Terminal => ({ id: r.id, branchId: r.branchId, code: r.code, rdNo: r.rdNo, name: r.name, active: !!r.active });
export function getTerminal(id: number): Terminal | null {
  const r = q.terminal.get(id) as Record<string, any> | undefined;
  return r ? toTerminal(r) : null;
}
/**
 * เครื่อง POS ของ request (header X-POS-Terminal ที่แต่ละเครื่องเลือกไว้ในตั้งค่า → ภาษี → เครื่องนี้)
 * ไม่บังคับ — เครื่องที่ยังไม่ได้เลือก ขายได้ตามปกติ บิลแค่ไม่ระบุเครื่อง
 */
export function terminalFor(header: unknown): Terminal | null {
  const branch = currentBranch() || mainBranchId();
  const id = Number(header);
  const t = Number.isInteger(id) && id > 0 ? getTerminal(id) : null;
  return t && t.active && t.branchId === branch ? t : null;
}

// ---------- หน้าตั้งค่าภาษี (ผู้จัดการ) ----------
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** ตรวจเลขประจำตัวผู้เสียภาษี 13 หลัก (หลักสุดท้ายเป็นเลขตรวจสอบ) */
export function validTaxId(id: string) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

export function taxAdmin() {
  const s = getSettings();
  const t = today();
  return {
    company: { legalName: s.tax.legalName, taxId: s.shop.taxId, shopName: s.shop.name, lockEdit: s.tax.lockEdit, taxIdValid: !s.shop.taxId || validTaxId(s.shop.taxId) },
    branches: listBranches().map((b) => ({ id: b.id, name: b.name, code: b.code, isMain: b.isMain, vatRegistered: b.vatRegistered, taxBranchNo: b.taxBranchNo })),
    rates: (q.rates.all() as Record<string, any>[]).map((r) => ({ ...r, current: r.startDate <= t && (!r.endDate || r.endDate >= t) })),
    rateToday: rateOn(t),
    today: t,
    terminals: (q.terminals.all() as Record<string, any>[]).map((r) => ({ ...toTerminal(r), bills: r.bills, lastBillAt: r.lastBillAt, createdAt: r.createdAt })),
  };
}

export function saveTaxCompany(body: { legalName?: unknown; taxId?: unknown; lockEdit?: unknown }) {
  const s = getSettings();
  const taxId = body.taxId === undefined ? s.shop.taxId : str(body.taxId, 20).replace(/[^0-9]/g, '');
  if (taxId && !validTaxId(taxId)) throw new HttpError(422, 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (ต้องเป็นตัวเลข 13 หลัก และเลขตรวจสอบหลักสุดท้ายต้องถูกต้อง)');
  saveSection('tax', {
    legalName: body.legalName === undefined ? s.tax.legalName : str(body.legalName, 160),
    lockEdit: typeof body.lockEdit === 'boolean' ? body.lockEdit : s.tax.lockEdit,
  });
  if (taxId !== s.shop.taxId) saveSection('shop', { ...getSettings().shop, taxId });
  return taxAdmin();
}

/** จด VAT / สำนักงานใหญ่-สาขาที่ ของแต่ละสาขา */
export function saveBranchTax(id: number, body: { vatRegistered?: unknown; taxBranchNo?: unknown }) {
  const b = getBranch(id);
  if (!b) throw new HttpError(404, 'ไม่พบสาขา');
  const no = body.taxBranchNo === undefined ? b.taxBranchNo : str(body.taxBranchNo, 5).replace(/[^0-9]/g, '');
  if (no && no.length !== 5) throw new HttpError(422, 'เลขสาขาตามทะเบียนภาษีต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)');
  if (no) {
    const dup = listBranches().find((x) => x.id !== id && x.taxBranchNo === no);
    if (dup) throw new HttpError(409, `${no === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${no}`} ถูกใช้กับ ${dup.name} แล้ว`);
  }
  const vat = typeof body.vatRegistered === 'boolean' ? body.vatRegistered : b.vatRegistered;
  db.prepare("UPDATE branches SET vat_registered = ?, tax_branch_no = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(vat ? 1 : 0, no, id);
  return taxAdmin();
}

/** อัตรา VAT: ห้ามช่วงวันที่ทับกัน */
function cleanRate(body: Record<string, unknown>, exceptId?: number) {
  const rate = Math.round(Number(body.rate) * 100) / 100;
  if (!Number.isFinite(rate) || rate < 0 || rate > 30 || String(body.rate ?? '').trim() === '') throw new HttpError(422, 'อัตรา VAT ต้องอยู่ระหว่าง 0–30%');
  if (!isDay(body.startDate)) throw new HttpError(422, 'กรุณาระบุวันที่เริ่มใช้');
  const end = body.endDate ? String(body.endDate) : null;
  if (end && !isDay(end)) throw new HttpError(422, 'วันที่สิ้นสุดไม่ถูกต้อง');
  if (end && end < body.startDate) throw new HttpError(422, 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มใช้');
  const s = body.startDate;
  const e = end ?? '9999-12-31';
  const clash = (q.rates.all() as { id: number; rate: number; startDate: string; endDate: string | null }[]).find(
    (r) => r.id !== exceptId && r.startDate <= e && (r.endDate ?? '9999-12-31') >= s,
  );
  if (clash) {
    throw new HttpError(
      409,
      `ช่วงวันที่ทับกับอัตรา ${clash.rate}% (${clash.startDate} – ${clash.endDate ?? 'ไม่มีกำหนด'}) — กำหนดวันสิ้นสุดของอัตราเดิมก่อน`,
    );
  }
  return { rate, startDate: s, endDate: end, note: str(body.note, 120) };
}
export function addRate(body: Record<string, unknown>, by: string) {
  const r = cleanRate(body);
  db.prepare('INSERT INTO vat_rates (rate, start_date, end_date, note, created_by) VALUES (?, ?, ?, ?, ?)').run(r.rate, r.startDate, r.endDate, r.note, by);
  return taxAdmin();
}
export function updateRate(id: number, body: Record<string, unknown>) {
  if (!q.rate.get(id)) throw new HttpError(404, 'ไม่พบอัตรา VAT');
  const r = cleanRate(body, id);
  db.prepare("UPDATE vat_rates SET rate = ?, start_date = ?, end_date = ?, note = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(
    r.rate, r.startDate, r.endDate, r.note, id,
  );
  return taxAdmin();
}
/** ลบอัตรา — บิลเดิมไม่กระทบ (เก็บอัตราที่ใช้ไว้ในบิลแล้ว) แต่ห้ามลบช่วงที่มีบิลอยู่ เพื่อให้ตรวจย้อนหลังได้ */
export function deleteRate(id: number) {
  const r = (q.rates.all() as { id: number; bills: number }[]).find((x) => x.id === id);
  if (!r) throw new HttpError(404, 'ไม่พบอัตรา VAT');
  if (r.bills > 0) throw new HttpError(409, `มีบิล ${r.bills.toLocaleString()} ใบในช่วงอัตรานี้ — ลบไม่ได้ (ถ้าเลิกใช้ ให้กำหนดวันสิ้นสุดแทน)`);
  db.prepare('DELETE FROM vat_rates WHERE id = ?').run(id);
  return taxAdmin();
}

function cleanTerminal(body: Record<string, unknown>, branchId: number, exceptId?: number) {
  const code = str(body.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) throw new HttpError(422, 'กรุณาระบุรหัสเครื่อง (ตัวอักษรอังกฤษ/ตัวเลข เช่น POS01)');
  const dup = db.prepare('SELECT id FROM pos_terminals WHERE branch_id = ? AND code = ? AND id <> ?').get(branchId, code, exceptId ?? 0);
  if (dup) throw new HttpError(409, `รหัสเครื่อง ${code} มีแล้วในสาขานี้`);
  const rdNo = str(body.rdNo, 40);
  if (rdNo) {
    const d2 = db.prepare("SELECT code FROM pos_terminals WHERE rd_no = ? AND rd_no <> '' AND id <> ?").get(rdNo, exceptId ?? 0) as { code: string } | undefined;
    if (d2) throw new HttpError(409, `หมายเลขเครื่อง ${rdNo} ถูกใช้กับเครื่อง ${d2.code} แล้ว`);
  }
  return { code, rdNo, name: str(body.name, 60), active: body.active !== false };
}
export function addTerminal(body: Record<string, unknown>) {
  const branchId = Number(body.branchId);
  if (!getBranch(branchId)) throw new HttpError(422, 'กรุณาเลือกสาขา');
  const t = cleanTerminal(body, branchId);
  db.prepare('INSERT INTO pos_terminals (branch_id, code, rd_no, name, active) VALUES (?, ?, ?, ?, ?)').run(branchId, t.code, t.rdNo, t.name, t.active ? 1 : 0);
  return taxAdmin();
}
export function updateTerminal(id: number, body: Record<string, unknown>) {
  const cur = getTerminal(id);
  if (!cur) throw new HttpError(404, 'ไม่พบเครื่อง POS');
  const t = cleanTerminal(body, cur.branchId, id);
  // เครื่องที่ออกบิลแล้ว: เปลี่ยนรหัสไม่ได้ (เลขที่บิลเดิมอ้างอิงรหัสนี้)
  const used = (db.prepare('SELECT COUNT(*) AS n FROM orders_all WHERE terminal_id = ?').get(id) as { n: number }).n;
  if (used && t.code !== cur.code) throw new HttpError(409, `เครื่อง ${cur.code} ออกบิลไปแล้ว ${used.toLocaleString()} ใบ — เปลี่ยนรหัสเครื่องไม่ได้ (แก้หมายเลขเครื่อง/ชื่อได้)`);
  db.prepare("UPDATE pos_terminals SET code = ?, rd_no = ?, name = ?, active = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(
    t.code, t.rdNo, t.name, t.active ? 1 : 0, id,
  );
  return taxAdmin();
}
export function deleteTerminal(id: number) {
  const cur = getTerminal(id);
  if (!cur) throw new HttpError(404, 'ไม่พบเครื่อง POS');
  const used = (db.prepare('SELECT COUNT(*) AS n FROM orders_all WHERE terminal_id = ?').get(id) as { n: number }).n;
  if (used) throw new HttpError(409, `เครื่อง ${cur.code} ออกบิลไปแล้ว ${used.toLocaleString()} ใบ — ลบไม่ได้ (ปิดใช้งานแทน)`);
  db.prepare('DELETE FROM pos_terminals WHERE id = ?').run(id);
  return taxAdmin();
}

/** ข้อความสาขาตามทะเบียนภาษี: สำนักงานใหญ่ / สาขาที่ 00001 */
export const taxBranchText = (no: string) => (no === '00000' ? 'สำนักงานใหญ่' : no ? `สาขาที่ ${no}` : '');
