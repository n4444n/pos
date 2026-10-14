import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors, font } from '../../theme';
import { useAppSettings } from '../../appSettings';

/** ตาราง Code 128 (ความกว้าง แท่ง/ช่อง สลับกัน) — ค่า 0–106 */
const P = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
  '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
  '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

/** เข้ารหัส Code 128-B (ตัวอักษร ASCII 32–126) → รายการความกว้าง (หน่วยโมดูล) */
export function code128(text: string): number[] | null {
  if (!text || [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) return null;
  const codes = [104, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const check = codes.reduce((sum, c, i) => sum + c * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, check, 106].flatMap((c) => P[c].split('').map(Number));
}

const L = '0001101 0011001 0010011 0111101 0100011 0110001 0101111 0111011 0110111 0001011'.split(' ');
const G = '0100111 0110011 0011011 0100001 0011101 0111001 0000101 0010001 0001001 0010111'.split(' ');
const R = '1110010 1100110 1101100 1000010 1011100 1001110 1010000 1000100 1001000 1110100'.split(' ');
const PARITY = 'LLLLLL LLGLGG LLGGLG LLGGGL LGLLGG LGGLLG LGGGLL LGLGLG LGLGGL LGGLGL'.split(' ');

/** EAN-13 ที่ถูกต้อง (13 หลัก + check digit) → รายการความกว้าง (เริ่มด้วยแท่ง) */
export function ean13(text: string): number[] | null {
  if (!/^\d{13}$/.test(text)) return null;
  const d = [...text].map(Number);
  const sum = d.slice(0, 12).reduce((a, n, i) => a + n * (i % 2 === 0 ? 1 : 3), 0);
  if ((10 - (sum % 10)) % 10 !== d[12]) return null;
  const par = PARITY[d[0]];
  const bits = '101' + d.slice(1, 7).map((n, i) => (par[i] === 'L' ? L : G)[n]).join('') + '01010' + d.slice(7).map((n) => R[n]).join('') + '101';
  const runs: number[] = [];
  let cur = bits[0];
  let n = 0;
  for (const b of bits) {
    if (b === cur) n++;
    else {
      runs.push(n);
      cur = b;
      n = 1;
    }
  }
  runs.push(n);
  return runs;
}

/** แสดงบาร์โค้ด — Code 128 (ทุกรหัส) หรือ EAN-13 (ตามตั้งค่า เมื่อรหัสเป็น EAN-13 ที่ถูกต้อง) */
function BarcodeImpl({ value, height = 64, maxWidth = 280 }: { value: string; height?: number; maxWidth?: number }) {
  const sym = useAppSettings().barcode.symbology;
  const widths = useMemo(() => (sym === 'ean13' && ean13(value)) || code128(value), [value, sym]);
  if (!widths) return <Text style={s.invalid}>บาร์โค้ดมีตัวอักษรที่ไม่รองรับ</Text>;
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  const rects: { x: number; w: number }[] = [];
  let x = quiet;
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push({ x, w });
    x += w;
  });
  return (
    <View style={s.wrap} accessibilityLabel={`บาร์โค้ด ${value}`}>
      <View style={{ width: '100%', maxWidth, height }}>
        <Svg width="100%" height={height} viewBox={`0 0 ${total} 50`} preserveAspectRatio="none">
          {rects.map((r, i) => (
            <Rect key={i} x={r.x} y={0} width={r.w} height={50} fill="#111" />
          ))}
        </Svg>
      </View>
      <Text style={s.text}>{value}</Text>
    </View>
  );
}

export const Barcode = memo(BarcodeImpl);

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  text: { fontFamily: font, fontSize: 14, letterSpacing: 2, color: colors.text },
  invalid: { fontFamily: font, fontSize: 12, color: colors.danger },
});
