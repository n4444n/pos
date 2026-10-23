import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { baht, moneyInput } from '../../format';
import { colors, font, radius } from '../../theme';
import { Icon } from '../Icon';

/** ธนบัตร/เหรียญไทยที่ร้านใช้ — สีตามธนบัตรจริง ช่วยหาเร็ว (ไม่มี 50 / 25 สตางค์) */
const NOTES: { d: number; bg: string; fg: string }[] = [
  { d: 1000, bg: '#EDE7E1', fg: '#6B4A2E' },
  { d: 500, bg: '#EEE6FB', fg: '#6B3FC4' },
  { d: 100, bg: '#FDE7E7', fg: '#C62828' },
  { d: 50, bg: '#E3EEFD', fg: '#1E5BC6' },
  { d: 20, bg: '#E3F5EA', fg: '#1F7A45' },
];
const COINS: { d: number; bg: string; fg: string }[] = [
  { d: 10, bg: '#FFF1CF', fg: '#9A6B00' },
  { d: 5, bg: '#EEF0F3', fg: '#4B5563' },
  { d: 2, bg: '#FFF1CF', fg: '#9A6B00' },
  { d: 1, bg: '#EEF0F3', fg: '#4B5563' },
];
const ALL = [...NOTES, ...COINS];
const label = (d: number) => d.toLocaleString();

/** ช่องแคบสุดที่ยังกด +/− และอ่านตัวเลขได้สบาย (ช่องแบบ 2 ชั้น: ชนิดเงิน+ยอด / ปุ่ม −จำนวน+) */
const TILE_MIN = 118;
const GAP = 6;
/** 3×3 (9 ชนิด) ถ้ากว้างพอ → 2 → 1 (วัดจากความกว้างจริงของกล่อง ไม่ใช่ความกว้างจอ เพราะอยู่ในหน้าต่างป๊อปอัป) */
const colsFor = (w: number) => (w >= TILE_MIN * 3 + GAP * 2 ? 3 : w >= TILE_MIN * 2 + GAP ? 2 : 1);

interface Props {
  /** ยอดรวม (ถ้ากรอกเอง) */
  total: string;
  onChange: (total: number | null, denominations: Record<string, number> | null) => void;
  initialMode?: 'count' | 'total';
  autoFocus?: boolean;
}

/**
 * แจงเงินในลิ้นชัก: นับธนบัตร/เหรียญทีละชนิด (ระบบรวมให้) หรือกรอกยอดรวมเอง
 */
