// แสดง QR code (ตัวอย่างใบเสร็จ)
import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrMatrix } from '../qr';

/** แสดง QR code (ใช้ในตัวอย่างใบเสร็จ) */
export const QrView = memo(function QrView({ value, size }: { value: string; size: number }) {
  const m = useMemo(() => (value.trim() ? qrMatrix(value) : null), [value]);
  if (!m) return null;
  const n = m.length + 8;
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x + 4} ${y + 4}h1v1h-1z`)));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
        <Rect x={0} y={0} width={n} height={n} fill="#fff" />
        <Path d={d} fill="#000" />
      </Svg>
    </View>
  );
});
