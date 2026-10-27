// ข้อความในใบเสร็จ: ภาษา (ไทย / English / ไทย + English) + แก้ข้อความเองได้ทุกคำ
import { PAYMENT_LABEL, vatLabel } from './format';

export type ReceiptLang = 'th' | 'en' | 'both';
export const RECEIPT_LABELS = [
  ['tel', 'โทรศัพท์', 'โทร', 'Tel.'],
  ['taxId', 'เลขผู้เสียภาษี', 'เลขประจำตัวผู้เสียภาษี', 'Tax ID'],
  ['orderNo', 'เลขที่บิล', 'เลขที่', 'No.'],
  ['date', 'วันที่', 'วันที่', 'Date'],
  ['customer', 'ลูกค้า', 'ลูกค้า', 'Customer'],
  ['staff', 'พนักงาน', 'พนักงาน', 'Cashier'],
  ['orderType', 'ประเภทการขาย', 'ประเภท', 'Type'],
  ['colItem', 'หัวคอลัมน์ รายการ', 'รายการสินค้า', 'Item'],
  ['colQty', 'หัวคอลัมน์ จำนวน', 'จำนวน', 'Qty'],
  ['colAmount', 'หัวคอลัมน์ รวมเงิน', 'รวมเงิน', 'Amount'],
  ['subtotal', 'ยอดรวมสินค้า', 'รวม', 'Subtotal'],
  ['discount', 'ส่วนลด', 'ส่วนลด', 'Discount'],
  ['fee', 'ค่าธรรมเนียม', 'ค่าธรรมเนียม', 'Fee'],
  ['total', 'ยอดสุทธิ', 'ยอดสุทธิ', 'Total'],
  ['vatIncluded', 'ท้ายบรรทัด VAT', '(รวมในราคา)', '(included)'],
  ['paidBy', 'ชำระโดย', 'ชำระโดย', 'Paid by'],
  ['change', 'เงินทอน', 'เงินทอน', 'Change'],
  ['pay_cash', 'วิธีชำระ: เงินสด', '', 'Cash'],
  ['pay_promptpay', 'วิธีชำระ: พร้อมเพย์', '', 'PromptPay (QR)'],
  ['pay_card', 'วิธีชำระ: บัตร', '', 'Credit/Debit card'],
  ['pay_transfer', 'วิธีชำระ: โอน', '', 'Bank transfer'],
] as const;
export type ReceiptLabelKey = (typeof RECEIPT_LABELS)[number][0];

/** ข้อความเริ่มต้นของหัวเรื่อง/ท้ายบิล แต่ละภาษา (ใช้ตอนสลับภาษา) */
export const RECEIPT_DEFAULT_TEXT = {
  th: { title: 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ', footer: 'ขอบคุณที่ใช้บริการ' },
  en: { title: 'RECEIPT / ABBREVIATED TAX INVOICE', footer: 'Thank you for shopping with us' },
  both: { title: 'ใบเสร็จรับเงิน / RECEIPT', footer: 'ขอบคุณที่ใช้บริการ · Thank you' },
};

interface ReceiptCfg { language?: ReceiptLang; labels?: Partial<Record<string, string>> }

/** ข้อความตั้งต้นของภาษาที่เลือก (ก่อนแก้เอง) */
export function defaultLabel(key: ReceiptLabelKey, lang: ReceiptLang) {
  const row = RECEIPT_LABELS.find((r) => r[0] === key)!;
  const th = row[2] || (key.startsWith('pay_') ? PAYMENT_LABEL[key.slice(4)] ?? '' : '');
  const en = row[3];
  if (lang === 'en') return en;
  if (lang === 'both') return key === 'vatIncluded' ? `${th} ${en}` : th === en ? th : `${th} / ${en}`;
  return th;
}

/** ตัวช่วยสร้างข้อความในบิล */
export function receiptText(r: ReceiptCfg) {
  const lang: ReceiptLang = r.language ?? 'th';
  const t = (key: ReceiptLabelKey) => {
    const own = r.labels?.[key];
    return own && own.trim() ? own : defaultLabel(key, lang);
  };
  const pay = (method: string) => {
    const key = `pay_${method}` as ReceiptLabelKey;
    return RECEIPT_LABELS.some((x) => x[0] === key) ? t(key) : PAYMENT_LABEL[method] ?? method;
  };
  const date = (d: Date) =>
    lang === 'en'
      ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const vat = (o: { vat: number; total: number; vatRate?: number | null; vatBase?: number | null }) => vatLabel(o, t('vatIncluded'));
  return { lang, t, pay, date, vat };
}

/** แปลงวันที่จากฐานข้อมูล ("2026-10-11 15:42:00") */
export function parseLocal(s?: string | null) {
  if (!s) return new Date();
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
