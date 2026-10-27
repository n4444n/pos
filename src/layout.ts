// ขนาดจอและการจัดวางหน้าขาย (จำนวนคอลัมน์การ์ด · ความกว้างตะกร้า)
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

export type ViewMode = 3 | 4 | 5;
export type Device = 'mobile' | 'tablet' | 'pc';

export const GRID_GAP = 12;
/** การ์ดแคบสุดที่ยังอ่าน/กดง่าย — ถ้าเลือก 5×5 แต่จอแคบเกิน จะลดคอลัมน์ให้อัตโนมัติ */
const MIN_CARD = 150;
/** คอลัมน์มากสุดเมื่อหดตะกร้าให้แคบ */
const MAX_COLS = 8;

/**
 * Breakpoints
 *  mobile : < 768   → ตะกร้าเป็นแถบล่าง, กริด 2 คอลัมน์
 *  tablet : 768–1199 → ตะกร้าด้านขวา (≥ 900) / แถบล่าง (< 900)
 *  pc     : ≥ 1200  → ตะกร้าด้านขวา
 */
export const CART_MIN = 300;

/** ความกว้างตะกร้าเริ่มต้นตามขนาดจอ */
export const defaultCartW = (width: number) => (width >= 1440 ? 400 : width >= 1200 ? 360 : 320);

/** กว้างสุดที่ยอมให้ลากตะกร้า — เหลือที่ให้กริดสินค้าอย่างน้อย 2 การ์ด */
export function maxCartW(width: number) {
  const pad = width < 768 ? 10 : 16;
  return Math.max(CART_MIN, width - pad * 2 - 14 - 10 - (MIN_CARD * 2 + GRID_GAP));
}

/**
 * @param cartWidth ความกว้างตะกร้าที่ผู้ใช้ลากปรับเอง (null = ใช้ค่าเริ่มต้นตามจอ)
 */
export function useResponsive(viewMode: ViewMode, cartWidth: number | null = null) {
  const { width, height } = useWindowDimensions();
  const device: Device = width < 768 ? 'mobile' : width < 1200 ? 'tablet' : 'pc';
  const sideCart = width >= 900;
  const cartW = cartWidth == null ? defaultCartW(width) : Math.round(Math.min(maxCartW(width), Math.max(CART_MIN, cartWidth)));
  const pad = device === 'mobile' ? 10 : 16;
  const scrollbar = 10;
  const leftW = width - pad * 2 - (sideCart ? cartW + 14 : 0) - scrollbar;

  const maxCols = Math.max(2, Math.min(5, Math.floor((leftW + GRID_GAP) / (MIN_CARD + GRID_GAP)))) as 2 | ViewMode;
  let cols: number = device === 'mobile' ? 2 : Math.min(viewMode, maxCols);
  if (sideCart && device !== 'mobile' && cartWidth != null && cartW !== defaultCartW(width)) {
    // ลากปรับความกว้างตะกร้า: การ์ดคงขนาดเดิม (ขนาดของโหมด 3×3/4×4/5×5 ตอนตะกร้ากว้างปกติ)
    // แล้วเพิ่ม/ลดจำนวนคอลัมน์ตามพื้นที่ที่เหลือ (แบบ POSPOS) แทนการบีบการ์ดให้แคบลง
    const baseLeft = width - pad * 2 - (defaultCartW(width) + 14) - scrollbar;
    const baseMax = Math.max(2, Math.min(5, Math.floor((baseLeft + GRID_GAP) / (MIN_CARD + GRID_GAP))));
    const baseCols = Math.min(viewMode, baseMax);
    const baseCard = (baseLeft - GRID_GAP * (baseCols - 1)) / baseCols;
    cols = Math.max(2, Math.min(MAX_COLS, Math.floor((leftW + GRID_GAP) / (baseCard + GRID_GAP))));
  }
  const cardW = (leftW - GRID_GAP * (cols - 1)) / cols;

  return { width, height, device, sideCart, cartW, pad, cols, cardW, maxCols };
}

const CART_KEY = 'pos.cartWidth';

/** ความกว้างตะกร้าที่ลากปรับไว้ — จำไว้ในเบราว์เซอร์เครื่องนี้ (null = ค่าเริ่มต้น) */
export function useCartWidth(): [number | null, (w: number | null) => void] {
  const [w, setW] = useState<number | null>(() => {
    try {
      const v = Number(globalThis.localStorage?.getItem(CART_KEY));
      return Number.isFinite(v) && v >= CART_MIN ? v : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (w == null) globalThis.localStorage?.removeItem(CART_KEY);
      else globalThis.localStorage?.setItem(CART_KEY, String(Math.round(w)));
    } catch {
      /* ignore */
    }
  }, [w]);
  return [w, setW];
}

const KEY = 'pos.viewMode';

/** จำโหมดมุมมองไว้ในเบราว์เซอร์ (ถ้าเก็บไม่ได้ ใช้ค่าเริ่มต้น 4×4) */
/** ตั้งค่า → การแสดงผล: เมื่อผู้จัดการเปลี่ยนค่าเริ่มต้น ทุกเครื่องจะเปลี่ยนตาม 1 ครั้ง (หลังจากนั้นปรับเองได้) */
export function useDefaultViewMode(def: ViewMode | undefined, setMode: (m: ViewMode) => void) {
  useEffect(() => {
    if (!def) return;
    try {
      const seen = Number(globalThis.localStorage?.getItem(KEY + '.default'));
      if (seen === def) return;
      globalThis.localStorage?.setItem(KEY + '.default', String(def));
    } catch {
      /* ignore */
    }
    setMode(def);
  }, [def]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const v = Number(globalThis.localStorage?.getItem(KEY));
      return v === 3 || v === 4 || v === 5 ? v : 4;
    } catch {
      return 4;
    }
  });
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(KEY, String(mode));
    } catch {
      /* ignore */
    }
  }, [mode]);
  return [mode, setMode];
}
