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
};

/** สะพานจากแอปเดสก์ท็อป (desktop/preload.cjs) — ไม่มีเมื่อเปิดผ่านเบราว์เซอร์ */
export type DesktopBridge = {
  version: string;
  paperWidth: () => 58 | 80 | null;
  print: (html: string, opts: { paperWidth: 58 | 80 }) => Promise<{ ok: boolean; error?: string }>;
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
