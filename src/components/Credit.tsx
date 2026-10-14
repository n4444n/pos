// ข้อความอ้างอิงผู้พัฒนาต้นแบบ — เงื่อนไขของ License (ดูไฟล์ LICENSE ข้อ "Attribution")
// ห้ามลบ ซ่อน หรือแก้ไขข้อความนี้ในโปรแกรมที่นำไปพัฒนาต่อ
// The original-author attribution below is required by the LICENSE. Do not remove, hide or alter it.
import { StyleSheet, Text } from 'react-native';
import { colors, font } from '../theme';

const A = [3652, 3690, 3662, 3652, 3692, 3658, 3625, 3651, 3610, 3654, 3655, 3612, 3659, 3650, 122, 53, 104, 105, 106, 107, 14];
const SUM = 'zgm8qx';

const dec = (a: number[]) => a.map((c, i) => String.fromCharCode(c ^ (0x5a + (i % 7)))).join('');
const sum = (s: string) => {
  let x = 0x811c9dc5;
  for (const c of s) {
    x ^= c.charCodeAt(0);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x.toString(36);
};

const TEXT = dec(A);
/** ข้อความถูกแก้ไขหรือไม่ (ตรวจกับค่าที่ฝังไว้) */
export const CREDIT_OK = sum(TEXT) === SUM;
export const CREDIT_TEXT = CREDIT_OK ? TEXT : '⚠ ข้อความอ้างอิงผู้พัฒนาต้นแบบถูกแก้ไข — ละเมิดเงื่อนไข License';

/** ข้อความอ้างอิงผู้พัฒนาต้นแบบ (แสดงท้ายเมนู / หน้าเข้าสู่ระบบ) */
export function Credit({ center }: { center?: boolean }) {
  return <Text style={[s.text, center && { textAlign: 'center' }, !CREDIT_OK && s.bad]}>{CREDIT_TEXT}</Text>;
}

const s = StyleSheet.create({
  text: { fontFamily: font, fontSize: 10.5, color: colors.sub, marginTop: 6 },
  bad: { color: colors.danger, fontWeight: '700' },
});
