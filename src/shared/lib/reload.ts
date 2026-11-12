// โหลดหน้าใหม่แบบตั้งใจ (เช่น สลับสาขา) — ไม่ให้คำเตือน "มีสินค้าในตะกร้า" (beforeunload) มาขวาง
// ตะกร้าของแต่ละสาขาเก็บไว้ใน sessionStorage อยู่แล้ว (usePos.ts) กลับมาสาขาเดิมยังอยู่ครบ
// หมายเหตุ: ในแอปเดสก์ท็อป (Electron) beforeunload จะยกเลิกการโหลดหน้าแบบเงียบ ๆ ไม่มีหน้าต่างถาม
//          จึงเห็นเป็น "หมุนค้าง/ช้ามาก" ตอนสลับสาขาขณะมีสินค้าในตะกร้า
import { Platform } from 'react-native';

let intended = false;

/** true = กำลังโหลดหน้าใหม่โดยระบบเอง (ไม่ต้องเตือน) */
export const reloadIntended = () => intended;

export function reloadPage() {
  if (Platform.OS !== 'web') return;
  intended = true;
  window.location.reload();
}
