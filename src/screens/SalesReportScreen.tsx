// รายงาน → ยอดขาย: ยอดขายรายวัน / รายสัปดาห์ / รายเดือน + ส่งออก Excel
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { api, type SalesReport, type SalesReportRow } from '../api';
import { Icon } from '../components/Icon';
import type { Route } from '../components/NavMenu';
import {
  BranchControl, DataTable, ExcelButton, k, Pager, PeriodControl, ReportPage, setReportHandoff, useBranchScope, usePeriod, type Column,
} from '../components/report/ReportKit';
import { n0, n2 } from '../format';
import { colors } from '../theme';

type Group = 'day' | 'week' | 'month';
const GROUPS: { id: Group; label: string }[] = [
  { id: 'day', label: 'รายวัน' },
  { id: 'week', label: 'รายสัปดาห์' },
  { id: 'month', label: 'รายเดือน' },
];
const PAGE = 31;
type Key = keyof Omit<SalesReportRow, 'label' | 'from' | 'to'>;

export function SalesReportScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const p = usePeriod('month');
  const b = useBranchScope();
  const [group, setGroup] = useState<Group>('day');
  const [data, setData] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' }>({ id: 'key', dir: 'desc' });
  const [page, setPage] = useState(1);

  const filter = { ...p.range, group, branch: b.scope || undefined };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.salesReport(filter));
      setPage(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [p.range.from, p.range.to, group, b.scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    const id = sort.id as Key;
    list.sort((a, c) => {
      const x = a[id];
      const y = c[id];
      const r = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? r : -r;
    });
    return list;
  }, [data, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const t = data?.total;
  const money = (v: number) => `${Number.isInteger(v) ? n0(v) : n2(v)} ฿`;
  const dim = (v: number, s: string) => <Text style={[k.tdText, { textAlign: 'center' }, !v && { color: colors.faint }]}>{s}</Text>;

  const cols: Column<SalesReportRow>[] = [
    {
      id: 'key', label: group === 'day' ? 'วันที่' : group === 'week' ? 'สัปดาห์' : 'เดือน', width: 190, sortable: true,
      render: (r) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[k.tdText, { color: colors.primary, textDecorationLine: r.bills ? 'underline' : 'none' }]}>{r.label}</Text>
          {r.bills ? <Icon name="chevron-forward" size={12} color={colors.primary} /> : null}
        </View>
      ),
      total: 'รวม (฿)',
    },
    { id: 'bills', label: 'บิล', width: 70, align: 'center', sortable: true, render: (r) => dim(r.bills, n0(r.bills)), total: t && n0(t.bills) },
    { id: 'units', label: 'ชิ้น', width: 70, align: 'center', sortable: true, render: (r) => dim(r.units, n0(r.units)), total: t && n0(t.units) },
    { id: 'gross', label: 'ยอดขาย', width: 120, align: 'center', sortable: true, render: (r) => dim(r.gross, money(r.gross)), total: t && money(t.gross) },
    { id: 'discount', label: 'ส่วนลด', width: 100, align: 'center', sortable: true, render: (r) => dim(r.discount, money(r.discount)), total: t && money(t.discount) },
    { id: 'refund', label: 'คืนเงิน', width: 100, align: 'center', sortable: true, render: (r) => dim(r.refund, money(r.refund)), total: t && money(t.refund) },
    {
      id: 'net', label: 'ยอดสุทธิ', width: 130, align: 'center', sortable: true,
      render: (r) => <Text style={[k.tdText, { fontWeight: '600', textAlign: 'center' }, !r.net && { color: colors.faint, fontWeight: '400' }]}>{money(r.net)}</Text>,
      total: t && money(t.net),
    },
    { id: 'vat', label: 'VAT', width: 100, align: 'center', sortable: true, render: (r) => dim(r.vat, money(r.vat)), total: t && money(t.vat) },
    { id: 'cost', label: 'ต้นทุน', width: 120, align: 'center', sortable: true, render: (r) => dim(r.cost, money(r.cost)), total: t && money(t.cost) },
    {
      id: 'profit', label: 'กำไร', width: 130, align: 'center', sortable: true,
      render: (r) => <Text style={[k.tdText, { textAlign: 'center', color: r.profit < 0 ? colors.danger : r.profit ? colors.success : colors.faint }]}>{money(r.profit)}</Text>,
      total: t && money(t.profit),
    },
  ];

  return (
    <ReportPage
      route="salesReport"
      title="รายงานยอดขาย"
      sub="ยอดขาย ส่วนลด คืนเงิน ต้นทุน กำไร — รายวัน / รายสัปดาห์ / รายเดือน"
      onNavigate={onNavigate}
      right={<ExcelButton url={() => api.salesReportXlsxUrl(filter)} disabled={!data} />}
    >
      <View style={k.toolbar}>
        <PeriodControl p={p} />
        <View style={k.seg}>
          {GROUPS.map((g) => (
            <Pressable key={g.id} style={[k.segBtn, group === g.id && k.segOn]} onPress={() => setGroup(g.id)} accessibilityRole="button" accessibilityState={{ selected: group === g.id }}>
              <Text style={[k.segText, group === g.id && { color: '#fff', fontWeight: '600' }]}>{g.label}</Text>
            </Pressable>
          ))}
        </View>
        <BranchControl b={b} />
        <Pressable style={k.pill} onPress={load} accessibilityLabel="โหลดใหม่">
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="refresh" size={16} color={colors.primary} />}
        </Pressable>
      </View>
      {error ? <Text style={k.error}>{error}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        <Pager page={page} pages={pages} onPage={setPage} info={data ? `ทั้งหมด ${n0(rows.length)} รายการ · ${b.label}` : ''} />
        <View style={{ opacity: loading ? 0.55 : 1 }}>
          <DataTable
            cols={cols}
            rows={shown}
            keyOf={(r) => r.key}
            // คลิกวัน (หรือสัปดาห์ / เดือน) → ดูบิลทั้งหมดของช่วงนั้นในรายงานรายบิล
            onRowPress={(r) => {
              setReportHandoff({ from: r.from, to: r.to, branch: b.scope });
              onNavigate('billReport');
            }}
            rowHint={(r) => `ดูบิลทั้งหมดของ ${r.label}`}
            sort={sort}
            onSort={(id) => setSort((s) => ({ id, dir: s.id === id && s.dir === 'desc' ? 'asc' : 'desc' }))}
            empty={loading ? 'กำลังโหลด…' : 'ไม่มีข้อมูลในช่วงนี้'}
          />
        </View>
        <Text style={k.note}>
          คลิกวันที่เพื่อดูบิลทั้งหมดของวันนั้น · ยอดขาย = ก่อนส่วนลดท้ายบิล · ยอดสุทธิ = ยอดที่เก็บจริง (หลังแก้ไขบิล รวม VAT · หักใบลดหนี้ในวันที่ออก) · คืนเงิน = เงินที่คืนลูกค้าจากการเปลี่ยน/คืนสินค้า และใบลดหนี้ (หักในยอดแล้ว) · กำไร = ยอดสุทธิ − VAT − ต้นทุน · ไม่รวมบิลที่ยกเลิก
        </Text>
      </ScrollView>
    </ReportPage>
  );
}
