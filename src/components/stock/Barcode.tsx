// แสดงบาร์โค้ดบนจอ (Code 128 / EAN-13)
import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors, font } from '../../theme';
import { useAppSettings } from '../../appSettings';
import { code128Auto, ean13 } from '../../barcodeEncode';

// ตัวเข้ารหัสอยู่ที่ src/barcodeEncode.ts (ใช้ร่วมกับป้ายบาร์โค้ดที่พิมพ์)
export { code128, ean13 } from '../../barcodeEncode';

/** แสดงบาร์โค้ด — Code 128 (ทุกรหัส) หรือ EAN-13 (ตามตั้งค่า เมื่อรหัสเป็น EAN-13 ที่ถูกต้อง) */
function BarcodeImpl({ value, height = 64, maxWidth = 280 }: { value: string; height?: number; maxWidth?: number }) {
  const sym = useAppSettings().barcode.symbology;
  const widths = useMemo(() => (sym === 'ean13' && ean13(value)) || code128Auto(value), [value, sym]);
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
