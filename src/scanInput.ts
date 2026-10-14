// ตัวช่วยรับการสแกนบาร์โค้ดที่หน้าขาย
// - เครื่องสแกนส่งตัวอักษรเหมือนคีย์บอร์ด → ถ้าเปิดแป้นภาษาไทยอยู่ รหัสจะกลายเป็นอักษรไทย (เช่น 101-002 → ๅจๅขจจ/)
//   thaiToEn แปลงกลับเป็นตัวอักษรอังกฤษตามตำแหน่งแป้นพิมพ์ (เกษมณี)

const TH = 'ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฃฟหกดเ้่าสวงผปแอิืทมใฝ+๑๒๓๔ู฿๕๖๗๘๙๐"ฎฑธํ๊ณฯญฐ,ฅฤฆฏโฌ็๋ษศซ.()ฉฮฺ์?ฒฬฦ';
const EN = '1234567890-=qwertyuiop[]\\asdfghjkl;\'zxcvbnm,./!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?';
const MAP = new Map([...TH].map((c, i) => [c, EN[i]]));

export const hasThai = (s: string) => /[฀-๿]/.test(s);

/** แปลงข้อความที่พิมพ์ผ่านแป้นภาษาไทย → ตัวอักษรอังกฤษบนปุ่มเดียวกัน */
export function thaiToEn(s: string) {
  return [...s].map((c) => MAP.get(c) ?? c).join('');
}

/** โฟกัสอยู่ในช่องพิมพ์อื่น (input / textarea / contenteditable) หรือไม่ */
export function isEditable(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  const tag = e.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || e.isContentEditable;
}

/** ปุ่ม/ช่องที่กดอยู่ในหน้าต่าง (Modal / Sheet) ที่เปิดทับอยู่ */
export function inModal(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  return !!(e && typeof e.closest === 'function' && e.closest('[role="dialog"]'));
}
