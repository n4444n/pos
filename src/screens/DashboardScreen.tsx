import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api, type Branch } from '../api';
import { useAppSettings } from '../appSettings';
import { AreaChart } from '../components/dashboard/AreaChart';
import { Bars, Columns } from '../components/dashboard/Bars';
import { DateField } from '../components/DateField';
import { GarmentArt } from '../components/GarmentArt';
import { Badge } from '../components/history/Badge';
import { Icon, type IconName } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { Sheet } from '../components/Sheet';
import { baht, isoDate, n0, n2, pctChange, PAYMENT_LABEL, thaiDate, variantLabel } from '../format';
import { categoryChip, colors, font, radius } from '../theme';
import type { Dashboard, SeriesPoint } from '../types';

type Metric = 'sales' | 'profit' | 'bills' | 'units';
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: 'sales', label: 'ยอดขายสุทธิ', unit: 'บาท' },
  { id: 'profit', label: 'กำไรขั้นต้น', unit: 'บาท' },
  { id: 'bills', label: 'จำนวนบิล', unit: 'บิล' },
  { id: 'units', label: 'จำนวนชิ้น', unit: 'ชิ้น' },
];

// ---------- ช่วงเวลา ----------
type PeriodId = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'year' | 'custom';
const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'today', label: 'วันนี้' },
  { id: 'yesterday', label: 'เมื่อวาน' },
  { id: '7d', label: '7 วันล่าสุด' },
  { id: '30d', label: '30 วันล่าสุด' },
  { id: 'month', label: 'เดือนนี้' },
  { id: 'lastMonth', label: 'เดือนที่แล้ว' },
  { id: 'year', label: 'ปีนี้' },
  { id: 'custom', label: 'กำหนดเอง' },
];
function rangeOf(p: PeriodId): { from: string; to: string } {
  const t = new Date();
  const d = (y: number, m: number, day: number) => isoDate(new Date(y, m, day));
  const Y = t.getFullYear();
  const M = t.getMonth();
  const D = t.getDate();
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
function bucketLabel(key: string, g: Dashboard['range']['granularity'], long = false) {
  if (g === 'hour') return long ? `${key}:00–${key}:59 น.` : `${key}:00`;
  if (g === 'month') {
    const [y, m] = key.split('-').map(Number);
    return `${MONTHS[m - 1]} ${String(y + 543).slice(2)}`;
  }
  const [y, m, d] = key.split('-').map(Number);
  return long ? `${d} ${MONTHS[m - 1]} ${y + 543}` : `${d} ${MONTHS[m - 1]}`;
}

interface Props {
  onNavigate: (r: Route) => void;
}

/** หน้ารายงาน (ผู้จัดการ) — layout ตามแบบ: KPI 4 ใบ → กราฟ + สินค้าขายดี → รายละเอียดสำหรับร้านเสื้อผ้า */
export function DashboardScreen({ onNavigate }: Props) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [period, setPeriod] = useState<PeriodId>('7d');
  const [custom, setCustom] = useState(() => rangeOf('7d'));
  const [pickPeriod, setPickPeriod] = useState(false);
  const [showGraph, setShowGraph] = useState(true);
  const [metric, setMetric] = useState<Metric>('sales');
  const [pickMetric, setPickMetric] = useState(false);
  const [mix, setMix] = useState<'size' | 'color'>('size');
  const [productQ, setProductQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  // ขอบเขตสาขา: '' = สาขาปัจจุบัน · 'all' = รวมทุกสาขา · '<id>' = สาขาที่เลือก
  const [scope, setScope] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pickBranch, setPickBranch] = useState(false);
  const [pickDownload, setPickDownload] = useState(false);
  useEffect(() => {
    api.branchManage().then((r) => setBranches(r.list), () => {});
  }, []);
  const appBranch = useAppSettings().branch;
  const scopeLabel = scope === 'all' ? 'ทุกสาขา' : branches.find((b) => String(b.id) === scope)?.name ?? appBranch.name ?? 'สาขานี้';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = period === 'custom' ? custom : rangeOf(period);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.dashboard({ ...range, branch: scope || undefined }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  /** xlsx = ข้อมูลครบสำหรับวิเคราะห์ (หลายชีต + ข้อมูลดิบ) · csv = สรุปสั้น (แบบเดิม) */
  const download = (kind: 'xlsx' | 'csv') => {
    setPickDownload(false);
    const f = { ...range, branch: scope || undefined };
    if (Platform.OS === 'web') window.open(kind === 'xlsx' ? api.dashboardXlsxUrl(f) : api.dashboardCsvUrl(f), '_blank');
  };

  const m = METRICS.find((x) => x.id === metric)!;
  const fmt = (v: number) => (metric === 'sales' || metric === 'profit' ? baht(v) : `${n0(v)} ${m.unit}`);
  const sum = (arr: SeriesPoint[]) => arr.reduce((a, p) => a + p[metric], 0);
  const curTotal = data ? sum(data.series) : 0;
  const prevTotal = data ? sum(data.prevSeries) : 0;
  const growth = curTotal - prevTotal;
  const growthPct = pctChange(curTotal, prevTotal);

  const products = useMemo(() => {
    const q = productQ.trim().toLowerCase();
    const list = (data?.topProducts ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    return q ? list : list.slice(0, 6); // 6 อันดับแรก (ความสูงพอดีกับการ์ดกราฟ)
  }, [data, productQ]);

  const periodLabel = PERIODS.find((p) => p.id === period)!.label;
  const rangeText = data
    ? data.range.from === data.range.to
      ? bucketLabel(data.range.from, 'day', true)
      : `${bucketLabel(data.range.from, 'day', true)} – ${bucketLabel(data.range.to, 'day', true)}`
    : '';
  const prevText = data
    ? data.prevRange.from === data.prevRange.to
      ? bucketLabel(data.prevRange.from, 'day')
      : `${bucketLabel(data.prevRange.from, 'day')} – ${bucketLabel(data.prevRange.to, 'day')}`
    : '';

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="dashboard" onNavigate={onNavigate} /> : null}

      <View style={[s.main, mobile && { padding: 10 }]}>
        {/* ---------- header ---------- */}
        <View style={s.header}>
          <View style={s.row}>
            <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <Text style={s.title}>รายงานรวม</Text>
          </View>
          <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
            {branches.length > 1 ? (
              <Pressable style={[s.pillBtn, scope === 'all' && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]} onPress={() => setPickBranch(true)} accessibilityLabel={`รายงานของ ${scopeLabel} — กดเพื่อเปลี่ยนสาขา`}>
                <Icon name={scope === 'all' ? 'git-network-outline' : 'location-outline'} size={16} color={colors.primary} />
                <Text style={[s.pillText, { color: colors.primary }]} numberOfLines={1}>{scopeLabel}</Text>
                <Icon name="chevron-down" size={14} color={colors.primary} />
              </Pressable>
            ) : null}
            <Pressable style={s.pillBtn} onPress={() => setPickDownload(true)} accessibilityLabel="ดาวน์โหลดรายงาน (Excel / CSV)">
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

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 20 }}>
          {/* ---------- ช่วงเวลา + แสดงกราฟ ---------- */}
          <View style={[s.toolbar, mobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              <Text style={s.fLabel}>ช่วงเวลา</Text>
              <Pressable style={s.periodBtn} onPress={() => setPickPeriod(true)} accessibilityLabel="เลือกช่วงเวลา">
                <Text style={s.periodText}>{periodLabel}</Text>
                <Icon name="calendar-outline" size={16} color={colors.primary} />
              </Pressable>
              {period === 'custom' ? (
                <>
                  <DateField type="date" label="ตั้งแต่วันที่" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} width={150} />
                  <Text style={s.dash}>–</Text>
                  <DateField type="date" label="ถึงวันที่" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} width={150} />
                </>
              ) : (
                <Text style={s.rangeText}>{rangeText}</Text>
              )}
            </View>
            <Pressable style={s.toggleRow} onPress={() => setShowGraph((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: showGraph }}>
              <Text style={s.pillText}>แสดงกราฟ</Text>
              <View style={[s.track, showGraph && s.trackOn]}>
                <View style={[s.knob, showGraph && { transform: [{ translateX: 16 }] }]} />
              </View>
            </Pressable>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}
          {!data && loading ? <ActivityIndicator style={{ marginVertical: 60 }} color={colors.primary} size="large" /> : null}

          {data ? (
            <View style={{ gap: 14, opacity: loading ? 0.55 : 1 }}>
              {/* ---------- KPI 4 ใบ ---------- */}
              <View style={s.wrap}>
                <Kpi icon="trending-up" label="ยอดขายสุทธิ" value={n2(data.kpis.sales)} unit="บาท" cur={data.kpis.sales} prev={data.prev.sales} money
                  note={`เฉลี่ย ${baht(data.kpis.aov)} / บิล`} />
                <Kpi icon="shirt-outline" label="จำนวนชิ้นที่ขาย" value={n0(data.kpis.units)} unit="ชิ้น" cur={data.kpis.units} prev={data.prev.units}
                  note={`เฉลี่ย ${data.kpis.upt.toFixed(1)} ชิ้น / บิล`} />
                <Kpi icon="receipt-outline" label="จำนวนบิล" value={n0(data.kpis.bills)} unit="บิล" cur={data.kpis.bills} prev={data.prev.bills}
                  note={data.returns.voids || data.returns.edits ? `ยกเลิก ${data.returns.voids} · เปลี่ยนสินค้า ${data.returns.edits}` : 'ไม่มีการยกเลิก/เปลี่ยนสินค้า'} />
                <Kpi icon="wallet-outline" label="กำไรขั้นต้น" value={n2(data.kpis.profit)} unit="บาท" cur={data.kpis.profit} prev={data.prev.profit} money
                  note={`อัตรากำไร ${data.kpis.margin.toFixed(1)}%`} />
                {data.expenses ? (
                  <Kpi icon="calculator-outline" label="กำไรสุทธิ" value={n2(data.kpis.profit - data.expenses.total)} unit="บาท"
                    cur={data.kpis.profit - data.expenses.total} prev={data.prev.profit - data.expenses.prev} money
                    note={`หักค่าใช้จ่ายร้าน ${baht(data.expenses.total)}`} />
                ) : null}
              </View>
              <Text style={s.compareNote}>เทียบกับช่วงก่อนหน้า ({prevText}) · ยอดขายไม่รวมบิลที่ยกเลิก · กำไรขั้นต้น = ยอดขายก่อน VAT − ต้นทุนสินค้า</Text>

              {/* ---------- กราฟ + สินค้าขายดี ---------- */}
              <View style={s.wrap}>
                {showGraph ? (
                  <View style={[s.card, { flexGrow: 2, flexBasis: 520 }]}>
                    <View style={s.cardHead}>
                      <View style={s.row}>
                        <View style={s.bullet} />
                        <Text style={s.cardTitle}>กราฟ{m.label}</Text>
                      </View>
                      <Pressable style={s.select} onPress={() => setPickMetric(true)} accessibilityLabel="เลือกข้อมูลกราฟ">
                        <Text style={s.selectText}>{m.label}</Text>
                        <Icon name="caret-down" size={12} color={colors.text} />
                      </Pressable>
                    </View>
                    <View style={[s.row, { gap: 14, marginBottom: 8 }]}>
                      <Legend color={colors.primary} label={`ช่วงนี้`} />
                      <Legend color="#A0A6B1" label={`ช่วงก่อนหน้า`} dashed />
                    </View>
                    <AreaChart
                      values={data.series.map((p) => p[metric])}
                      prev={data.prevSeries.map((p) => p[metric])}
                      labels={data.series.map((p) => bucketLabel(p.key, data.range.granularity))}
                      tipLabels={data.series.map((p) => bucketLabel(p.key, data.range.granularity, true))}
                      format={fmt}
                      height={mobile ? 170 : 220}
                    />
                    <View style={[s.wrap, { gap: 10, marginTop: 8 }]}>
                      <MiniStat label="ยอดรวม" value={metric === 'sales' || metric === 'profit' ? n2(curTotal) : n0(curTotal)} unit={m.unit} />
                      <MiniStat
                        label="เติบโต"
                        value={`${growth >= 0 ? '+' : '−'}${metric === 'sales' || metric === 'profit' ? n2(Math.abs(growth)) : n0(Math.abs(growth))}`}
                        unit={m.unit}
                        tone={growth > 0 ? colors.success : growth < 0 ? colors.danger : undefined}
                      />
                      <MiniStat
                        label="อัตราการเติบโต"
                        value={growthPct == null ? 'ใหม่' : `${growthPct > 0 ? '↑ ' : growthPct < 0 ? '↓ ' : ''}${Math.abs(growthPct)}`}
                        unit="%"
                        tone={growthPct != null && growthPct > 0 ? colors.success : growthPct != null && growthPct < 0 ? colors.danger : undefined}
                      />
                    </View>
                  </View>
                ) : null}

                <View style={[s.card, { flexGrow: 1, flexBasis: 320 }]}>
                  <View style={s.cardHead}>
                    <View style={s.row}>
                      <View style={s.bullet} />
                      <Text style={s.cardTitle}>สินค้าขายดี</Text>
                    </View>
                    <Pressable style={[s.roundBtn, searchOpen && { borderColor: colors.primary }]} onPress={() => setSearchOpen((v) => !v)} accessibilityLabel="ค้นหาสินค้า">
                      <Icon name="search" size={16} color={searchOpen ? colors.primary : colors.text} />
                    </Pressable>
                  </View>
                  {searchOpen ? (
                    <TextInput value={productQ} onChangeText={setProductQ} placeholder="ค้นหาชื่อ / SKU" placeholderTextColor={colors.faint} style={s.search} autoFocus />
                  ) : null}
                  <View style={s.thead}>
                    <Text style={[s.th, { width: 52 }]}>รูป</Text>
                    <Text style={[s.th, { flex: 1 }]}>ชื่อสินค้า</Text>
                    <Text style={[s.th, { width: 92, textAlign: 'right' }]}>ขายได้</Text>
                  </View>
                  {products.length === 0 ? <Text style={s.empty}>ยังไม่มีการขายในช่วงนี้</Text> : null}
                  {products.map((p, i) => {
                    const chip = categoryChip[p.categoryId] ?? categoryChip.acc;
                    return (
                      <View key={p.id} style={s.prodRow}>
                        <View style={s.thumb}>
                          <GarmentArt art={p.art} color={p.tint} size={32} />
                          {i < 3 && !productQ ? (
                            <View style={s.rank}>
                              <Text style={s.rankText}>{i + 1}</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                          <Text style={s.prodName} numberOfLines={1}>{p.name}</Text>
                          <View style={[s.catChip, { backgroundColor: chip.bg }]}>
                            <Text style={[s.catText, { color: chip.fg }]} numberOfLines={1}>{p.category}</Text>
                          </View>
                        </View>
                        <View style={{ width: 92, alignItems: 'flex-end' }}>
                          <Text style={s.prodUnits}>{n0(p.units)} ชิ้น</Text>
                          <Text style={s.prodSales}>{baht(p.sales)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* ---------- สำหรับร้านเสื้อผ้า: ไซซ์/สี · หมวดหมู่ · สต็อกใกล้หมด ---------- */}
              <View style={s.wrap}>
                <Card title="ไซซ์ & สี ที่ขายดี" basis={300}
                  right={
                    <View style={s.seg}>
                      {(['size', 'color'] as const).map((k) => (
                        <Pressable key={k} style={[s.segBtn, mix === k && s.segOn]} onPress={() => setMix(k)}>
                          <Text style={[s.segText, mix === k && s.segTextOn]}>{k === 'size' ? 'ไซซ์' : 'สี'}</Text>
                        </Pressable>
                      ))}
                    </View>
                  }
                >
                  <Bars
                    labelWidth={mix === 'size' ? 56 : 92}
                    items={(mix === 'size' ? data.sizes : data.colors).slice(0, 8).map((x) => ({
                      key: x.label,
                      label: x.label,
                      value: x.units,
                      display: `${n0(x.units)} ชิ้น`,
                      sub: `${data.kpis.units ? Math.round((x.units / data.kpis.units) * 100) : 0}%`,
                      lead: 'hex' in x ? <View style={[s.swatch, { backgroundColor: (x as { hex: string }).hex }]} /> : undefined,
                    }))}
                  />
                </Card>

                <Card title="ยอดขายตามหมวดหมู่" basis={300}>
                  <Bars
                    labelWidth={104}
                    items={data.categories.map((c) => {
                      const total = data.categories.reduce((a, x) => a + x.sales, 0) || 1;
                      return { key: c.id, label: c.label, value: c.sales, display: baht(c.sales).replace('.00', ''), sub: `${Math.round((c.sales / total) * 100)}% · ${n0(c.units)} ชิ้น` };
                    })}
                  />
                </Card>

                <Card title="สต็อกใกล้หมด" basis={300}
                  right={<Text style={s.cardMeta}>หมด {data.stock.out} · เหลือน้อย {data.stock.low} รายการ</Text>}>
                  {data.lowStock.length === 0 ? <Text style={s.empty}>สต็อกเพียงพอทุกไซซ์</Text> : null}
                  {data.lowStock.slice(0, 6).map((v) => (
                    <View key={v.variantId} style={s.lowRow}>
                      <View style={[s.thumb, { width: 38, height: 38 }]}>
                        <GarmentArt art={v.art} color={v.colorHex} size={28} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.prodName} numberOfLines={1}>{v.name}</Text>
                        <Text style={s.small}>
                          {variantLabel(v)} · ขาย {v.sold30} ชิ้นใน 30 วัน
                        </Text>
                      </View>
                      <View style={[s.stockPill, { backgroundColor: v.stock === 0 ? colors.dangerSoft : '#FFF4E0' }]}>
                        <Icon name={v.stock === 0 ? 'alert-circle' : 'warning'} size={12} color={v.stock === 0 ? colors.danger : '#B26A00'} />
                        <Text style={[s.stockText, { color: v.stock === 0 ? colors.danger : '#B26A00' }]}>{v.stock === 0 ? 'หมด' : `เหลือ ${v.stock}`}</Text>
                      </View>
                    </View>
                  ))}
                  <Text style={[s.small, { marginTop: 8 }]}>
                    มูลค่าสต็อกคงเหลือ (ราคาทุน) {baht(data.stock.value)} · {n0(data.stock.units)} ชิ้น
                  </Text>
                </Card>
              </View>

              {/* ---------- ช่วงเวลาขายดี · ชำระเงิน · พนักงาน & คืนสินค้า ---------- */}
              <View style={s.wrap}>
                <Card title="ช่วงเวลาที่ขายดี" basis={420} grow={1.4}
                  right={<Text style={s.cardMeta}>จำนวนบิลต่อชั่วโมง</Text>}>
                  <Columns
                    items={data.hours.filter((h) => h.hour >= 9 && h.hour <= 22).map((h) => ({
                      key: String(h.hour),
                      label: String(h.hour).padStart(2, '0'),
                      value: h.bills,
                      tip: `${String(h.hour).padStart(2, '0')}:00 · ${h.bills} บิล`,
                    }))}
                  />
                  <Text style={[s.small, { marginTop: 8 }]}>ใช้วางกะพนักงานให้ตรงกับช่วงที่ลูกค้าเยอะ</Text>
                </Card>

                <Card title="ช่องทางชำระเงิน" basis={280}>
                  <Bars
                    labelWidth={96}
                    items={data.payments.map((p) => {
                      const total = data.payments.reduce((a, x) => a + x.sales, 0) || 1;
                      return {
                        key: p.method, label: PAYMENT_LABEL[p.method], value: p.sales, display: baht(p.sales).replace('.00', ''),
                        sub: `${Math.round((p.sales / total) * 100)}% · ${p.bills} บิล${p.fees ? ` · ค่าธรรมเนียม ${baht(p.fees).replace('.00', '')}` : ''}`,
                      };
                    })}
                  />
                </Card>

                <Card title="พนักงานขาย" basis={280}>
                  <Bars
                    labelWidth={80}
                    items={data.staff.map((p) => ({ key: p.name, label: p.name, value: p.sales, display: baht(p.sales).replace('.00', ''), sub: `${p.bills} บิล` }))}
                  />
                  <View style={s.returns}>
                    <Text style={s.returnsTitle}>คืน / เปลี่ยนสินค้า</Text>
                    <View style={s.row}>
                      <ReturnStat label="เปลี่ยนสินค้า" value={`${data.returns.edits} บิล`} />
                      <ReturnStat label="ยกเลิกบิล" value={`${data.returns.voids} บิล`} />
                      <ReturnStat label="คืนเงิน" value={baht(data.returns.refunded).replace('.00', '')} danger={data.returns.refunded > 0} />
                    </View>
                  </View>
                </Card>
              </View>

              {/* ---------- บิลล่าสุด ---------- */}
              <View style={s.card}>
                <View style={s.cardHead}>
                  <View style={s.row}>
                    <View style={s.bullet} />
                    <Text style={s.cardTitle}>บิลล่าสุด</Text>
                  </View>
                  <Pressable style={s.select} onPress={() => onNavigate('history')}>
                    <Text style={[s.selectText, { color: colors.primary }]}>ดูทั้งหมด</Text>
                    <Icon name="arrow-forward" size={14} color={colors.primary} />
                  </Pressable>
                </View>
                {data.recent.length === 0 ? <Text style={s.empty}>ยังไม่มีบิลในช่วงนี้</Text> : null}
                {data.recent.map((o) => (
                  <View key={o.id} style={s.recentRow}>
                    <Text style={[s.recentNo, mobile && { width: 130 }]}>{o.orderNo}</Text>
                    {!mobile ? <Text style={[s.recentCell, { width: 110 }]}>{bucketLabel(o.createdAt.slice(0, 10), 'day')} · {o.createdAt.slice(11, 16)}</Text> : null}
                    {!mobile ? <Text style={[s.recentCell, { flex: 1 }]} numberOfLines={1}>{o.customerName || 'ลูกค้าทั่วไป'} · {o.salesperson ?? '—'}</Text> : <View style={{ flex: 1 }} />}
                    {width >= 1000 ? <Text style={[s.recentCell, { width: 90 }]}>{PAYMENT_LABEL[o.paymentMethod]}</Text> : null}
                    <Text style={[s.recentTotal, o.status === 'void' && { textDecorationLine: 'line-through', color: colors.faint }]}>{baht(o.total)}</Text>
                    <View style={{ width: 84, alignItems: 'flex-end' }}>
                      <Badge status={o.status} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <Sheet visible={pickBranch} onClose={() => setPickBranch(false)} title="รายงานของสาขา" width={380}>
        <View style={{ gap: 6, paddingBottom: 8 }}>
          {[{ id: '', label: `สาขาปัจจุบัน (${appBranch.name || '-'})`, icon: 'location-outline' as const }, { id: 'all', label: 'รวมทุกสาขา', icon: 'git-network-outline' as const },
            ...branches.filter((b) => b.id !== appBranch.id).map((b) => ({ id: String(b.id), label: `${b.name} (${b.code})`, icon: 'storefront-outline' as const }))].map((o) => {
            const on = o.id === scope;
            return (
              <Pressable key={o.id || 'cur'} onPress={() => { setScope(o.id); setPickBranch(false); }} style={[s.scopeOpt, on && { backgroundColor: colors.primarySoft }]}>
                <Icon name={o.icon} size={18} color={on ? colors.primary : colors.sub} />
                <Text style={[s.pillText, { flex: 1 }, on && { color: colors.primary, fontWeight: '700' }]}>{o.label}</Text>
                {on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
      <Sheet visible={pickDownload} onClose={() => setPickDownload(false)} title="ดาวน์โหลดรายงาน" width={420}>
        <View style={{ gap: 8, paddingBottom: 8 }}>
          <Text style={s.dlNote}>
            {range.from === range.to ? bucketLabel(range.from, 'day') : `${bucketLabel(range.from, 'day')} – ${bucketLabel(range.to, 'day')}`} · {scopeLabel}
          </Text>
          {([
            ['xlsx', 'grid-outline', 'Excel (.xlsx) — ข้อมูลครบสำหรับวิเคราะห์',
              'ยอดรายวัน/เดือน/ชั่วโมง · วัน×ชั่วโมง · สินค้า / SKU / ไซซ์ / สี / หมวดขายดี · การชำระเงิน · พนักงาน · สาขา · โปรโมชั่น · ข้อมูลดิบบิลและรายการขาย (ทำ Pivot ต่อได้)'],
            ['csv', 'document-text-outline', 'CSV — สรุปสั้น', 'ตัวชี้วัด · ยอดตามช่วงเวลา · สินค้าขายดี 10 อันดับ'],
          ] as const).map(([k, icon, label, sub]) => (
            <Pressable key={k} onPress={() => download(k)} style={s.dlOpt} accessibilityLabel={label}>
              <Icon name={icon} size={22} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.pillText, { fontWeight: '700' }]}>{label}</Text>
                <Text style={s.dlNote}>{sub}</Text>
              </View>
              <Icon name="download-outline" size={18} color={colors.sub} />
            </Pressable>
          ))}
        </View>
      </Sheet>
      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="dashboard" onNavigate={onNavigate} />

      <Sheet visible={pickPeriod} onClose={() => setPickPeriod(false)} title="เลือกช่วงเวลา" width={360}>
        <View style={{ gap: 6, paddingBottom: 8 }}>
          {PERIODS.map((p) => {
            const on = p.id === period;
            return (
              <Pressable key={p.id} style={[s.opt, on && s.optOn]} onPress={() => { setPeriod(p.id); setPickPeriod(false); }}>
                <Text style={[s.optText, on && { color: colors.primary, fontWeight: '600' }]}>{p.label}</Text>
                {p.id !== 'custom' ? <Text style={s.optSub}>{(() => { const r = rangeOf(p.id); return r.from === r.to ? bucketLabel(r.from, 'day') : `${bucketLabel(r.from, 'day')} – ${bucketLabel(r.to, 'day')}`; })()}</Text> : null}
                {on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      <Sheet visible={pickMetric} onClose={() => setPickMetric(false)} title="ข้อมูลในกราฟ" width={340}>
        <View style={{ gap: 6, paddingBottom: 8 }}>
          {METRICS.map((x) => (
            <Pressable key={x.id} style={[s.opt, metric === x.id && s.optOn]} onPress={() => { setMetric(x.id); setPickMetric(false); }}>
              <Text style={[s.optText, metric === x.id && { color: colors.primary, fontWeight: '600' }]}>{x.label}</Text>
              {metric === x.id ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

// ---------------- ส่วนประกอบย่อย ----------------
function Kpi({ icon, label, value, unit, cur, prev, money, note }: { icon: IconName; label: string; value: string; unit: string; cur: number; prev: number; money?: boolean; note: string }) {
  const diff = cur - prev;
  const pct = pctChange(cur, prev);
  const up = diff > 0;
  const tone = diff === 0 ? colors.sub : up ? colors.success : colors.danger;
  const bg = diff === 0 ? colors.surface : up ? colors.successSoft : colors.dangerSoft;
  return (
    <View style={s.kpi}>
      <View style={s.kpiHead}>
        <View style={s.kpiIcon}>
          <Icon name={icon} size={16} color={colors.text} />
        </View>
        <Text style={s.kpiLabel}>{label}</Text>
      </View>
      <View style={s.kpiBody}>
        <Text style={s.kpiValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        <Text style={s.kpiUnit}>{unit}</Text>
      </View>
      <Text style={s.kpiNote}>{note}</Text>
      <View style={[s.kpiFoot, { backgroundColor: bg }]}>
        <Text style={[s.kpiDelta, { color: tone }]} numberOfLines={1}>
          {diff === 0 ? 'เท่ากับช่วงก่อน' : `${up ? '+' : '−'}${money ? baht(Math.abs(diff)) : `${n0(Math.abs(diff))} ${unit}`}`}
        </Text>
        <Text style={[s.kpiPct, { color: tone }]}>
          {pct == null ? 'ใหม่' : `${Math.abs(pct)}%`} {diff === 0 ? '' : up ? '↑' : '↓'}
        </Text>
      </View>
    </View>
  );
}

function MiniStat({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: string }) {
  return (
    <View style={s.mini}>
      <Text style={s.miniLabel}>{label}</Text>
      <View style={s.miniRow}>
        <Text style={[s.miniValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
        <Text style={s.miniUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View style={s.row}>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {dashed ? (
          <>
            <View style={[s.legendKey, { width: 7, backgroundColor: color }]} />
            <View style={[s.legendKey, { width: 7, backgroundColor: color }]} />
          </>
        ) : (
          <View style={[s.legendKey, { backgroundColor: color }]} />
        )}
      </View>
      <Text style={s.legendText}>{label}</Text>
    </View>
  );
}

function Card({ title, children, right, basis, grow = 1 }: { title: string; children: ReactNode; right?: ReactNode; basis: number; grow?: number }) {
  return (
    <View style={[s.card, { flexBasis: basis, flexGrow: grow }]}>
      <View style={s.cardHead}>
        <View style={[s.row, { flexShrink: 1 }]}>
          <View style={s.bullet} />
          <Text style={s.cardTitle} numberOfLines={1}>{title}</Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

function ReturnStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.small}>{label}</Text>
      <Text style={[s.returnVal, danger && { color: colors.danger }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  dlOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  dlNote: { fontFamily: font, fontSize: 12, color: colors.sub },
  scopeOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  pillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 16, paddingRight: 8,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  pillText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  dlIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  fLabel: { fontFamily: font, fontSize: 13, color: colors.sub },
  periodBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface },
  periodText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500', minWidth: 80 },
  rangeText: { fontFamily: font, fontSize: 12, color: colors.sub },
  dash: { color: colors.sub },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignSelf: 'flex-start' },
  track: { width: 36, height: 20, borderRadius: 10, backgroundColor: colors.line, padding: 2 },
  trackOn: { backgroundColor: colors.primary },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  error: { fontFamily: font, color: colors.danger, textAlign: 'center' },
  kpi: { flexGrow: 1, flexShrink: 1, flexBasis: 175, maxWidth: '100%', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 8 },
  kpiHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kpiIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  kpiLabel: { fontFamily: font, fontSize: 13, color: colors.text },
  kpiBody: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  kpiValue: { fontFamily: font, fontSize: 28, fontWeight: '600', color: colors.text, flexShrink: 1 },
  kpiUnit: { fontFamily: font, fontSize: 12, color: colors.sub },
  kpiNote: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: -4 },
  kpiFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, gap: 8 },
  kpiDelta: { fontFamily: font, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  kpiPct: { fontFamily: font, fontSize: 11, fontWeight: '700' },
  compareNote: { fontFamily: font, fontSize: 11, color: colors.faint, marginTop: -6 },
  // flexShrink: 1 → การ์ดหดได้บนจอแคบ (ค่าเริ่มต้นของ React Native คือ 0)
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10, minWidth: 0, flexShrink: 1, maxWidth: '100%' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  cardTitle: { fontFamily: font, fontSize: 16, fontWeight: '600', color: colors.text },
  cardMeta: { fontFamily: font, fontSize: 11, color: colors.sub },
  select: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  selectText: { fontFamily: font, fontSize: 12, color: colors.text, fontWeight: '500' },
  legendKey: { width: 16, height: 3, borderRadius: 2 },
  legendText: { fontFamily: font, fontSize: 11, color: colors.sub },
  mini: { flexGrow: 1, flexShrink: 1, flexBasis: 140, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  miniLabel: { fontFamily: font, fontSize: 11, color: colors.sub },
  miniRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
  miniValue: { fontFamily: font, fontSize: 18, fontWeight: '600', color: colors.text, flexShrink: 1 },
  miniUnit: { fontFamily: font, fontSize: 11, color: colors.sub },
  roundBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  search: { fontFamily: font, fontSize: 13, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface, paddingHorizontal: 14, color: colors.text },
  thead: { flexDirection: 'row', gap: 8, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  th: { fontFamily: font, fontSize: 11, color: colors.sub },
  empty: { fontFamily: font, fontSize: 12, color: colors.faint, textAlign: 'center', paddingVertical: 20 },
  prodRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  rank: { position: 'absolute', top: -4, left: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  rankText: { fontFamily: font, fontSize: 9, fontWeight: '700', color: '#fff' },
  prodName: { fontFamily: font, fontSize: 13, fontWeight: '500', color: colors.text },
  catChip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 1, borderRadius: radius.pill },
  catText: { fontFamily: font, fontSize: 10, fontWeight: '500' },
  prodUnits: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  prodSales: { fontFamily: font, fontSize: 11, color: colors.sub },
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3 },
  segBtn: { paddingHorizontal: 14, height: 28, borderRadius: radius.pill, justifyContent: 'center' },
  segOn: { backgroundColor: '#fff' },
  segText: { fontFamily: font, fontSize: 12, color: colors.sub },
  segTextOn: { color: colors.text, fontWeight: '600' },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  lowRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  small: { fontFamily: font, fontSize: 11, color: colors.sub },
  stockPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  stockText: { fontFamily: font, fontSize: 11, fontWeight: '600' },
  returns: { marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line, gap: 6 },
  returnsTitle: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text },
  returnVal: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  recentNo: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text, width: 140 },
  recentCell: { fontFamily: font, fontSize: 12, color: colors.sub },
  recentTotal: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text, width: 100, textAlign: 'right' },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 46, borderRadius: radius.md, backgroundColor: colors.surface },
  optOn: { backgroundColor: colors.primarySoft },
  optText: { fontFamily: font, fontSize: 14, color: colors.text, flex: 1 },
  optSub: { fontFamily: font, fontSize: 11, color: colors.sub },
});
