// เครื่อง POS ของคอมพิวเตอร์/แท็บเล็ตเครื่องนี้ (ตั้งค่า → ภาษี (VAT) → เครื่องนี้)
// เก็บในเครื่อง (localStorage) และส่งไปกับทุกคำขอ (header X-POS-Terminal) → บิลบันทึกว่าออกจากเครื่องไหน
const KEY = 'pos.terminal';

export function getDeviceTerminal(): number | null {
  try {
    const n = Number(globalThis.localStorage?.getItem(KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function setDeviceTerminal(id: number | null) {
  try {
    if (id) globalThis.localStorage?.setItem(KEY, String(id));
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** ข้อความสาขาตามทะเบียนภาษี */
export const taxBranchText = (no?: string | null) => (no === '00000' ? 'สำนักงานใหญ่' : no ? `สาขาที่ ${no}` : '');
