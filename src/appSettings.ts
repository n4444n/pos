// การตั้งค่าที่หน้าขาย/ใบเสร็จใช้ (โหลดมากับ bootstrap) — เก็บไว้ที่เดียวให้ทุกหน้าอ่านได้
import { useEffect, useState } from 'react';
import { PAYMENT_LABEL } from './format';
import type { PaymentMethod } from './types';

export type ImageShape = 'square' | 'portrait' | 'landscape';
export type ImageQuality = 'high' | 'medium' | 'low';
/** กว้าง ÷ สูง ของกรอบรูปสินค้า */
export const SHAPE_RATIO: Record<ImageShape, number> = { square: 1, portrait: 3 / 4, landscape: 4 / 3 };
export type ControlSize = 'small' | 'medium' | 'large';
/** วงกลมสี: เส้นผ่านศูนย์กลางจุดสี / กรอบเมื่อเลือก (px) */
export const SWATCH_PX: Record<ControlSize, { dot: number; ring: number }> = {
  small: { dot: 20, ring: 28 }, medium: { dot: 28, ring: 36 }, large: { dot: 36, ring: 46 },
};
/** ปุ่มไซซ์: ความสูง / กว้างขั้นต่ำ / ตัวอักษร (px) */
export const OPTION_PX: Record<ControlSize, { h: number; w: number; font: number; pad: number }> = {
  small: { h: 28, w: 32, font: 12, pad: 6 }, medium: { h: 36, w: 38, font: 14, pad: 8 }, large: { h: 44, w: 46, font: 16, pad: 10 },
};
/** ตัวคูณขนาดตัวอักษรบนการ์ดสินค้า */
export const FONT_SCALE = { small: 0.9, medium: 1, large: 1.15 } as const;

/** ส่วนท้ายบิลที่เพิ่มเอง */
export interface FooterBlock {
  type: 'text' | 'qr' | 'image';
  text: string;
  caption: string;
  size: 'small' | 'medium' | 'large';
  align: 'left' | 'center' | 'right';
  bold: boolean;
  width: number;
}
export interface PayMethod { id: PaymentMethod; label: string; enabled: boolean; feePercent: number; feeFixed: number }
/** โปรไฟล์ป้ายบาร์โค้ด (ตั้งค่า → กระดาษบาร์โค้ด) — ตรงกับ server/settings.ts */
export interface LabelProfile {
  id: string;
  name: string;
  /** roll = สติ๊กเกอร์ม้วน · a4 = กระดาษสติ๊กเกอร์ A4 */
  paper: 'roll' | 'a4';
  /** ขนาดดวง (มม.) */
  width: number; height: number;
  /** ดวงต่อแถว · จำนวนแถวต่อแผ่น (A4) */
  cols: number; rows: number;
  /** ระยะห่างระหว่างดวง / ขอบกระดาษ / ขอบในดวง (มม.) */
  gapX: number; gapY: number; marginTop: number; marginLeft: number; padding: number;
  symbology: 'auto' | 'code128' | 'ean13';
  /** ความสูงบาร์โค้ด (มม.) · ความกว้าง (% ของดวง) */
  barHeight: number; barWidth: number;
  showCode: boolean; showName: boolean; showVariant: boolean; showPrice: boolean; showShop: boolean;
  bold: boolean; italic: boolean;
  align: 'left' | 'center' | 'right';
  /** ขนาดตัวอักษร (pt) */
  codeSize: number; nameSize: number; priceSize: number;
  /** ระยะห่างบาร์โค้ด/ตัวหนังสือ (มม.) */
  textGap: number;
}
export const DEFAULT_LABEL_PROFILE: LabelProfile = {
  id: 'p1', name: 'โปรไฟล์ 1', paper: 'roll', width: 50, height: 30, cols: 1, rows: 1, gapX: 2, gapY: 0, marginTop: 0, marginLeft: 0, padding: 1.2,
  symbology: 'auto', barHeight: 10, barWidth: 90, showCode: true, showName: true, showVariant: true, showPrice: true, showShop: false,
  bold: true, italic: false, align: 'center', codeSize: 8, nameSize: 8, priceSize: 8, textGap: 0.5,
};

export interface PublicSettings {
  shop: { name: string; branchName: string; branchCode: string; address: string; phone: string; taxId: string; photoUrl: string; publicUrl: string };
  display: {
    defaultView: 3 | 4 | 5; showStock: boolean; hideOutOfStock: boolean; showImages: boolean; defaultOrderType: string; scanBeep: boolean;
    /** รูปทรงกรอบรูปสินค้า · การจัดรูปในกรอบ · คุณภาพรูป (ชัด = ไฟล์ใหญ่ / ต่ำ = โหลดเร็ว) */
    imageShape: ImageShape; imageFit: 'cover' | 'contain'; imageQuality: ImageQuality;
    /** ขนาดตัวอักษรบนการ์ดสินค้า · แสดงรหัสสินค้า · ป้ายหมวดบนรูป · รูปในตะกร้า */
    fontSize: 'small' | 'medium' | 'large'; showSku: boolean; showCategoryTag: boolean; cartImages: boolean;
    /** ขนาดวงกลมสี / ปุ่มไซซ์ บนการ์ดสินค้า */
    swatchSize: ControlSize; optionSize: ControlSize;
  };
  payments: { methods: PayMethod[]; promptpayId: string; vat: { enabled: boolean; rate: number }; feePayer: 'customer' | 'shop' };
  receipt: {
    paperWidth: 58 | 80; fontSize: 'small' | 'medium' | 'large'; title: string; header: string; footer: string;
    showSku: boolean; showSalesperson: boolean; showCustomer: boolean; showVat: boolean; showOrderBarcode: boolean; autoPrint: boolean; copies: number;
    language: 'th' | 'en' | 'both'; labels: Record<string, string>; shopName: string;
    logoUrl: string; logoWidth: number; showShopName: boolean; footerBlocks: FooterBlock[];
  };
  barcode: { symbology: 'code128' | 'ean13'; labelProfiles: LabelProfile[]; labelProfile: string };
  stock: { lowStockDefault: number; allowNegative: boolean };
  /** สาขาที่กำลังใช้งาน */
  branch: { id: number; name: string; code: string; isMain: boolean };
}

