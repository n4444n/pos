// ส่วนประกอบที่ใช้ร่วมกันของหน้ารายงานย่อย (ยอดขาย / สินค้า): โครงหน้า · ช่วงเวลา · สาขา · ตาราง · แบ่งหน้า
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { api, type Branch } from '../../api';
import { useAppSettings } from '../../appSettings';
import { isoDate } from '../../format';
import { colors, font, radius } from '../../theme';
import { DateField } from '../DateField';
import { Icon, type IconName } from '../Icon';
import { NavDrawer, Sidebar, type Route } from '../NavMenu';
import { Sheet } from '../Sheet';

// ---------- ช่วงเวลา ----------
export type PeriodId = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'year' | 'custom';
export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'today', label: 'วันนี้' },
  { id: 'yesterday', label: 'เมื่อวาน' },
  { id: '7d', label: '7 วันล่าสุด' },
  { id: '30d', label: '30 วันล่าสุด' },
  { id: 'month', label: 'เดือนนี้' },
  { id: 'lastMonth', label: 'เดือนที่แล้ว' },
  { id: 'year', label: 'ปีนี้' },
  { id: 'custom', label: 'กำหนดเอง' },
];
export function rangeOf(p: PeriodId): { from: string; to: string } {
  const t = new Date();
  const d = (y: number, m: number, day: number) => isoDate(new Date(y, m, day));
  const [Y, M, D] = [t.getFullYear(), t.getMonth(), t.getDate()];
  switch (p) {
    case 'today': return { from: d(Y, M, D), to: d(Y, M, D) };
    case 'yesterday': return { from: d(Y, M, D - 1), to: d(Y, M, D - 1) };
    case '7d': return { from: d(Y, M, D - 6), to: d(Y, M, D) };
    case '30d': return { from: d(Y, M, D - 29), to: d(Y, M, D) };
    case 'month': return { from: d(Y, M, 1), to: d(Y, M, D) };
    case 'lastMonth': return { from: d(Y, M - 1, 1), to: d(Y, M, 0) };
    case 'year': return { from: d(Y, 0, 1), to: d(Y, M, D) };
    default: return { from: d(Y, M, D - 6), to: d(Y, M, D) };
  }
}
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/** 15 ต.ค. 2026 */
export const dayText = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
export const rangeText = (r: { from: string; to: string }) => (r.from === r.to ? dayText(r.from) : `${dayText(r.from)} – ${dayText(r.to)}`);

// ---------- ส่งตัวกรองข้ามหน้ารายงาน ----------
// เช่น คลิกวันในรายงานยอดขาย → เปิดรายงานรายบิลของวันนั้น (หน้าใหม่อ่านค่าตอนเปิด แล้วล้างทิ้ง)
export interface ReportHandoff { from: string; to: string; branch: string }
let handoff: ReportHandoff | null = null;
export function setReportHandoff(h: ReportHandoff) {
  handoff = h;
}
/** อ่านค่าที่ส่งมา (ครั้งเดียว) — เรียกตอนสร้าง state เริ่มต้นของหน้า แล้ว clearReportHandoff() หลัง mount */
export function peekReportHandoff() {
  return handoff;
}
export function clearReportHandoff() {
  handoff = null;
}

export function usePeriod(initial: PeriodId = 'month', preset?: { from: string; to: string } | null) {
  // preset = ช่วงวันที่ที่ส่งมาจากหน้าอื่น → เริ่มที่ "กำหนดเอง"
  const [period, setPeriod] = useState<PeriodId>(preset ? 'custom' : initial);
  const [custom, setCustom] = useState(() => preset ?? rangeOf(initial));
  const range = period === 'custom' ? custom : rangeOf(period);
  return { period, setPeriod, custom, setCustom, range };
}

