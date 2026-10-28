// พนักงานที่เข้าสู่ระบบอยู่ (token เก็บในเครื่อง) · useSession()
import { createContext, useContext } from 'react';

/** บทบาทพนักงาน (สิทธิ์ตั้งได้ที่ พนักงาน → การจัดการสิทธิ์) */
export type Role = 'admin' | 'manager' | 'sales' | 'parttime';
/** ระดับสิทธิ์ของแต่ละเมนู */
export type PermLevel = 'none' | 'view' | 'edit';

/** ชื่อบทบาทที่แสดงให้ผู้ใช้เห็น */
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'ผู้ดูแลระบบ',
  manager: 'ผู้จัดการโรงงาน',
  sales: 'พนักงานขาย',
  parttime: 'พนักงานขาย (พาร์ทไทม์)',
};
/** เมนู/ความสามารถที่กำหนดสิทธิ์ได้ (ตรงกับ server/perms.ts) */
export type Feature = 'sales' | 'history' | 'shifts' | 'promos' | 'expenses' | 'stock' | 'shipments' | 'reports' | 'taxReport' | 'staff' | 'branches' | 'settings';

/** พนักงานที่เข้าสู่ระบบอยู่ */
export interface Me {
  id: number;
  name: string;
  role: Role;
  /** สิทธิ์ของบทบาทนี้ */
  perms: Record<Feature, PermLevel>;
  canVoid: boolean;
  /** สาขาที่กำลังใช้งาน */
  branchId: number;
  /** สาขาที่เข้าได้ */
  branchIds: number[];
}

const KEY = 'pos.token';
let token: string | null = null;
let onExpired: (() => void) | null = null;

/** เก็บ token ไว้ในเบราว์เซอร์ (refresh แล้วยังล็อกอินอยู่) — ถ้าเก็บไม่ได้ก็ใช้ในหน่วยความจำ */
export const auth = {
  get(): string | null {
    if (token) return token;
    try {
      token = globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      token = null;
    }
    return token;
  },
  set(t: string | null) {
    token = t;
    try {
      if (t) globalThis.localStorage?.setItem(KEY, t);
      else globalThis.localStorage?.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
  /** App ลงทะเบียนไว้ → เมื่อ API ตอบ 401 จะกลับไปหน้าล็อกอิน */
  onExpired(fn: (() => void) | null) {
    onExpired = fn;
  },
  expire() {
    auth.set(null);
    onExpired?.();
  },
};

const RANK: Record<PermLevel, number> = { none: 0, view: 1, edit: 2 };
/** มีสิทธิ์ถึงระดับที่ต้องการไหม (ไม่ระบุ = แค่เปิดดูได้ก็พอ) */
export const can = (me: Me | null | undefined, f: Feature, need: PermLevel = 'view') =>
  !!me && RANK[me.perms?.[f] ?? 'none'] >= RANK[need];

export const SessionContext = createContext<{ me: Me; logout: () => void } | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionContext');
  return s;
}
