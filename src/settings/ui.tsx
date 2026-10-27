// ชิ้นส่วนหน้าตาที่ใช้ร่วมกันทุกหมวดในหน้าตั้งค่า (การ์ด · ช่องกรอก · สวิตช์ · ปุ่มเลือก · ตัวเลข มม.) + สไตล์ `s`
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { api } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { resizeToDataUrl } from '../components/stock/ImagePicker';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import { useDragScroll } from '../dragScroll';
import { SECTIONS } from '../screens/SettingsScreen';
import { r1 } from './LabelsSection';

// ======================= หมวดต่าง ๆ =======================
export type Upd<T> = (v: Partial<T>) => void;

export type Notify = (kind: Toast['kind'], text: string) => void;

/** ปุ่มอัปโหลดรูป (ย่ออัตโนมัติ) */
export function UploadBtn({ label, onDone }: { label: string; onDone: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const pick = () => {
    if (Platform.OS !== 'web') return;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png,image/webp';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      setBusy(true);
      try {
        onDone((await api.upload(await resizeToDataUrl(f, 800))).url);
      } catch (e) {
        globalThis.alert?.((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    inp.click();
  };
  return <SmallBtn label={label} icon="cloud-upload-outline" busy={busy} onPress={pick} />;
}

/** ปรับขนาด: − ค่า + และปุ่มลัด */
export function Stepper({ value, min, max, step, presets, onChange }: { value: number; min: number; max: number; step: number; presets: number[]; onChange: (v: number) => void }) {
  const clamp = (x: number) => Math.max(min, Math.min(max, x));
  return (
    <View style={[s.row, { flexWrap: 'wrap' }]}>
      <Pressable style={s.arrow} onPress={() => onChange(clamp(value - step))} accessibilityLabel="เล็กลง"><Icon name="remove" size={16} color={colors.text} /></Pressable>
      <Text style={[s.b, { minWidth: 44, textAlign: 'center' }]}>{value}%</Text>
      <Pressable style={s.arrow} onPress={() => onChange(clamp(value + step))} accessibilityLabel="ใหญ่ขึ้น"><Icon name="add" size={16} color={colors.text} /></Pressable>
      <Seg value={value} options={presets.map((p) => [p, `${p}%`] as [number, string])} onChange={(x) => onChange(Number(x))} />
    </View>
  );
}

// ======================= ชิ้นส่วนฟอร์ม =======================
/** คอลัมน์ขวา (ตัวอย่าง / บันทึก) ติดอยู่ด้านบนขณะเลื่อนเนื้อหาฝั่งซ้าย — position: sticky ใช้ได้บนเว็บ */
export const STICKY = { position: 'sticky', top: 0, alignSelf: 'flex-start' } as unknown as ViewStyle;

/** แถบแท็บแนวนอน (จอแคบ): ลากเมาส์ · ล้อเมาส์ · ปุ่มลูกศรซ้าย/ขวา · เลื่อนแท็บที่เลือกให้อยู่ในจอ */
export function TabScroller({ children, active, dragRef }: { children: ReactNode; active: string; dragRef: MutableRefObject<() => boolean> }) {
  const { ref, wasDragged } = useDragScroll();
  dragRef.current = wasDragged;
  const [state, setState] = useState({ x: 0, max: 0 });
  const first = useRef(true);
  const el = () => {
    const sv = ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null;
    return (sv?.getScrollableNode?.() ?? null) as HTMLElement | null;
  };
  const measure = () => {
    const e = el();
    if (e) setState({ x: e.scrollLeft, max: Math.max(0, e.scrollWidth - e.clientWidth) });
  };
  // แท็บที่เลือกอยู่ → เลื่อนให้เห็น
  useEffect(() => {
    // รอ layout เสร็จก่อน (ตอนเปิดหน้าครั้งแรก ขนาดแท็บยังไม่ถูกคำนวณ)
    const t = setTimeout(() => {
      const e = el();
      const i = SECTIONS.findIndex((x) => x.id === active);
      const on = (i >= 0 ? e?.querySelectorAll('[role="tab"]')[i] : null) as HTMLElement | null;
      if (e && on) {
        const box = e.getBoundingClientRect();
        const r = on.getBoundingClientRect();
        if (r.left < box.left || r.right > box.right) e.scrollBy({ left: r.left - box.left - 40, behavior: first.current ? 'auto' : 'smooth' }); // (scrollTo ถูก RN Web ทับไว้ — ใช้ scrollBy)
      }
      first.current = false;
      setTimeout(measure, 350);
    }, 120);
    return () => clearTimeout(t);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const by = (dx: number) => el()?.scrollBy({ left: dx, behavior: 'smooth' });
  const arrow = (dir: -1 | 1) => (
    <Pressable
      onPress={() => by(dir * 260)}
      style={({ hovered }: { hovered?: boolean }) => [s.tabArrow, hovered && { backgroundColor: '#E3EBFF' }]}
      accessibilityLabel={dir < 0 ? 'เลื่อนแท็บไปทางซ้าย' : 'เลื่อนแท็บไปทางขวา'}
    >
      <Icon name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.primary} />
    </Pressable>
  );
  return (
    <View style={[s.row, { gap: 6 }]}>
      {Platform.OS === 'web' && state.max > 0 && state.x > 2 ? arrow(-1) : null}
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}
        onScroll={measure}
        scrollEventThrottle={50}
        onLayout={measure}
        onContentSizeChange={measure}
      >
        {children}
      </ScrollView>
      {Platform.OS === 'web' && state.max > 0 && state.x < state.max - 2 ? arrow(1) : null}
    </View>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/** กริดฟอร์ม: max = จำนวนคอลัมน์สูงสุด (วัดความกว้างจริง → จอแคบลดเหลือ 2 / 1 คอลัมน์) */
export function Grid({ children, max }: { children: ReactNode; max?: number }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const [w, setW] = useState(0);
  if (!max) {
    return (
      <View style={s.grid}>
        {items.map((c, i) => (
          <View key={i} style={s.gridItem}>{c}</View>
        ))}
      </View>
    );
  }
  const GAP = 12;
  const MIN = 220;
  const cols = w ? Math.max(1, Math.min(max, Math.floor((w + GAP) / (MIN + GAP)))) : max;
  const itemW = w ? (w - GAP * (cols - 1)) / cols : undefined;
  return (
    <View style={s.grid} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {items.map((c, i) => (
        <View key={i} style={itemW ? { width: itemW, minWidth: 0 } : s.gridItem}>{c}</View>
      ))}
    </View>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Input({ value, onChange, placeholder, max, multiline, keyboard, secure, compact, onFocus }: {
  value: string; onChange: (t: string) => void; placeholder?: string; max?: number; multiline?: boolean;
  keyboard?: 'number-pad' | 'decimal-pad'; secure?: boolean; compact?: boolean; onFocus?: () => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      onFocus={onFocus}
      placeholder={placeholder}
      placeholderTextColor={colors.faint}
      maxLength={max}
      multiline={multiline}
      keyboardType={keyboard}
      secureTextEntry={secure}
      autoCapitalize="none"
      style={[s.input, multiline && { height: 72, paddingTop: 10, textAlignVertical: 'top' }, compact && { width: 70, textAlign: 'center' }]}
    />
  );
}

export function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[s.track, value && s.trackOn]} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label}>
      <View style={[s.knob, value && { transform: [{ translateX: 18 }] }]} />
    </Pressable>
  );
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable style={s.toggleRow} onPress={() => onChange(!value)}>
      <View style={{ flex: 1 }}>
        <Text style={s.toggleLabel}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onChange={onChange} label={label} />
    </Pressable>
  );
}

export function Seg({ value, options, onChange }: { value: string | number; options: [string | number, string][]; onChange: (v: string | number) => void }) {
  return (
    <View style={s.seg}>
      {options.map(([v, l]) => {
        const on = v === value;
        return (
          <Pressable key={String(v)} onPress={() => onChange(v)} style={[s.segItem, on && s.segOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
            <Text style={[s.segText, on && { color: '#fff', fontWeight: '600' }]}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SmallBtn({ label, icon, onPress, busy, disabled }: { label: string; icon: IconName; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={[s.smallBtn, (disabled || busy) && { opacity: 0.5 }]} onPress={onPress} disabled={disabled || busy} accessibilityLabel={label}>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name={icon} size={15} color={colors.primary} />}
      <Text style={s.smallBtnText}>{label}</Text>
    </Pressable>
  );
}

/** ช่องตัวเลข + ปุ่ม − / + (รองรับทศนิยมตาม step) */
export function NumStep({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const k = 10 ** dec;
  const fmt = (n: number) => String(Math.round(n * k) / k);
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (n: number) => onChange(Math.max(min, Math.min(max, Math.round(n * k) / k)));
  return (
    <View style={s.row}>
      <Pressable style={s.arrow} onPress={() => commit(value - step)} accessibilityLabel="ลด"><Icon name="remove" size={16} color={colors.text} /></Pressable>
      <TextInput
        value={text}
        onChangeText={(t) => setText(t.replace(dec ? /[^0-9.]/g : /[^0-9]/g, '').slice(0, 6))}
        onBlur={() => (text.trim() === '' || !Number.isFinite(Number(text)) ? setText(fmt(value)) : commit(Number(text)))}
        onSubmitEditing={() => Number.isFinite(Number(text)) && commit(Number(text))}
        keyboardType={dec ? 'decimal-pad' : 'number-pad'}
        selectTextOnFocus
        style={[s.input, { width: 72, textAlign: 'center', paddingHorizontal: 4 }]}
      />
      <Pressable style={s.arrow} onPress={() => commit(value + step)} accessibilityLabel="เพิ่ม"><Icon name="add" size={16} color={colors.text} /></Pressable>
    </View>
  );
}

/** ช่องกรอกตัวเลข (มม.) — พิมพ์อิสระ ยืนยันเมื่อออกจากช่อง/กด Enter · ค่าไม่ถูกต้องจะคืนค่าเดิม */
export function MmInput({ value, onCommit, int }: { value: number; onCommit: (n: number) => boolean; int?: boolean }) {
  const fmt = (n: number) => String(r1(n));
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n) || n < 0 || !onCommit(int ? Math.round(n) : r1(n))) setText(fmt(value));
  };
  return (
    <TextInput
      value={text}
      onChangeText={(t) => setText(t.replace(int ? /[^0-9]/g : /[^0-9.]/g, '').slice(0, 6))}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType={int ? 'number-pad' : 'decimal-pad'}
      selectTextOnFocus
      style={s.input}
    />
  );
}

/** รูปที่สูงตามสัดส่วนจริง */
export function AutoImage({ uri, width, maxHeight }: { uri: string; width: number; maxHeight?: number }) {
  const [ratio, setRatio] = useState(3);
  useEffect(() => {
    let alive = true;
    Image.getSize?.(uri, (w, h) => alive && h > 0 && setRatio(w / h), () => {});
    return () => {
      alive = false;
    };
  }, [uri]);
  let w = width;
  let h = width / ratio;
  if (maxHeight && h > maxHeight) {
    h = maxHeight;
    w = maxHeight * ratio;
  }
  return <Image source={{ uri }} style={{ width: w, height: h }} resizeMode="contain" />;
}

export const s = StyleSheet.create({
  shopPhoto: { width: 96, height: 72, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  sub: { fontFamily: font, fontSize: 12, color: colors.sub, lineHeight: 18 },
  error: { fontFamily: font, color: colors.danger },
  navCol: { gap: 6 },
  navRow: { flexDirection: 'row', gap: 6 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  navSub: { height: 40, marginLeft: 18, paddingHorizontal: 10, gap: 8 },
  tabArrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, flexShrink: 0 },
  navChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surface },
  navOn: { backgroundColor: colors.primary },
  navText: { fontFamily: font, fontSize: 13, color: colors.text, flexShrink: 1 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  secTitle: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, gap: 12, backgroundColor: '#fff' },
  cardTitle: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  field: { gap: 6, minWidth: 0 },
  gridItem: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
  label: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  hint: { fontFamily: font, fontSize: 11, color: colors.sub, lineHeight: 16 },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  toggleLabel: { fontFamily: font, fontSize: 14, color: colors.text },
  track: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.line, padding: 3 },
  trackOn: { backgroundColor: colors.success },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  segOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText: { fontFamily: font, fontSize: 12, color: colors.text },
  p: { fontFamily: font, fontSize: 13, color: colors.text, lineHeight: 20 },
  b: { fontFamily: font, fontWeight: '700', color: colors.text },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  code: { fontFamily: Platform.select({ web: 'ui-monospace, Menlo, Consolas, monospace', default: undefined }), fontSize: 12, color: colors.text },
  infoBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, gap: 4 },
  payGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  optTitle: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  payCard: { flexGrow: 1, flexBasis: 320, minWidth: 0, gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  payCardOn: { borderColor: '#D6E2FF' },
  payIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  arrow: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  unitBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unit: { fontFamily: font, fontSize: 12, color: colors.sub },
  preview: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  paper: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, padding: 12, gap: 3, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  pText: { fontFamily: font, color: '#111' },
  pc: { textAlign: 'center' },
  pRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  dash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#999', marginVertical: 4 },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  dot: { width: 10, height: 10, borderRadius: 5 },
  copyBox: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  revoke: { paddingHorizontal: 10, height: 30, borderRadius: radius.pill, borderWidth: 1, borderColor: '#F3C4C6', justifyContent: 'center' },
  apiRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingVertical: 4 },
  method: { fontFamily: font, fontSize: 10, fontWeight: '700', color: colors.success, backgroundColor: colors.successSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  logoBox: { width: 130, height: 76, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  blockBox: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 10, gap: 8, backgroundColor: colors.surface },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  summary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 10, borderRadius: radius.pill },
  pillText: { fontFamily: font, fontSize: 12, fontWeight: '600' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.primary },
  tabText: { fontFamily: font, fontSize: 13, color: colors.sub },
  evRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F2F4F7', flexWrap: 'wrap' },
  evIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  chText: { fontFamily: font, fontSize: 12, color: colors.text },
  evChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  evChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  phBox: { backgroundColor: '#F4F7FF', borderRadius: radius.md, padding: 10, gap: 8, borderWidth: 1, borderColor: '#DCE6FF' },
  phChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 9, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9D8FF' },
  phText: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '600' },
  emoji: { minWidth: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#fff' },
  swatchOn: { borderColor: colors.text, boxShadow: '0 0 0 2px #fff inset' } as object,
  swatchAuto: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 8, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.line },
  swatchDot: { width: 16, height: 16, borderRadius: 8 },
  lineEdit: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  previewBox: { gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: '#ECECE8', alignItems: 'center' },
  previewPaper: { backgroundColor: '#fff', padding: 6 },
  previewEmpty: { alignItems: 'center', justifyContent: 'center', gap: 8, height: 160, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.surface },
  profileChip: { minWidth: 150, maxWidth: 240, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', gap: 2 },
  profileOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  profileName: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  presetChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  presetMine: { borderColor: '#C9D8FF', backgroundColor: '#F7F9FF', position: 'relative' },
  presetDel: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  presetT: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text },
  dd: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ddT: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.sub },
  ddList: { marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: '#fff', overflow: 'hidden' },
  ddItem: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F2F4F7' },
  ddHover: { backgroundColor: colors.surface },
  ddOn: { backgroundColor: colors.primarySoft },
  ddDel: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  ddInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: '#D5E1FF', backgroundColor: colors.primarySoft },
  linkTitle: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.primary },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  smallBtnText: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '600' },
  saveBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.line },
  ghostBtn: { height: 44, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  ghostText: { fontFamily: font, fontSize: 14, color: colors.text },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.primary },
  primaryText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '700' },
});
