// ภาษาที่หน้าจอใช้อยู่ตอนนี้ — สำหรับโค้ดที่ไม่ได้อยู่ใน component (เช่น format.ts จัดรูปแบบวันที่)
// แยกไฟล์ไว้ไม่ให้ import React/พจนานุกรม (ใช้ได้ทุกที่ ไม่มีวงวน import)
export type UiLang = 'th' | 'en';
let current: UiLang = 'th';
export const uiLang = (): UiLang => current;
export const setUiLang = (v: UiLang) => {
  current = v;
};
