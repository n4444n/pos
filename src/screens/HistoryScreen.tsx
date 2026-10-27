// หน้า ประวัติการขาย (ค้นหา · กรอง · เปิดรายละเอียดบิล)
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { api } from '../api';
import { DateField } from '../components/DateField';
import { Badge } from '../components/history/Badge';
import { OrderDetailModal } from '../components/history/OrderDetailModal';
import { Icon } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { ToastView } from '../components/ToastView';
import { baht, isoDate, PAYMENT_LABEL, STATUS_LABEL, STATUS_TONE, thaiDate, thaiDateTime } from '../format';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import type { Bootstrap, HistoryFilter, HistoryRow, HistorySummary, OrderStatus, PaymentMethod } from '../types';

const PAGE = 50;

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
  /** เมื่อมีการแก้ไข/ยกเลิกบิล (หน้าขายจะโหลดสต็อกใหม่) */
  onStockChanged: () => void;
}

export function HistoryScreen({ onNavigate, onStockChanged }: Props) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const tableMode = width >= 760;
  const wideTable = width >= 1200;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>(() => ({ from: daysAgo(6), to: isoDate(new Date()), timeFrom: '', timeTo: '', q: '', status: '', payment: '' }));
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<Bootstrap | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const reqId = useRef(0);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  const clearToast = useCallback(() => setToast(null), []);

  // ค้นหาแบบหน่วงเวลา 300ms เพื่อไม่ยิง API ทุกตัวอักษร
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => ({ ...f, q: query })), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async (append = false) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await api.history({ ...filter, limit: PAGE, offset: append ? rows.length : 0 });
        if (id !== reqId.current) return; // มีคำค้นใหม่กว่าแล้ว
        setRows((r) => (append ? [...r, ...res.rows] : res.rows));
        setSummary(res.summary);
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [filter, rows.length],
  );

  useEffect(() => {
    load(false);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await api.bootstrap());
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [notify]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const setF = (patch: Partial<HistoryFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const activeRange = RANGES.find((r) =>
    r.days === null ? !filter.from && !filter.to : filter.from === daysAgo(r.days) && filter.to === isoDate(new Date()),
  )?.label;

  const download = () => {
    const url = api.historyCsvUrl(filter);
    if (Platform.OS === 'web') window.open(url, '_blank');
  };

  const searchBox = (
    <View style={s.searchBox}>
      <Icon name="search" size={17} color={colors.text} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="ค้นหาบิล / ลูกค้า / SKU…"
        placeholderTextColor={colors.faint}
        style={s.searchInput}
      />
      {query ? (
        <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="ล้างคำค้นหา">
          <Icon name="close-circle" size={16} color={colors.faint} />
        </Pressable>
      ) : null}
    </View>
  );

  const onChanged = useCallback(() => {
    load(false);
    loadCatalog();
    onStockChanged();
  }, [load, loadCatalog, onStockChanged]);

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="history" onNavigate={onNavigate} /> : null}

      <View style={[s.main, mobile && { padding: 10 }]}>
        {/* ---------- header ---------- */}
        <View style={s.header}>
          <View style={s.row}>
            <Pressable
              style={s.iconBtn}
              onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))}
              accessibilityLabel="เมนู"
            >
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <Text style={s.title}>
              กิจกรรม<Text style={s.titleSub}> / ประวัติการขาย</Text>
            </Text>
          </View>
          <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
            <Pressable style={s.pillBtn} onPress={download} accessibilityLabel="ดาวน์โหลด CSV">
              {!mobile ? <Text style={s.pillText}>ดาวน์โหลด</Text> : null}
              <View style={s.dlIcon}>
                <Icon name="download-outline" size={15} color="#fff" />
              </View>
            </Pressable>
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

        {/* ---------- filters ---------- */}
        <View style={[s.filters, mobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
          {mobile ? (
            <>
              <View style={s.row}>
                <Text style={[s.fLabel, s.fLabelFixed]}>วันที่</Text>
                <DateField grow type="date" label="ตั้งแต่วันที่" value={filter.from ?? ''} onChange={(v) => setF({ from: v })} />
                <Text style={s.dash}>–</Text>
                <DateField grow type="date" label="ถึงวันที่" value={filter.to ?? ''} onChange={(v) => setF({ to: v })} />
              </View>
              <View style={s.row}>
                <Text style={[s.fLabel, s.fLabelFixed]}>เวลา</Text>
                <DateField grow type="time" label="ตั้งแต่เวลา" value={filter.timeFrom ?? ''} onChange={(v) => setF({ timeFrom: v })} />
                <Text style={s.dash}>–</Text>
                <DateField grow type="time" label="ถึงเวลา" value={filter.timeTo ?? ''} onChange={(v) => setF({ timeTo: v })} />
              </View>
            </>
          ) : (
            <View style={[s.row, { flexWrap: 'wrap', flex: 1 }]}>
              <Text style={s.fLabel}>วันที่</Text>
              <DateField type="date" label="ตั้งแต่วันที่" value={filter.from ?? ''} onChange={(v) => setF({ from: v })} width={160} />
              <Text style={s.dash}>–</Text>
              <DateField type="date" label="ถึงวันที่" value={filter.to ?? ''} onChange={(v) => setF({ to: v })} width={160} />
              <Text style={[s.fLabel, { marginLeft: 8 }]}>เวลา</Text>
              <DateField type="time" label="ตั้งแต่เวลา" value={filter.timeFrom ?? ''} onChange={(v) => setF({ timeFrom: v })} width={118} />
              <Text style={s.dash}>–</Text>
              <DateField type="time" label="ถึงเวลา" value={filter.timeTo ?? ''} onChange={(v) => setF({ timeTo: v })} width={118} />
            </View>
          )}
          {!mobile ? (
            <View style={s.row}>
              <Pressable
                style={[s.roundBtn, (showFilters || filter.status || filter.payment) && s.roundOn]}
                onPress={() => setShowFilters((v) => !v)}
                accessibilityLabel="ตัวกรอง"
              >
                <Icon name="filter-outline" size={18} color={showFilters || filter.status || filter.payment ? colors.primary : colors.text} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {/* ช่องค้นหาบิล อยู่ซ้ายของปุ่มช่วงวันที่ */}
          <View style={mobile ? { width: '100%' } : { width: 300 }}>{searchBox}</View>
          {mobile ? (
            <Pressable
              style={[s.chip, (showFilters || filter.status || filter.payment) && s.chipOn, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
              onPress={() => setShowFilters((v) => !v)}
            >
              <Icon name="filter-outline" size={14} color={showFilters || filter.status || filter.payment ? '#fff' : colors.text} />
              <Text style={[s.chipText, (showFilters || filter.status || filter.payment) && s.chipTextOn]}>ตัวกรอง</Text>
            </Pressable>
          ) : null}
          {RANGES.map((r) => (
            <Pressable
              key={r.label}
              style={[s.chip, activeRange === r.label && s.chipOn]}
              onPress={() => setF(r.days === null ? { from: '', to: '' } : { from: daysAgo(r.days), to: isoDate(new Date()) })}
            >
              <Text style={[s.chipText, activeRange === r.label && s.chipTextOn]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>


        {showFilters ? (
          <View style={s.filterPanel}>
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              <Text style={s.fLabel}>สถานะ</Text>
              {(['', 'paid', 'edited', 'void'] as (OrderStatus | '')[]).map((st) => (
                <Pressable key={st || 'all'} style={[s.chip, filter.status === st && s.chipOn]} onPress={() => setF({ status: st })}>
                  <Text style={[s.chipText, filter.status === st && s.chipTextOn]}>{st ? STATUS_LABEL[st] : 'ทั้งหมด'}</Text>
                </Pressable>
              ))}
            </View>
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              <Text style={s.fLabel}>ชำระโดย</Text>
              {(['', 'cash', 'promptpay', 'card', 'transfer'] as (PaymentMethod | '')[]).map((p) => (
                <Pressable key={p || 'all'} style={[s.chip, filter.payment === p && s.chipOn]} onPress={() => setF({ payment: p })}>
                  <Text style={[s.chipText, filter.payment === p && s.chipTextOn]}>{p ? PAYMENT_LABEL[p] : 'ทั้งหมด'}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* ---------- summary ---------- */}
        {summary ? (
          <View style={[s.summary, mobile && { flexWrap: 'wrap' }]}>
            <Stat label="จำนวนบิล" value={summary.count.toLocaleString()} />
            <Stat label="ยอดขายสุทธิ" value={baht(summary.sales)} strong />
            <Stat label="แก้ไขแล้ว" value={String(summary.edited)} tone={STATUS_TONE.edited.fg} />
            <Stat label="ยกเลิก" value={String(summary.voided)} tone={STATUS_TONE.void.fg} />
          </View>
        ) : null}

        {/* ---------- table / cards ---------- */}
        <View style={{ flex: 1, minHeight: 200 }}>
          {tableMode ? (
            <View style={s.thead}>
              <Th w={44} label="#" />
              <Th flex={1.5} label="วันที่ & เวลา" />
              <Th flex={1.4} label="เลขที่บิล" />
              <Th flex={1.3} label="ชื่อลูกค้า" />
              {wideTable ? <Th flex={1.1} label="พนักงาน" /> : null}
              <Th flex={0.6} label="ชิ้น" />
              <Th flex={1.1} label="ยอดชำระ" />
              {wideTable ? <Th flex={1} label="ชำระโดย" /> : null}
              <Th flex={1} label="สถานะ" />
              <Th flex={0.9} label="บิล" />
            </View>
          ) : null}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
            {error ? <Text style={s.error}>{error}</Text> : null}
            {!loading && !error && rows.length === 0 ? (
              <View style={s.empty}>
                <Icon name="receipt-outline" size={34} color={colors.faint} />
                <Text style={s.emptyText}>ไม่พบบิลในช่วงที่เลือก</Text>
              </View>
            ) : null}
            {rows.map((r, i) =>
              tableMode ? (
                <Pressable
                  key={r.id}
                  onPress={() => setSelected(r.id)}
                  style={({ hovered }: { hovered?: boolean }) => [s.tr, hovered && { backgroundColor: '#F8FAFF' }]}
                >
                  <Td w={44} text={String(i + 1).padStart(3, '0')} dim={r.status === 'void'} />
                  <Td flex={1.5} text={thaiDateTime(r.createdAt)} dim={r.status === 'void'} />
                  <Td flex={1.4} text={r.orderNo} dim={r.status === 'void'} bold />
                  <Td flex={1.3} text={r.customerName || '—'} dim={r.status === 'void'} />
                  {wideTable ? <Td flex={1.1} text={r.salesperson?.replace('พนักงาน: ', '') || '—'} dim={r.status === 'void'} /> : null}
                  <Td flex={0.6} text={String(r.itemCount)} dim={r.status === 'void'} />
                  <Td flex={1.1} text={baht(r.total)} dim={r.status === 'void'} strike={r.status === 'void'} />
                  {wideTable ? <Td flex={1} text={PAYMENT_LABEL[r.paymentMethod]} dim={r.status === 'void'} /> : null}
                  <View style={[s.td, { flex: 1 }]}>
                    <Badge status={r.status} edits={r.editCount} />
                  </View>
                  <View style={[s.td, { flex: 0.9 }]}>
                    <Text style={s.link}>รายละเอียด</Text>
                  </View>
                </Pressable>
              ) : (
                <Pressable key={r.id} onPress={() => setSelected(r.id)} style={s.card}>
                  <View style={s.cardTop}>
                    <Text style={s.cardNo}>{r.orderNo}</Text>
                    <Badge status={r.status} edits={r.editCount} />
                  </View>
                  <Text style={s.cardSub}>
                    {thaiDateTime(r.createdAt)} · {r.customerName || 'ลูกค้าทั่วไป'}
                  </Text>
                  <View style={s.cardTop}>
                    <Text style={s.cardSub}>
                      {r.itemCount} ชิ้น · {PAYMENT_LABEL[r.paymentMethod]}
                    </Text>
                    <Text style={[s.cardTotal, r.status === 'void' && { textDecorationLine: 'line-through', color: colors.faint }]}>
                      {baht(r.total)}
                    </Text>
                  </View>
                </Pressable>
              ),
            )}
            {loading ? <ActivityIndicator style={{ marginVertical: 20 }} color={colors.primary} /> : null}
            {!loading && summary && rows.length < summary.count ? (
              <Pressable style={s.more} onPress={() => load(true)}>
                <Text style={s.moreText}>
                  โหลดเพิ่ม ({rows.length}/{summary.count})
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>

      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="history" onNavigate={onNavigate} />

      <OrderDetailModal
        orderId={selected}
        catalog={catalog}
        onClose={() => setSelected(null)}
        onChanged={onChanged}
        notify={notify}
      />
      <ToastView toast={toast} onDone={clearToast} />
    </View>
  );
}

function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, strong && { color: colors.primary }, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function Th({ label, flex, w }: { label: string; flex?: number; w?: number }) {
  return (
    <View style={[s.th, w ? { width: w } : { flex }]}>
      <Text style={s.thText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Td({ text, flex, w, dim, bold, strike }: { text: string; flex?: number; w?: number; dim?: boolean; bold?: boolean; strike?: boolean }) {
  return (
    <View style={[s.td, w ? { width: w } : { flex }]}>
      <Text
        style={[s.tdText, bold && { fontWeight: '600' }, dim && { color: colors.faint }, strike && { textDecorationLine: 'line-through' }]}
        numberOfLines={1}
      >
        {text}
      </Text>
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
  dlIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 8 },
  fLabel: { fontFamily: font, fontSize: 13, color: colors.sub, marginLeft: 4 },
  fLabelFixed: { width: 40 },
  dash: { color: colors.sub },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  roundOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: font, fontSize: 12, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  filterPanel: { gap: 8, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 14,
    borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  searchInput: { flex: 1, fontFamily: font, fontSize: 13, color: colors.text, outlineStyle: 'none', minWidth: 0 } as object,
  summary: { flexDirection: 'row', gap: 10 },
  stat: { flexGrow: 1, flexBasis: 120, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14 },
  statLabel: { fontFamily: font, fontSize: 11, color: colors.sub },
  statValue: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2 },
  thead: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  th: { height: 34, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  thText: { fontFamily: font, fontSize: 12, color: colors.sub },
  tr: { flexDirection: 'row', gap: 6, minHeight: 50, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  td: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  tdText: { fontFamily: font, fontSize: 13, color: colors.text, textAlign: 'center' },
  link: { fontFamily: font, fontSize: 13, color: colors.primary, fontWeight: '500' },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8, gap: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardNo: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  cardSub: { fontFamily: font, fontSize: 12, color: colors.sub },
  cardTotal: { fontFamily: font, fontSize: 16, fontWeight: '700', color: colors.text },
  error: { fontFamily: font, color: colors.danger, textAlign: 'center', marginVertical: 20 },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 6 },
  emptyText: { fontFamily: font, fontSize: 14, color: colors.sub },
  more: { alignSelf: 'center', marginTop: 12, paddingHorizontal: 18, height: 38, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  moreText: { fontFamily: font, fontSize: 13, color: colors.text },
});
