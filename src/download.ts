// ดาวน์โหลดไฟล์จากเซิร์ฟเวอร์ (Excel / CSV / ไฟล์สำรอง) โดยไม่เปิดหน้าต่างใหม่
// เดิมใช้ window.open → ในแอป Clothing POS จะมีหน้าต่างสีขาวว่าง ๆ ค้างขึ้นมาก่อนกล่องบันทึกไฟล์
// ใช้ลิงก์ <a download> แทน: เบราว์เซอร์ = ดาวน์โหลดทันที · แอป = ขึ้นแค่กล่องเลือกที่บันทึกไฟล์
import { Platform } from 'react-native';

export function downloadFile(url: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.download = ''; // ใช้ชื่อไฟล์จากเซิร์ฟเวอร์ (Content-Disposition)
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