export function CashCounter({ total, onChange, initialMode = 'count', autoFocus }: Props) {
  const [mode, setMode] = useState<'count' | 'total'>(initialMode);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState(total);
  const [gridW, setGridW] = useState(0);
  const cols = gridW ? colsFor(gridW) : 3;
  const tileW = gridW ? Math.floor((gridW - GAP * (cols - 1)) / cols) : undefined;

  const sum = Math.round(ALL.reduce((a, x) => a + x.d * (Number(counts[x.d]) || 0), 0) * 100) / 100;
  const pieces = ALL.reduce((a, x) => a + (Number(counts[x.d]) || 0), 0);

  useEffect(() => {
    if (mode === 'count') {
      const den: Record<string, number> = {};
      for (const [k, v] of Object.entries(counts)) if (Number(v) > 0) den[k] = Number(v);
      onChange(Object.keys(den).length ? sum : null, Object.keys(den).length ? den : null);
    } else {
      onChange(typed === '' || typed === '.' ? null : Number(typed), null);
    }
  }, [mode, counts, typed]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCount = (d: number, v: string) => setCounts((c) => ({ ...c, [d]: v.replace(/[^0-9]/g, '').slice(0, 5) }));
  const step = (d: number, by: number) => setCount(d, String(Math.max(0, (Number(counts[d]) || 0) + by)));

  const tile = (x: { d: number; bg: string; fg: string }, coin: boolean, i: number) => {
    const n = Number(counts[x.d]) || 0;
    return (
      <View key={x.d} style={[s.tile, tileW ? { width: tileW } : s.tileFallback, n > 0 && { borderColor: x.fg + '66', backgroundColor: x.bg + '66' }]}>
        <View style={s.tileTop}>
          <View style={[s.denom, { backgroundColor: x.bg }, coin && s.coin]}>
            <Text style={[s.denomText, { color: x.fg }]}>{label(x.d)}</Text>
          </View>
          <Text style={[s.sub, n === 0 && { color: colors.faint }]} numberOfLines={1}>= {baht(x.d * n)}</Text>
        </View>
        <View>
          <View style={s.stepper}>
            <Pressable style={s.stepBtn} onPress={() => step(x.d, -1)} accessibilityLabel={`ลด ${label(x.d)}`}>
              <Icon name="remove" size={13} color={colors.sub} />
            </Pressable>
            <TextInput
              value={counts[x.d] ?? ''}
              onChangeText={(v) => setCount(x.d, v)}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              selectTextOnFocus
              autoFocus={autoFocus && i === 0}
              style={s.countInput}
              accessibilityLabel={`จำนวน ${label(x.d)} บาท`}
            />
            <Pressable style={s.stepBtn} onPress={() => step(x.d, 1)} accessibilityLabel={`เพิ่ม ${label(x.d)}`}>
              <Icon name="add" size={13} color={colors.sub} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={s.tabs}>
        {(['count', 'total'] as const).map((m) => (
          <Pressable key={m} style={[s.tab, mode === m && s.tabOn]} onPress={() => setMode(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
            <Icon name={m === 'count' ? 'grid-outline' : 'keypad-outline'} size={14} color={mode === m ? colors.text : colors.sub} />
            <Text style={[s.tabText, mode === m && s.tabTextOn]}>{m === 'count' ? 'แจงธนบัตร / เหรียญ' : 'กรอกยอดรวม'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'count' ? (
        <>
          <View style={s.totalBox}>
            <View style={{ flexShrink: 1 }}>
              <Text style={s.totalLabel}>รวมเงินในลิ้นชัก</Text>
              <Text style={s.hint}>{pieces ? `${pieces.toLocaleString()} ใบ / เหรียญ` : 'ใส่จำนวนธนบัตร/เหรียญแต่ละชนิด'}</Text>
            </View>
            <Text style={s.totalValue}>{baht(sum)}</Text>
          </View>
          {/* 9 ชนิดในกริดเดียว: 3 × 3 */}
          <View style={s.grid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
            {NOTES.map((x, i) => tile(x, false, i))}
            {COINS.map((x, i) => tile(x, true, NOTES.length + i))}
          </View>
          {pieces ? (
            <Pressable onPress={() => setCounts({})} style={{ alignSelf: 'flex-end' }} accessibilityLabel="ล้างจำนวนทั้งหมด">
              <Text style={[s.hint, { color: colors.danger }]}>ล้างทั้งหมด</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <TextInput
          value={typed}
          onChangeText={(t) => setTyped((c) => moneyInput(t, c))}
          placeholder="0.00"
          placeholderTextColor={colors.faint}
          keyboardType="decimal-pad"
          style={s.bigInput}
          autoFocus
          accessibilityLabel="ยอดเงินรวม"
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3 },
  tab: { flex: 1, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontFamily: font, fontSize: 12, color: colors.sub },
  tabTextOn: { color: colors.text, fontWeight: '600' },
  totalBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14 },
  totalLabel: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  totalValue: { fontFamily: font, fontSize: 26, fontWeight: '700', color: colors.text },
  hint: { fontFamily: font, fontSize: 11, color: colors.sub },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  /** ก่อนวัดขนาดได้ (เฟรมแรก) */
  tileFallback: { flexGrow: 1, flexBasis: '31%', maxWidth: '33%', minWidth: TILE_MIN },
  tile: { gap: 6, padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  denom: { minWidth: 52, height: 30, paddingHorizontal: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  coin: { minWidth: 30, width: 30, height: 30, borderRadius: 15, paddingHorizontal: 0 },
  denomText: { fontFamily: font, fontSize: 14, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 2 },
  stepBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  countInput: { flex: 1, minWidth: 0, textAlign: 'center', fontFamily: font, fontSize: 15, fontWeight: '600', color: colors.text, outlineStyle: 'none' } as object,
  sub: { fontFamily: font, fontSize: 11, color: colors.sub, textAlign: 'right', flexShrink: 1 },
  bigInput: {
    fontFamily: font, fontSize: 28, fontWeight: '600', color: colors.text, height: 64, borderRadius: radius.md,
    backgroundColor: colors.surface, paddingHorizontal: 16, textAlign: 'right',
  },
});
