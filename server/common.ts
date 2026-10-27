// ค่าคงที่และ helper ที่ใช้ร่วมกันระหว่างโมดูล server

/**
 * อัตรา VAT (%) ที่มีผลวันนี้ — มาจากตารางอัตรา VAT (ตั้งค่า → ภาษี) ผ่าน tax.ts · ไม่มีค่าตายตัวในโค้ด
 * null = ยังไม่ได้ตั้งอัตราที่ครอบคลุมวันนี้
 */
let rateToday: () => number | null = () => null;
/** สาขาปัจจุบันจดทะเบียน VAT หรือไม่ (ตั้งโดย branches.ts) */
let vatOn: () => boolean = () => true;
/** อัตรา VAT แบบทศนิยม (0.07 = 7%) ของสาขาปัจจุบัน · ไม่จด VAT / ยังไม่ตั้งอัตรา = 0 */
export const getVatRate = () => (vatOn() ? (rateToday() ?? 0) / 100 : 0);
export function setVatRateProvider(fn: () => number | null) {
  rateToday = fn;
}
export function setVatSwitch(fn: () => boolean) {
  vatOn = fn;
}
export const ORDER_TYPES = ['หน้าร้าน', 'ออนไลน์ (รับที่ร้าน)', 'จัดส่ง'];
export const PAYMENT_METHODS = ['cash', 'promptpay', 'card', 'transfer'];

export const round2 = (n: number) => Math.round(n * 100) / 100;

export class HttpError extends Error {
  status: number;
  /** รหัสให้ฝั่งหน้าเว็บตัดสินใจ เช่น NO_SHIFT = ยังไม่เปิดกะ */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Promo = { code: string; label: string; type: 'percent' | 'amount'; value: number; minTotal: number };

export function discountFor(promo: Promo | undefined, subtotal: number) {
  if (!promo || subtotal < promo.minTotal) return 0;
  const d = promo.type === 'percent' ? (subtotal * promo.value) / 100 : promo.value;
  return round2(Math.min(d, subtotal));
}

export function vatOf(total: number) {
  const r = getVatRate();
  return round2((total * r) / (1 + r));
}
