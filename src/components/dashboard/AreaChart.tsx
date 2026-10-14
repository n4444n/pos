import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { compact } from '../../format';
import { colors, font, radius } from '../../theme';

/**
 * กราฟพื้นที่ (area) ช่วงปัจจุบัน + เส้นประช่วงก่อนหน้า
 * - SVG ใช้ viewBox + preserveAspectRatio="none" → ยืดเต็มกว้างโดยไม่ต้องวัดขนาด
 * - เส้นหนาคงที่ 2px (vectorEffect non-scaling-stroke)
 * - hover (เว็บ) / แตะ (มือถือ) → crosshair + tooltip
 */
interface Props {
  values: number[];
  prev?: number[];
  labels: string[];
  /** ป้ายใน tooltip (ยาวกว่า labels) */
  tipLabels?: string[];
  format: (n: number) => string;
  height?: number;
  color?: string;
}

const VW = 1000;
const PRIMARY = colors.primary;
const PREV = '#A0A6B1';

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

/** เส้นโค้งแบบ monotone (ไม่พุ่งเกินจุดข้อมูล) */
function monotonePath(pts: [number, number][]) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

function AreaChartImpl({ values, prev, labels, tipLabels, format, height = 220, color = PRIMARY }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const n = values.length;
  const max = niceMax(Math.max(1, ...values, ...(prev ?? [])));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  const { line, area, prevLine } = useMemo(() => {
    const x = (i: number) => (n === 1 ? VW / 2 : (i / (n - 1)) * VW);
    const y = (v: number) => height - (v / max) * height;
    const pts = values.map((v, i) => [x(i), y(v)] as [number, number]);
    const l = monotonePath(pts);
    const a = n ? `${l} L${x(n - 1)},${height} L${x(0)},${height} Z` : '';
    const pp = prev && prev.length ? monotonePath(prev.slice(0, n).map((v, i) => [x(i), y(v)] as [number, number])) : '';
    return { line: l, area: a, prevLine: pp };
  }, [values, prev, n, max, height]);

  // แสดงป้ายแกน X ประมาณ 6 ตำแหน่ง
  const every = Math.max(1, Math.ceil(n / 6));
  const pctX = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);

  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        {/* แกน Y */}
        <View style={[s.yAxis, { height }]}>
          {ticks
            .slice()
            .reverse()
            .map((t, i) => (
              <Text key={i} style={s.yLabel}>
                {compact(t)}
              </Text>
            ))}
        </View>

        <View style={{ flex: 1, height }}>
          {/* gridlines */}
          {ticks.map((t, i) => (
            <View key={i} style={[s.grid, { top: height - (t / max) * height }]} />
          ))}

          <Svg width="100%" height={height} viewBox={`0 0 ${VW} ${height}`} preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.18} />
                <Stop offset="1" stopColor={color} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            {prevLine ? (
              <Path d={prevLine} fill="none" stroke={PREV} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
            ) : null}
            <Path d={area} fill="url(#areaFill)" />
            <Path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          </Svg>

          {/* crosshair + จุด */}
          {active != null && n > 0 ? (
            <>
              <View pointerEvents="none" style={[s.cross, { left: `${pctX(active)}%` }]} />
              <View
                pointerEvents="none"
                style={[s.dot, { left: `${pctX(active)}%`, top: height - (values[active] / max) * height, borderColor: color }]}
              />
              <View
                pointerEvents="none"
                style={[
                  s.tip,
                  pctX(active) > 60 ? { right: `${100 - pctX(active)}%`, marginRight: 10 } : { left: `${pctX(active)}%`, marginLeft: 10 },
                ]}
              >
                <Text style={s.tipTitle}>{(tipLabels ?? labels)[active]}</Text>
                <View style={s.tipRow}>
                  <View style={[s.key, { backgroundColor: color }]} />
                  <Text style={s.tipText}>ช่วงนี้</Text>
                  <Text style={s.tipVal}>{format(values[active])}</Text>
                </View>
                {prev && prev[active] != null ? (
                  <View style={s.tipRow}>
                    <View style={[s.key, { backgroundColor: PREV }]} />
                    <Text style={s.tipText}>ช่วงก่อน</Text>
                    <Text style={s.tipVal}>{format(prev[active])}</Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          {/* พื้นที่รับ hover/แตะ: 1 ช่องต่อ 1 จุดข้อมูล (ใหญ่กว่าจุดมาก) */}
          <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
            {values.map((_, i) => (
              <Pressable
                key={i}
                style={{ flex: 1 }}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive((a) => (a === i ? null : a))}
                onPressIn={() => setActive(i)}
                accessibilityLabel={`${(tipLabels ?? labels)[i]} ${format(values[i])}`}
              />
            ))}
          </View>
        </View>
      </View>

      {/* แกน X */}
      <View style={s.xAxis}>
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <Text key={i} style={[s.xLabel, { left: `${pctX(i)}%` }]} numberOfLines={1}>
              {l}
            </Text>
          ) : null,
        )}
      </View>
    </View>
  );
}

export const AreaChart = memo(AreaChartImpl);

const s = StyleSheet.create({
  yAxis: { width: 42, justifyContent: 'space-between', marginTop: -7, marginBottom: -7 },
  yLabel: { fontFamily: font, fontSize: 10, color: colors.faint, textAlign: 'right', paddingRight: 8 },
  grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#EEF0F4' },
  cross: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#C9D3E8' },
  dot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6, marginTop: -6, backgroundColor: '#fff', borderWidth: 3 },
  tip: {
    position: 'absolute', top: 6, backgroundColor: '#fff', borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.line, minWidth: 150, gap: 4,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  tipTitle: { fontFamily: font, fontSize: 11, color: colors.sub },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  key: { width: 10, height: 3, borderRadius: 2 },
  tipText: { fontFamily: font, fontSize: 12, color: colors.sub, flex: 1 },
  tipVal: { fontFamily: font, fontSize: 12, fontWeight: '700', color: colors.text },
  xAxis: { height: 22, marginLeft: 42, marginTop: 6 },
  xLabel: { position: 'absolute', fontFamily: font, fontSize: 10, color: colors.faint, width: 60, marginLeft: -30, textAlign: 'center' },
});
