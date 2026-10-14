import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ViewMode } from '../layout';
import { colors, font, radius } from '../theme';

interface Props {
  value: ViewMode;
  /** จำนวนคอลัมน์สูงสุดที่จอปัจจุบันรองรับ */
  maxCols: number;
  onChange: (m: ViewMode) => void;
}

const MODES: ViewMode[] = [5, 4, 3];

function GridGlyph({ n, color }: { n: number; color: string }) {
  // ไอคอนกริดขนาดเล็ก n × n (สูงสุดแสดง 3 แถวเพื่อให้อ่านง่าย)
  const cell = n === 5 ? 2 : n === 4 ? 2.5 : 3.5;
  const rows = Math.min(n, 3);
  return (
    <View style={{ gap: 1.5 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 1.5 }}>
          {Array.from({ length: n }).map((__, c) => (
            <View key={c} style={{ width: cell, height: cell, borderRadius: 0.5, backgroundColor: color }} />
          ))}
        </View>
      ))}
    </View>
  );
}

function ViewModeToggleImpl({ value, maxCols, onChange }: Props) {
  return (
    <View style={s.wrap} accessibilityRole="radiogroup" accessibilityLabel="มุมมองสินค้า">
      {MODES.map((m) => {
        const on = m === value;
        const disabled = m > maxCols;
        const fg = on ? '#fff' : disabled ? colors.faint : colors.text;
        return (
          <Pressable
            key={m}
            disabled={disabled}
            onPress={() => onChange(m)}
            style={({ hovered }: { hovered?: boolean }) => [s.btn, on && s.btnOn, hovered && !on && !disabled && s.btnHover, disabled && { opacity: 0.5 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={`มุมมอง ${m}×${m}`}
          >
            <GridGlyph n={m} color={fg} />
            <Text style={[s.text, { color: fg }]}>{m}×{m}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const ViewModeToggle = memo(ViewModeToggleImpl);

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: colors.panel, borderRadius: radius.pill, padding: 4, gap: 2, height: 48, alignItems: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: radius.pill },
  btnOn: { backgroundColor: colors.primary },
  btnHover: { backgroundColor: colors.surface },
  text: { fontFamily: font, fontSize: 12, fontWeight: '600' },
});
