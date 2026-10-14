import { createContext, useContext } from 'react';

/** พนักงานที่เข้าสู่ระบบอยู่ */
export interface Me {
  id: number;
  name: string;
  role: 'manager' | 'staff';
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

export const SessionContext = createContext<{ me: Me; logout: () => void } | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionContext');
  return s;
}
