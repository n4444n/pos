// สะพานไปแอปเดสก์ท็อป (.exe): พิมพ์ตรง · เครื่องพิมพ์ · ลิ้นชักเงิน · อัปเดตแอป — ไม่มีเมื่อเปิดผ่านเบราว์เซอร์
import { useEffect, useState } from 'react';

/** สถานะอัปเดตของแอปเดสก์ท็อป (ส่งมาจาก desktop/main.cjs) */
export type UpdateState = {
  /** idle = ไม่มีอัปเดต · downloading = กำลังดาวน์โหลด · ready = พร้อมติดตั้ง */
  status: 'idle' | 'downloading' | 'ready';
  /** เวอร์ชันแอปที่ติดตั้งอยู่ */
  current: string;
  /** เวอร์ชันใหม่ */
  version: string | null;
  percent: number;
  /** อัปเดตบังคับ (min-version.json บนเซิร์ฟเวอร์) */
  forced: boolean;
  /** รายละเอียดอัปเดตเป็นข้อ ๆ (แอปตั้งแต่ 1.0.11) */
  notes?: string[];
};

/** สะพานจากแอปเดสก์ท็อป (desktop/preload.cjs) — ไม่มีเมื่อเปิดผ่านเบราว์เซอร์ */
export type PrintKind = 'receipt' | 'shift' | 'day';

/** ตั้งค่าเครื่องพิมพ์ของเครื่องนี้ (เก็บในแอปเดสก์ท็อป ไม่ใช่บนเซิร์ฟเวอร์) */
export type PrinterConfig = {
  printMode: 'raster' | 'driver';
  connection: 'usb' | 'network' | 'bluetooth';
  printer: string;
  host: string;
  port: number;
  /** Bluetooth: พอร์ต COM เสมือนของเครื่องพิมพ์ที่จับคู่แล้ว */
  comPort: string;
  baud: number;
  paperWidth: 58 | 80 | null;
  dots: number;
  threshold: number;
  cut: boolean;
  feedTop: number;
  feedBottom: number;
  drawer: 'off' | 'cash' | 'sale';
  drawerPin: 0 | 1;
  silent: boolean;
};
export type PrinterResult = { ok: boolean; error?: string; image?: string; dots?: number };

/** เครื่องพิมพ์บาร์โค้ด (ป้ายติดสินค้า) ของเครื่องนี้ — แยกจากเครื่องพิมพ์ใบเสร็จ */
export type LabelPrinterConfig = {
  /** ชื่อเครื่องพิมพ์ใน Windows ('' = ถามทุกครั้ง) */
  labelPrinter: string;
  /** พิมพ์ทันทีไม่ถาม (เมื่อเลือกเครื่องไว้แล้ว) */
  labelSilent: boolean;
};

export type DesktopBridge = {
  version: string;
  paperWidth: () => 58 | 80 | null;
  /** kind: ชนิดเอกสาร (แอปตั้งแต่ 1.0.4 ใช้เลือกเครื่องพิมพ์/การตัดกระดาษ) */
  print: (html: string, opts: { paperWidth: 58 | 80; kind?: PrintKind }) => Promise<{ ok: boolean; error?: string }>;
  /** เปิดลิ้นชักเงินตามตั้งค่าเครื่องนี้ (cash = ขายด้วยเงินสด) — มีตั้งแต่แอปเวอร์ชัน 1.0.4 */
  openDrawer?: (info: { cash: boolean }) => void;
  /** ตั้งค่าเครื่องพิมพ์ของเครื่องนี้ (หน้า ตั้งค่า → ใบเสร็จ) — มีตั้งแต่แอปเวอร์ชัน 1.0.4 */
  printer?: {
    get: () => Promise<(PrinterConfig & { version: string }) | null>;
    list: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
    /** พอร์ต COM (Bluetooth / Serial) */
    ports?: () => Promise<{ port: string; name: string; bluetooth: boolean }[]>;
    test: (c: Partial<PrinterConfig>) => Promise<PrinterResult>;
    preview: (c: Partial<PrinterConfig>) => Promise<PrinterResult>;
    testDrawer: (c: Partial<PrinterConfig>) => Promise<PrinterResult>;
    save: (c: Partial<PrinterConfig>) => Promise<(PrinterConfig & { version: string }) | null>;
  };
  /** เครื่องพิมพ์บาร์โค้ด (ป้ายติดสินค้า) — ไม่มีในแอปรุ่นเก่า (ใช้หน้าต่างพิมพ์ของเบราว์เซอร์แทน) */
  labels?: {
    get: () => Promise<(LabelPrinterConfig & { version: string }) | null>;
    save: (c: Partial<LabelPrinterConfig>) => Promise<(LabelPrinterConfig & { version: string }) | null>;
    list: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
    /** page = ขนาดกระดาษ 1 หน้า (มม.) · c = ค่าที่ยังไม่บันทึก (ทดสอบพิมพ์) */
    print: (html: string, page: { width: number; height: number }, c?: Partial<LabelPrinterConfig>) => Promise<PrinterResult>;
  };
  /** ชื่อร้าน/สาขาบนหัวหน้าต่างโปรแกรม — มีตั้งแต่แอปเวอร์ชัน 1.0.3 */
  setTitleInfo?: (info: { shop: string; branch: string }) => void;
  /** มีตั้งแต่แอปเวอร์ชัน 1.0.1 */
  update?: {
    get: () => Promise<UpdateState>;
    install: () => Promise<boolean>;
    check: () => Promise<void>;
    onChange: (cb: (s: UpdateState) => void) => () => void;
  };
};

export const desktop = (): DesktopBridge | null =>
  (typeof window !== 'undefined' && (window as unknown as { posDesktop?: DesktopBridge }).posDesktop) || null;

/** สถานะอัปเดตแอป (null = ไม่ได้เปิดในแอปเดสก์ท็อป หรือแอปรุ่นเก่าที่ยังไม่รองรับ) */
export function useDesktopUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const u = desktop()?.update;
    if (!u) return;
    let alive = true;
    u.get().then((s) => alive && setState(s)).catch(() => {});
    const off = u.onChange((s) => alive && setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