export const DEFAULT_SETTINGS: PublicSettings = {
  shop: { name: 'ร้านเสื้อผ้า', branchName: '', branchCode: '', address: '', phone: '', taxId: '', photoUrl: '', publicUrl: '' },
  display: {
    defaultView: 4, showStock: true, hideOutOfStock: false, showImages: true, defaultOrderType: 'หน้าร้าน', scanBeep: true,
    imageShape: 'landscape', imageFit: 'cover', imageQuality: 'medium', fontSize: 'medium', showSku: false, showCategoryTag: true, cartImages: true,
    swatchSize: 'medium', optionSize: 'medium',
  },
  payments: {
    methods: [
      { id: 'cash', label: 'เงินสด', enabled: true, feePercent: 0, feeFixed: 0 },
      { id: 'promptpay', label: 'พร้อมเพย์ (QR)', enabled: true, feePercent: 0, feeFixed: 0 },
      { id: 'card', label: 'บัตรเครดิต/เดบิต', enabled: true, feePercent: 0, feeFixed: 0 },
      { id: 'transfer', label: 'โอนผ่านธนาคาร', enabled: true, feePercent: 0, feeFixed: 0 },
    ],
    promptpayId: '',
    vat: { enabled: true, rate: 7 },
    feePayer: 'customer',
  },
  receipt: {
    paperWidth: 80, fontSize: 'medium', title: 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ', header: '', footer: 'ขอบคุณที่ใช้บริการ',
    showSku: false, showSalesperson: true, showCustomer: true, showVat: true, showOrderBarcode: true, autoPrint: false, copies: 1,
    language: 'th', labels: {}, shopName: '', logoUrl: '', logoWidth: 60, showShopName: true, footerBlocks: [],
  },
  barcode: { symbology: 'code128', labelProfiles: [], labelProfile: '' },
  stock: { lowStockDefault: 3, allowNegative: false },
  branch: { id: 0, name: '', code: '', isMain: true },
};

let current: PublicSettings = DEFAULT_SETTINGS;
const listeners = new Set<(s: PublicSettings) => void>();

export function getAppSettings() {
  return current;
}

/** ตั้งค่า → สต็อก → ขายได้แม้สต็อกหมด */
export const allowNegativeStock = () => current.stock?.allowNegative === true;
/** จำนวนที่ "ขายได้" (ไม่ใช่ยอดคงเหลือจริง): เปิดขายได้แม้หมด → ไม่จำกัด */
export const sellableStock = (stock: number) => (allowNegativeStock() ? 99999 : stock);

export function setAppSettings(s: Partial<PublicSettings> | undefined | null) {
  if (!s) return;
  current = { ...current, ...s } as PublicSettings;
  // ชื่อวิธีชำระเงินที่ตั้งเอง → ใช้ทุกหน้า (ประวัติ, กะ, ใบเสร็จ)
  for (const m of current.payments.methods) PAYMENT_LABEL[m.id] = m.label;
  listeners.forEach((f) => f(current));
}

export function useAppSettings() {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    setS(current);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/** เสียงบี๊บเมื่อสแกนสำเร็จ (Web Audio — ไม่ต้องมีไฟล์เสียง) */
let ctx: AudioContext | null = null;
export function beep(ok = true) {
  if (!current.display.scanBeep) return;
  try {
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = ok ? 1500 : 320;
    g.gain.value = 0.05;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.2));
  } catch {
    /* ไม่มีเสียงก็ไม่เป็นไร */
  }
}

/** ค่าธรรมเนียมของวิธีชำระเงิน (คิดจากยอดสินค้าหลังส่วนลด) — คำนวณเหมือนฝั่ง server · customer = บวกเพิ่มในยอดบิล */
export function feeOf(method: string | undefined | null, amount: number) {
  const m = current.payments.methods.find((x) => x.id === method);
  if (!m || amount <= 0 || (!m.feePercent && !m.feeFixed)) return null;
  const fee = Math.round(((amount * m.feePercent) / 100 + m.feeFixed) * 100) / 100;
  const rule = [m.feePercent ? `${m.feePercent}%` : '', m.feeFixed ? `฿${m.feeFixed}` : ''].filter(Boolean).join(' + ');
  return { fee, rule, label: m.label, customer: current.payments.feePayer === 'customer' };
}
