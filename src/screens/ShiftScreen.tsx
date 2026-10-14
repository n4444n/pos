import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { api } from '../api';
import { DateField } from '../components/DateField';
import { Icon } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { CashMoveDialog } from '../components/shift/CashMoveDialog';
import { CloseShiftDialog } from '../components/shift/CloseShiftDialog';
import { OpenShiftDialog } from '../components/shift/OpenShiftDialog';
import { ShiftDetailModal } from '../components/shift/ShiftDetailModal';
import { ShiftRow } from '../components/shift/ShiftRow';
import { ToastView } from '../components/ToastView';
import { baht, duration, isoDate, signedBaht, thaiDate, VERDICT } from '../format';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import type { Shift, ShiftSummary } from '../types';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
};
const RANGES: { label: string; days: number | null }[] = [
  { label: 'วันนี้', days: 0 },
  { label: '7 วัน', days: 6 },
  { label: '30 วัน', days: 29 },
  { label: 'ทั้งหมด', days: null },
];

interface Props {
  onNavigate: (r: Route) => void;
  /** เปิด/ปิดกะแล้ว → แจ้งหน้าขายให้โหลดสถานะกะใหม่ */
  onShiftChanged: () => void;
}

/** หน้ากะการขาย: กะปัจจุบัน + ประวัติกะ + กระทบยอดเงินสด (layout เดียวกับหน้าประวัติการขาย) */
export function ShiftScreen({ onNavigate, onShiftChanged }: Props) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const wideRows = width >= (showSidebar ? 1280 : 1020);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [range, setRange] = useState({ from: daysAgo(6), to: isoDate(new Date()) });
  const [current, setCurrent] = useState<Shift | null>(null);
  const [rows, setRows] = useState<Shift[]>([]);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'open' | 'close' | 'in' | 'out'>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  const clearToast = useCallback(() => setToast(null), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cur, list] = await Promise.all([api.currentShift(), api.shifts({ ...range, limit: 100 })]);
      setCurrent(cur.shift);
      setRows(list.rows);
      setSummary(list.summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  // อัปเดตตัวเลขกะที่เปิดอยู่ทุก 30 วินาที
  useEffect(() => {
    if (!current) return;
    const t = setInterval(() => api.currentShift().then((r) => setCurrent(r.shift)).catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeRange = RANGES.find((r) =>
    r.days === null ? !range.from && !range.to : range.from === daysAgo(r.days) && range.to === isoDate(new Date()),
  )?.label;

  const changed = () => {
    load();
    onShiftChanged();
  };

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="shifts" onNavigate={onNavigate} /> : null}

      <View style={[s.main, mobile && { padding: 10 }]}>
        {/* ---------- header (เหมือนหน้าประวัติการขาย) ---------- */}
        <View style={s.header}>
          <View style={s.row}>
            <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <Text style={s.title}>
              กิจกรรม<Text style={s.titleSub}> / กะการขาย</Text>
            </Text>
          </View>
          <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
            {!mobile ? (
              <View style={s.pillBtn}>
                <Text style={s.pillText}>{thaiDate(new Date())}</Text>
                <Icon name="calendar-outline" size={16} color={colors.primary} />
              </View>
            ) : null}
            <Pressable style={s.pillBtn} onPress={() => onNavigate('sales')} accessibilityLabel="เปิดหน้าขาย">
              <View style={s.greenDot} />
              <Text style={[s.pillText, { color: colors.success }]}>{mobile ? 'ขาย' : 'เปิดหน้าขาย'}</Text>
              <Icon name="power" size={15} color={colors.success} />
            </Pressable>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
          {/* ---------- กะปัจจุบัน ---------- */}
          {current ? (
            <View style={s.current}>
              <View style={[s.curHead, mobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={s.row}>
                    <View style={s.liveDot} />
                    <Text style={s.curTitle}>กำลังเปิดกะ #{current.shiftNo}</Text>
                  </View>
                  <Text style={s.curSub}>
                    เปิดโดย {current.openedBy.replace('พนักงาน: ', '')} · ตั้งแต่ {current.openedAt.slice(11, 16)} น. · {duration(current.minutes)}
                  </Text>
                </View>
                <View style={[s.row, mobile && { marginTop: 10 }]}>
                  <Pressable style={[s.actBtn, s.ghost, mobile && { flex: 1 }]} onPress={() => setDialog('in')}>
                    <Icon name="swap-vertical" size={17} color={colors.text} />
                    <Text style={s.ghostText}>นำเงินเข้า/ออก</Text>
                  </Pressable>
                  <Pressable style={[s.actBtn, s.primary, mobile && { flex: 1 }]} onPress={() => setDialog('close')}>
                    <Icon name="lock-closed-outline" size={17} color="#fff" />
                    <Text style={s.primaryText}>ปิดกะ</Text>
                  </Pressable>
                </View>
              </View>
              <View style={s.stats}>
                <Stat label="เงินเข้ากะ" value={baht(current.openingCash)} />
                <Stat label="เงินสด (ขาย)" value={baht(current.cashSales)} />
                <Stat label="นำเข้า / นำออก" value={`+${baht(current.cashIn)} / −${baht(current.cashOut)}`} small />
                <Stat label="ควรมีในลิ้นชัก" value={baht(current.expectedCash)} accent />
                <Stat label={`ยอดขายรวม (${current.billCount} บิล)`} value={baht(current.totalSales)} />
              </View>
            </View>
          ) : !loading ? (
            <View style={[s.current, s.noShift, mobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
              <View style={s.noIcon}>
                <Icon name="lock-closed-outline" size={24} color={colors.sub} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.curTitle}>ยังไม่ได้เปิดกะ</Text>
                <Text style={s.curSub}>เปิดกะพร้อมนับเงินตั้งต้นในลิ้นชัก ก่อนเริ่มขาย</Text>
              </View>
              <Pressable style={[s.actBtn, s.primary, { paddingHorizontal: 24 }]} onPress={() => setDialog('open')}>
                <Icon name="lock-open-outline" size={17} color="#fff" />
                <Text style={s.primaryText}>เปิดกะ</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ---------- ตัวกรอง (เหมือนหน้าประวัติ) ---------- */}
          <View style={[s.filters, mobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={s.row}>
              <Text style={s.fLabel}>วันที่</Text>
              <DateField grow={mobile} type="date" label="ตั้งแต่วันที่" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} width={160} />
              <Text style={s.dash}>–</Text>
              <DateField grow={mobile} type="date" label="ถึงวันที่" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} width={160} />
            </View>
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              {RANGES.map((r) => (
                <Pressable
                  key={r.label}
                  style={[s.chip, activeRange === r.label && s.chipOn]}
                  onPress={() => setRange(r.days === null ? { from: '', to: '' } : { from: daysAgo(r.days), to: isoDate(new Date()) })}
                >
                  <Text style={[s.chipText, activeRange === r.label && s.chipTextOn]}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* ---------- สรุป ---------- */}
          {summary ? (
            <View style={[s.summary, { flexWrap: 'wrap' }]}>
              <SumCard label="จำนวนกะ" value={String(summary.count)} />
              <SumCard label="ยอดขายรวม" value={baht(summary.totalSales)} tone={colors.primary} />
              <SumCard label="ยอดตรงกัน" value={`${summary.match} กะ`} tone={VERDICT.match.fg} />
              <SumCard label="ขาด / เกิน" value={`${summary.short} / ${summary.over} กะ`} tone={summary.short ? VERDICT.short.fg : colors.text} />
              <SumCard
                label="ส่วนต่างสะสม"
                value={signedBaht(summary.netDiff)}
                tone={summary.netDiff === 0 ? colors.text : summary.netDiff > 0 ? VERDICT.over.fg : VERDICT.short.fg}
              />
            </View>
          ) : null}

          {/* ---------- รายการกะ ---------- */}
          {error ? <Text style={s.error}>{error}</Text> : null}
          {loading && rows.length === 0 ? <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} /> : null}
          {!loading && rows.length === 0 && !error ? (
            <View style={s.empty}>
              <Icon name="time-outline" size={34} color={colors.faint} />
              <Text style={s.emptyText}>ไม่มีกะในช่วงที่เลือก</Text>
            </View>
          ) : null}
          <View>
            {rows.map((r) => (
              <ShiftRow key={r.id} shift={r} layout={wideRows ? 'wide' : 'stack'} onPress={(x) => setDetail(x.id)} />
            ))}
          </View>
        </ScrollView>
      </View>

      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="shifts" onNavigate={onNavigate} />

      <OpenShiftDialog
        visible={dialog === 'open'}
        onClose={() => setDialog(null)}
        onOpened={(sh) => {
          setDialog(null);
          notify('success', `เปิดกะ #${sh.shiftNo} แล้ว · เงินตั้งต้น ${baht(sh.openingCash)}`);
          changed();
        }}
      />
      <CashMoveDialog
        visible={dialog === 'in' || dialog === 'out'}
        kind={dialog === 'out' ? 'out' : 'in'}
        onClose={() => setDialog(null)}
        onDone={(sh) => {
          setDialog(null);
          setCurrent(sh);
          notify('success', 'บันทึกรายการเงินเข้า/ออกแล้ว');
          load();
        }}
      />
      {current ? (
        <CloseShiftDialog
          visible={dialog === 'close'}
          shift={current}
            onClose={() => setDialog(null)}
          onClosed={() => {
            setDialog(null);
            changed();
          }}
        />
      ) : null}
      <ShiftDetailModal shiftId={detail} onClose={() => setDetail(null)} />
      <ToastView toast={toast} onDone={clearToast} />
    </View>
  );
}

function Stat({ label, value, accent, small }: { label: string; value: string; accent?: boolean; small?: boolean }) {
  return (
    <View style={[s.stat, accent && { backgroundColor: colors.primary }]}>
      <Text style={[s.statLabel, accent && { color: 'rgba(255,255,255,0.8)' }]}>{label}</Text>
      <Text style={[s.statValue, small && { fontSize: 14 }, accent && { color: '#fff' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SumCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.sumCard}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.sumValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  titleSub: { fontSize: 13, fontWeight: '400', color: colors.sub },
  pillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 16, paddingRight: 8,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  pillText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  current: { borderRadius: radius.lg, borderWidth: 1.5, borderColor: '#D6E1FF', backgroundColor: '#F8FAFF', padding: 14, gap: 12 },
  curHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.success },
  curTitle: { fontFamily: font, fontSize: 16, fontWeight: '700', color: colors.text },
  curSub: { fontFamily: font, fontSize: 12, color: colors.sub },
  noShift: { flexDirection: 'row', alignItems: 'center', gap: 12, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.surface },
  noIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  actBtn: { height: 44, paddingHorizontal: 16, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  ghost: { borderWidth: 1.5, borderColor: colors.line, backgroundColor: '#fff' },
  ghostText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '600' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, flexBasis: 150, backgroundColor: '#fff', borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14 },
  statLabel: { fontFamily: font, fontSize: 11, color: colors.sub },
  statValue: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2 },
  filters: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 8 },
  fLabel: { fontFamily: font, fontSize: 13, color: colors.sub, marginLeft: 4 },
  dash: { color: colors.sub },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: font, fontSize: 12, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  summary: { flexDirection: 'row', gap: 10 },
  sumCard: { flexGrow: 1, flexBasis: 130, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14 },
  sumValue: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2 },
  error: { fontFamily: font, color: colors.danger, textAlign: 'center', marginVertical: 20 },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 6 },
  emptyText: { fontFamily: font, fontSize: 14, color: colors.sub },
});
