// จัดรูปแบบตัวเลข/เงิน/วันที่ภาษาไทย และป้ายข้อความที่ใช้ซ้ำ (วิธีชำระ · VAT · ตัวเลือกสินค้า)
import { uiLang } from './i18n/current';
const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });

export const baht = (n: number) => `฿${money.format(n)}`;
export const bahtShort = (n: number) => (Number.isInteger(n) ? `฿${money0.format(n)}` : baht(n));

/** รูปแบบจำนวนเงิน บาท.สตางค์ — จุดทศนิยมได้ 1 จุด ไม่เกิน 2 ตำแหน่ง */
export const MONEY_RE = /^\d*(\.\d{0,2})?$/;
/** กรองข้อความที่พิมพ์ในช่องจำนวนเงิน: ถ้าไม่ตรงรูปแบบ (เช่นจุดซ้ำ 500.5.5 หรือทศนิยมเกิน 2 ตำแหน่ง) ไม่รับค่าใหม่ */
export const moneyInput = (next: string, prev = '') => {
  const t = next.replace(/[^0-9.]/g, '');
  return MONEY_RE.test(t) ? t : MONEY_RE.test(prev) ? prev : '';
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

const dateFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });

export const thaiDate = (d: Date) => dateFmt.format(d);
export const thaiTime = (d: Date) => timeFmt.format(d);

export const PAYMENT_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  promptpay: 'พร้อมเพย์ (QR)',
  card: 'บัตรเครดิต/เดบิต',
  transfer: 'โอนเงิน',
};

/**
 * คำนวณยอด — ตรงกับที่ server คำนวณ (server/tax.ts billTax · ราคารวม VAT แล้ว)
 * exemptGross = มูลค่าสินค้ายกเว้น VAT ก่อนส่วนลด → ส่วนลดเฉลี่ยตามสัดส่วน · VAT คิดเฉพาะส่วนที่เสีย VAT
 */
export function computeTotals(subtotal: number, discount: number, vatRate: number, surcharge = 0, exemptGross = 0) {
  const goods = round2(subtotal - discount);
  const total = round2(goods + surcharge);
  const exempt = Math.max(0, round2(exemptGross - (subtotal > 0 ? round2((discount * exemptGross) / subtotal) : 0)));
  const vatable = Math.max(0, round2(total - exempt));
  const vat = round2((vatable * vatRate) / (1 + vatRate));
  return { subtotal: round2(subtotal), discount, goods, surcharge, total, vat, exempt };
}

export const STATUS_LABEL: Record<string, string> = { paid: 'ชำระแล้ว', edited: 'แก้ไขแล้ว', void: 'ยกเลิก' };
export const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  paid: { bg: '#E6F6EE', fg: '#1F9D63' },
  edited: { bg: '#FFF4E0', fg: '#B26A00' },
  void: { bg: '#FDECEC', fg: '#E5484D' },
};

const pad = (n: number) => String(n).padStart(2, '0');
/** YYYY-MM-DD ตามเวลาเครื่อง */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** '2026-10-11 14:05:00' → '11/10/2569 · 14:05' (โหมด English ใช้ ค.ศ. → '11/10/2026 · 14:05') */
export function thaiDateTime(s: string) {
  const [d, t = ''] = s.split(' ');
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${Number(y) + (uiLang() === 'en' ? 0 : 543)} · ${t.slice(0, 5)}`;
}

/** 505 → '505 นาที' / 8 ชม. 25 นาที */
export function duration(min: number) {
  if (min < 60) return `${min} นาที`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

export const VERDICT: Record<string, { label: string; bg: string; fg: string; icon: 'checkmark-circle' | 'alert-circle' | 'arrow-up-circle' | 'radio-button-on' }> = {
  match: { label: 'ยอดเงินตรงกัน', bg: '#E3F7EA', fg: '#1F9D63', icon: 'checkmark-circle' },
  short: { label: 'เงินขาด', bg: '#FDECEC', fg: '#E5484D', icon: 'alert-circle' },
  over: { label: 'เงินเกิน', bg: '#FFF4E0', fg: '#B26A00', icon: 'arrow-up-circle' },
  open: { label: 'กำลังเปิดกะ', bg: '#EAF0FF', fg: '#2F6BFF', icon: 'radio-button-on' },
};

/** ยอดมีเครื่องหมาย: +฿10.00 / −฿20.00 / ฿0.00 */
export const signedBaht = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + baht(Math.abs(n));

/** ตัวเลขแบบย่อสำหรับแกนกราฟ: 0 / 950 / 12K / 1.2M */
export function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${+(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${+(n / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

/** % เปลี่ยนแปลงเทียบช่วงก่อน (null = ช่วงก่อนเป็น 0) */
export function pctChange(cur: number, prev: number) {
  if (!prev) return cur ? null : 0;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

const num0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const n0 = (n: number) => num0.format(n);
export const n2 = (n: number) => num2.format(n);

/** ชื่อตัวเลือก SKU: "ดำ / M / ลายทาง" (ข้ามค่าที่ไม่ได้ใช้) */
export function variantLabel(v: { color?: string; size?: string; extra?: string | null }) {
  return [v.color, v.size, v.extra].filter((x) => x && x !== '-').join(' / ') || 'ปกติ';
}

/** ราคาช่วง: ฿290 หรือ ฿790–850 */
export function priceRange(min: number, max: number) {
  return min === max ? bahtShort(min) : `${bahtShort(min)}–${money0.format(max)}`;
}

/** ข้อความ VAT ของบิล — ใช้อัตราที่บันทึกในบิล (vatRate) · บิลเก่าที่ไม่มี คำนวณจากตัวเลขในบิล */
export function vatLabel(o: { vat: number; total: number; vatRate?: number | null; vatBase?: number | null }, suffix = '(รวมในราคา)') {
  const base = o.vatBase ?? o.total - o.vat;
  const pct = o.vatRate != null && o.vatRate > 0 ? o.vatRate : base > 0 ? Math.round((o.vat / base) * 1000) / 10 : 0;
  return `VAT ${pct % 1 === 0 ? pct.toFixed(0) : pct}% ${suffix}`;
}

/** ตรวจเลขประจำตัวผู้เสียภาษี 13 หลัก — หลักสุดท้ายเป็นเลขตรวจสอบ (เหมือน server/tax.ts validTaxId) */
export function validTaxId(id: string) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}
