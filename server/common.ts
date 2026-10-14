// ค่าคงที่และ helper ที่ใช้ร่วมกันระหว่างโมดูล server

/** อัตรา VAT ปัจจุบัน (ราคาสินค้ารวม VAT แล้ว) — ตั้งได้ที่ ตั้งค่า → วิธีชำระเงิน & ค่าธรรมเนียม */
let vatRate = 0.07;
/** สาขาปัจจุบันจดทะเบียน VAT หรือไม่ (ตั้งโดย branches.ts) */
let vatOn: () => boolean = () => true;
export const getVatRate = () => (vatOn() ? vatRate : 0);
export function setVatRate(r: number) {
  vatRate = Number.isFinite(r) && r >= 0 && r <= 0.3 ? r : 0.07;
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
