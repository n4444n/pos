// รายงาน: กราฟแท่งแนวนอน/แนวตั้ง
import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../../theme';

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** ข้อความแสดงท้ายแท่ง */
  display: string;
  /** ข้อความรอง เช่น สัดส่วน % */
  sub?: string;
  /** ไอคอน/สีตัวอย่างหน้าชื่อ (เช่น สีเสื้อจริง) */
  lead?: ReactNode;
}

/** แท่งแนวนอน สีเดียว (ขนาด) — ป้ายและตัวเลขเป็นสีตัวอักษร ไม่ใช้สีข้อมูล */
function BarsImpl({ items, max, labelWidth = 96, emptyText = 'ยังไม่มีข้อมูล' }: { items: BarItem[]; max?: number; labelWidth?: number; emptyText?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <Text style={s.empty}>{emptyText}</Text>;
  return (
    <View style={{ gap: 10 }}>
      {items.map((it) => (
        <View key={it.key} style={s.row} accessibilityLabel={`${it.label} ${it.display}`}>
          <View style={[s.labelWrap, { width: labelWidth }]}>
            {it.lead}
            <Text style={s.label} numberOfLines={1}>{it.label}</Text>
          </View>
          <View style={s.track}>
            <View style={[s.bar, { width: `${Math.max(2, (it.value / m) * 100)}%` }]} />
          </View>
          <View style={s.valWrap}>
            <Text style={s.val} numberOfLines={1}>{it.display}</Text>
            {it.sub ? <Text style={s.sub}>{it.sub}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export const Bars = memo(BarsImpl);

/** คอลัมน์แนวตั้ง (เช่น ยอดขายรายชั่วโมง) — ไฮไลต์ช่วงพีค */
export function Columns({ items, height = 110 }: { items: { key: string; label: string; value: number; tip: string }[]; height?: number }) {
  const m = Math.max(1, ...items.map((i) => i.value));
  const peak = items.reduce((a, b) => (b.value > a.value ? b : a), items[0]);
  return (
    <View>
      <View style={[s.cols, { height }]}>
        {items.map((it) => {
          const isPeak = it === peak && it.value > 0;
          return (
            <View key={it.key} style={s.colSlot} accessibilityLabel={it.tip}>
              {isPeak ? <Text style={s.peak}>{it.tip}</Text> : null}
              <View
                style={[
                  s.col,
                  { height: Math.max(it.value > 0 ? 3 : 0, (it.value / m) * (height - 18)) },
                  !isPeak && { backgroundColor: '#A9C1FF' },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={s.colLabels}>
        {items.map((it, i) => (
          <Text key={it.key} style={s.colLabel}>{i % 2 === 0 ? it.label : ''}</Text>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  empty: { fontFamily: font, fontSize: 12, color: colors.faint, paddingVertical: 20, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  labelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontFamily: font, fontSize: 12, color: colors.text, flexShrink: 1 },
  track: { flex: 1, height: 10, justifyContent: 'center' },
  bar: { height: 10, backgroundColor: colors.primary, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  valWrap: { width: 92, alignItems: 'flex-end' },
  val: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text },
  sub: { fontFamily: font, fontSize: 10, color: colors.sub },
  cols: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  colSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  col: { width: '70%', maxWidth: 24, backgroundColor: colors.primary, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  peak: { fontFamily: font, fontSize: 10, color: colors.text, fontWeight: '600', marginBottom: 3, width: 80, textAlign: 'center' },
  colLabels: { flexDirection: 'row', gap: 4, marginTop: 4 },
  colLabel: { flex: 1, textAlign: 'center', fontFamily: font, fontSize: 10, color: colors.faint },
});