/** ปุ่มเลือกช่วงเวลา (+ ช่องวันที่เมื่อเลือก "กำหนดเอง") */
export function PeriodControl({ p }: { p: ReturnType<typeof usePeriod> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={k.pill} onPress={() => setOpen(true)} accessibilityLabel="เลือกช่วงเวลา">
        <Icon name="calendar-outline" size={16} color={colors.primary} />
        <Text style={k.pillText}>{PERIODS.find((x) => x.id === p.period)!.label}</Text>
        <Icon name="chevron-down" size={14} color={colors.sub} />
      </Pressable>
      {p.period === 'custom' ? (
        <View style={k.row}>
          <DateField type="date" label="ตั้งแต่วันที่" value={p.custom.from} onChange={(v) => p.setCustom((c) => ({ ...c, from: v }))} width={150} />
          <Text style={{ color: colors.sub }}>–</Text>
          <DateField type="date" label="ถึงวันที่" value={p.custom.to} onChange={(v) => p.setCustom((c) => ({ ...c, to: v }))} width={150} />
        </View>
      ) : (
        <Text style={k.note}>{rangeText(p.range)}</Text>
      )}
      <Sheet visible={open} onClose={() => setOpen(false)} title="เลือกช่วงเวลา" width={360}>
        <View style={{ gap: 6, paddingBottom: 8 }}>
          {PERIODS.map((x) => {
            const on = x.id === p.period;
            return (
              <Pressable key={x.id} style={[k.opt, on && k.optOn]} onPress={() => { p.setPeriod(x.id); setOpen(false); }}>
                <Text style={[k.optText, on && { color: colors.primary, fontWeight: '600' }]}>{x.label}</Text>
                {x.id !== 'custom' ? <Text style={k.note}>{rangeText(rangeOf(x.id))}</Text> : null}
                {on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

// ---------- สาขา ----------
/** '' = สาขาปัจจุบัน · 'all' = รวมทุกสาขา · '<id>' = สาขาที่เลือก */
export function useBranchScope(initial = '') {
  const [scope, setScope] = useState(initial);
  const [branches, setBranches] = useState<Branch[]>([]);
  const appBranch = useAppSettings().branch;
  useEffect(() => {
    api.branchManage().then((r) => setBranches(r.list), () => {});
  }, []);
  const label = scope === 'all' ? 'รวมทุกสาขา' : branches.find((b) => String(b.id) === scope)?.name ?? appBranch.name ?? 'สาขานี้';
  return { scope, setScope, branches, label, appBranch };
}

export function BranchControl({ b }: { b: ReturnType<typeof useBranchScope> }) {
  const [open, setOpen] = useState(false);
  if (b.branches.length < 2) return null;
  const opts = [
    { id: '', label: `สาขาปัจจุบัน (${b.appBranch.name || '-'})`, icon: 'location-outline' as const },
    { id: 'all', label: 'รวมทุกสาขา', icon: 'git-network-outline' as const },
    ...b.branches.filter((x) => x.id !== b.appBranch.id).map((x) => ({ id: String(x.id), label: `${x.name} (${x.code})`, icon: 'storefront-outline' as const })),
  ];
  return (
    <>
      <Pressable style={[k.pill, b.scope === 'all' && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]} onPress={() => setOpen(true)} accessibilityLabel={`สาขา: ${b.label}`}>
        <Icon name={b.scope === 'all' ? 'git-network-outline' : 'location-outline'} size={16} color={colors.primary} />
        <Text style={k.pillText} numberOfLines={1}>{b.label}</Text>
        <Icon name="chevron-down" size={14} color={colors.sub} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="รายงานของสาขา" width={380}>
        <View style={{ gap: 6, paddingBottom: 8 }}>
          {opts.map((o) => {
            const on = o.id === b.scope;
            return (
              <Pressable key={o.id || 'cur'} onPress={() => { b.setScope(o.id); setOpen(false); }} style={[k.opt, on && k.optOn]}>
                <Icon name={o.icon} size={18} color={on ? colors.primary : colors.sub} />
                <Text style={[k.optText, on && { color: colors.primary, fontWeight: '600' }]}>{o.label}</Text>
                {on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

// ---------- โครงหน้า ----------
export function ReportPage({ route, title, sub, onNavigate, right, children }: {
  route: Route; title: string; sub?: string; onNavigate: (r: Route) => void; right?: ReactNode; children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  return (
    <View style={[k.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route={route} onNavigate={onNavigate} /> : null}
      <View style={[k.main, mobile && { padding: 10 }]}>
        <View style={k.header}>
          <View style={[k.row, { flexShrink: 1 }]}>
            <Pressable style={k.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <View style={{ flexShrink: 1 }}>
              <Text style={k.title} numberOfLines={1}>{title}</Text>
              {sub ? <Text style={k.note} numberOfLines={1}>{sub}</Text> : null}
            </View>
          </View>
          {right}
        </View>
        {children}
      </View>
      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route={route} onNavigate={onNavigate} />
    </View>
  );
}

/** ปุ่มส่งออก Excel (เปิดลิงก์ดาวน์โหลด) */
export function ExcelButton({ url, disabled }: { url: () => string; disabled?: boolean }) {
  return (
    <Pressable
      style={[k.excel, disabled && { opacity: 0.5 }]}
      disabled={disabled}
      onPress={() => {
        if (Platform.OS === 'web') window.open(url(), '_blank');
      }}
      accessibilityLabel="ส่งออก Excel"
    >
      <Icon name="grid-outline" size={17} color={colors.success} />
      <Text style={[k.pillText, { color: colors.success, fontWeight: '700' }]}>ส่งออก Excel</Text>
    </Pressable>
  );
}

// ---------- ตาราง ----------
export interface Column<T> {
  id: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
  /** ค่ารวมท้ายตาราง */
  total?: ReactNode;
  sortable?: boolean;
}

export function DataTable<T>({ cols, rows, keyOf, sort, onSort, empty, renderAfter, rowStyle, onRowPress, rowHint }: {
  cols: Column<T>[];
  rows: T[];
  keyOf: (r: T) => string;
  sort?: { id: string; dir: 'asc' | 'desc' };
  onSort?: (id: string) => void;
  empty?: string;
  /** แถวเพิ่มเติมใต้แถว (เช่น รายการ SKU ที่กางออก) */
  renderAfter?: (r: T) => ReactNode;
  rowStyle?: (r: T) => object | undefined;
  /** กดทั้งแถวได้ (เช่น เปิดรายละเอียด) */
  onRowPress?: (r: T) => void;
  /** คำอธิบายปุ่มแถว (accessibility) */
  rowHint?: (r: T) => string;
}) {
  const base = cols.reduce((a, c) => a + c.width, 0);
  // จอกว้างกว่าตาราง → ขยายทุกคอลัมน์ตามสัดส่วนให้เต็มพื้นที่ · จอแคบ → เลื่อนซ้าย-ขวา
  const [avail, setAvail] = useState(0);
  const scale = avail > base ? avail / base : 1;
  const w = (c: Column<T>) => Math.floor(c.width * scale);
  const width = cols.reduce((a, c) => a + w(c), 0);
  const hasTotal = cols.some((c) => c.total !== undefined);
  const cell = (c: Column<T>, content: ReactNode, bold = false) => (
    <View key={c.id} style={[k.td, { width: w(c), alignItems: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' }]}>
      {typeof content === 'string' || typeof content === 'number' ? (
        <Text style={[k.tdText, bold && { fontWeight: '700' }, c.align === 'right' && { textAlign: 'right' }, c.align === 'center' && { textAlign: 'center' }]} numberOfLines={2}>{content}</Text>
      ) : (
        content
      )}
    </View>
  );
  return (
    <View onLayout={(e) => setAvail(Math.floor(e.nativeEvent.layout.width))}>
    <ScrollView horizontal style={{ flexGrow: 0 }}>
      <View style={{ width: Math.max(width, 1) }}>
        <View style={k.thead}>
          {cols.map((c) => {
            const on = sort?.id === c.id;
            const inner = (
              <View style={[k.row, { gap: 4, justifyContent: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' }]}>
                {/* คอลัมน์กึ่งกลาง: เว้นที่ซ้ายเท่าไอคอนเรียง → ชื่อหัวคอลัมน์ตรงกลางพอดีกับข้อมูล */}
                {c.align === 'center' && c.sortable && onSort ? <View style={{ width: 12 }} /> : null}
                <Text style={[k.th, on && { color: colors.primary }]} numberOfLines={1}>{c.label}</Text>
                {c.sortable && onSort ? (
                  <Icon name={on ? (sort!.dir === 'asc' ? 'caret-up' : 'caret-down') : 'swap-vertical'} size={12} color={on ? colors.primary : colors.faint} />
                ) : null}
              </View>
            );
            return c.sortable && onSort ? (
              <Pressable key={c.id} style={[k.thCell, { width: w(c) }]} onPress={() => onSort(c.id)} accessibilityRole="button" accessibilityLabel={`เรียงตาม ${c.label}`}>
                {inner}
              </Pressable>
            ) : (
              <View key={c.id} style={[k.thCell, { width: w(c) }]}>{inner}</View>
            );
          })}
        </View>
        {rows.length === 0 ? <Text style={k.empty}>{empty ?? 'ไม่มีข้อมูล'}</Text> : null}
        {rows.map((r) => (
          <View key={keyOf(r)}>
            {onRowPress ? (
              <Pressable
                onPress={() => onRowPress(r)}
                style={({ hovered }: { hovered?: boolean }) => [k.tr, rowStyle?.(r), hovered && { backgroundColor: colors.primarySoft }]}
                accessibilityRole="button"
                accessibilityLabel={rowHint?.(r)}
              >
                {cols.map((c) => cell(c, c.render(r)))}
              </Pressable>
            ) : (
              <View style={[k.tr, rowStyle?.(r)]}>{cols.map((c) => cell(c, c.render(r)))}</View>
            )}
            {renderAfter?.(r)}
          </View>
        ))}
        {hasTotal && rows.length ? <View style={[k.tr, k.totalRow]}>{cols.map((c) => cell(c, c.total ?? '', true))}</View> : null}
      </View>
    </ScrollView>
    </View>
  );
}

export function Pager({ page, pages, onPage, info }: { page: number; pages: number; onPage: (p: number) => void; info?: string }) {
  if (pages <= 1 && !info) return null;
  const nums: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <View style={[k.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
      <Text style={k.note}>{info}</Text>
      {pages > 1 ? (
        <View style={[k.row, { gap: 4 }]}>
          <PageBtn label="ก่อนหน้า" disabled={page <= 1} onPress={() => onPage(page - 1)} />
          {nums.map((n) => (
            <PageBtn key={n} label={String(n)} on={n === page} onPress={() => onPage(n)} />
          ))}
          <PageBtn label="ถัดไป" disabled={page >= pages} onPress={() => onPage(page + 1)} />
        </View>
      ) : null}
    </View>
  );
}
function PageBtn({ label, on, disabled, onPress }: { label: string; on?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[k.pageBtn, on && { backgroundColor: colors.primary, borderColor: colors.primary }, disabled && { opacity: 0.4 }]} disabled={disabled || on} onPress={onPress}>
      <Text style={[k.pillText, on && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

/** ปุ่มติ๊กเลือก */
export function Check({ on, label, onPress, icon }: { on: boolean; label: string; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable style={[k.pill, on && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <Icon name={icon ?? (on ? 'checkbox' : 'square-outline')} size={17} color={on ? colors.primary : colors.sub} />
      <Text style={[k.pillText, on && { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

export const k = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  note: { fontFamily: font, fontSize: 12, color: colors.sub },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel },
  pillText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  excel: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.successSoft },
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3 },
  segBtn: { paddingHorizontal: 16, height: 34, borderRadius: radius.pill, justifyContent: 'center' },
  segOn: { backgroundColor: colors.primary },
  segText: { fontFamily: font, fontSize: 13, color: colors.sub },
  search: { fontFamily: font, fontSize: 13, height: 40, minWidth: 220, flexGrow: 1, flexBasis: 220, maxWidth: 360, borderRadius: radius.pill, backgroundColor: colors.surface, paddingHorizontal: 16, color: colors.text },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 46, borderRadius: radius.md, backgroundColor: colors.surface },
  optOn: { backgroundColor: colors.primarySoft },
  optText: { fontFamily: font, fontSize: 14, color: colors.text, flex: 1 },
  thead: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.sm },
  thCell: { paddingHorizontal: 10, paddingVertical: 10, justifyContent: 'center' },
  th: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  td: { paddingHorizontal: 10, paddingVertical: 9, justifyContent: 'center' },
  tdText: { fontFamily: font, fontSize: 13, color: colors.text },
  totalRow: { backgroundColor: colors.surface, borderBottomWidth: 0, borderRadius: radius.sm },
  empty: { fontFamily: font, fontSize: 13, color: colors.faint, textAlign: 'center', paddingVertical: 30 },
  pageBtn: { minWidth: 36, height: 34, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, backgroundColor: colors.dangerSoft, padding: 10, borderRadius: radius.md },
});
