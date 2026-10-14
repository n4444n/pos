import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

export type ViewMode = 3 | 4 | 5;
export type Device = 'mobile' | 'tablet' | 'pc';

export const GRID_GAP = 12;
/** การ์ดแคบสุดที่ยังอ่าน/กดง่าย — ถ้าเลือก 5×5 แต่จอแคบเกิน จะลดคอลัมน์ให้อัตโนมัติ */
const MIN_CARD = 150;

/**
 * Breakpoints
 *  mobile : < 768   → ตะกร้าเป็นแถบล่าง, กริด 2 คอลัมน์
 *  tablet : 768–1199 → ตะกร้าด้านขวา (≥ 900) / แถบล่าง (< 900)
 *  pc     : ≥ 1200  → ตะกร้าด้านขวา
 */
export function useResponsive(viewMode: ViewMode) {
  const { width, height } = useWindowDimensions();
  const device: Device = width < 768 ? 'mobile' : width < 1200 ? 'tablet' : 'pc';
  const sideCart = width >= 900;
  const cartW = width >= 1440 ? 400 : width >= 1200 ? 360 : 320;
  const pad = device === 'mobile' ? 10 : 16;
  const scrollbar = 10;
  const leftW = width - pad * 2 - (sideCart ? cartW + 14 : 0) - scrollbar;

  const maxCols = Math.max(2, Math.min(5, Math.floor((leftW + GRID_GAP) / (MIN_CARD + GRID_GAP)))) as 2 | ViewMode;
  const cols = device === 'mobile' ? 2 : Math.min(viewMode, maxCols);
  const cardW = (leftW - GRID_GAP * (cols - 1)) / cols;

  return { width, height, device, sideCart, cartW, pad, cols, cardW, maxCols };
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
