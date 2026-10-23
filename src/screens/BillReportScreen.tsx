// รายงาน → ยอดขายรายบิล: ทุกบิลในช่วงวันที่ — ยอดขาย ส่วนลด ยอดสุทธิ VAT ต้นทุน กำไร วิธีชำระ สถานะ + ส่งออก Excel
// ค้นหาเลขที่บิล / ลูกค้า / พนักงาน · กรองวิธีชำระ / สถานะ · กดเลขที่บิลเพื่อดูรายละเอียด
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type BillReport, type BillReportFilter, type BillReportRow } from '../api';
import { useAppSettings } from '../appSettings';
import { Badge } from '../components/history/Badge';
import { OrderDetailModal } from '../components/history/OrderDetailModal';
import { Icon } from '../components/Icon';
import type { Route } from '../components/NavMenu';
import {
  BranchControl, clearReportHandoff, DataTable, ExcelButton, k, Pager, peekReportHandoff, PeriodControl, ReportPage, useBranchScope, usePeriod, type Column,
} from '../components/report/ReportKit';
import { ToastView } from '../components/ToastView';
import { n0, n2 } from '../format';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import type { Bootstrap } from '../types';

const STATUSES: { id: string; label: string }[] = [
  { id: '', label: 'ทุกสถานะ' },
  { id: 'paid', label: 'ชำระแล้ว' },
  { id: 'edited', label: 'แก้ไขแล้ว' },
  { id: 'void', label: 'ยกเลิก' },
];

export function BillReportScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  // มาจากการคลิกวันในรายงานยอดขาย → เริ่มที่ช่วงวันที่ / สาขานั้น
  const [from] = useState(peekReportHandoff);
  useEffect(() => clearReportHandoff(), []);
  const p = usePeriod('today', from);
  const b = useBranchScope(from?.branch ?? '');
  const settings = useAppSettings();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [payment, setPayment] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' }>({ id: 'time', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BillReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<Bootstrap | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);

  // ค้นหาแบบหน่วงเวลา
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
  // เปลี่ยนตัวกรอง → กลับไปหน้าแรก
  useEffect(() => {
    setPage(1);
  }, [p.range.from, p.range.to, b.scope, q, payment, status, sort.id, sort.dir]);

  const filter: BillReportFilter = {
    ...p.range, branch: b.scope || undefined, q: q || undefined, payment: payment || undefined, status: status || undefined, sort: sort.id, dir: sort.dir,
  };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.billReport({ ...filter, page, limit: 50 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [p.range.from, p.range.to, b.scope, q, payment, status, sort.id, sort.dir, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  // ข้อมูลสินค้า (ใช้ตอนแก้ไขบิลจากหน้ารายละเอียด) — โหลดเมื่อเปิดบิลครั้งแรก
  const open = (id: number) => {
    setSelected(id);
    if (!catalog) api.bootstrap().then(setCatalog, (e: Error) => notify('error', e.message));
  };

  const t = data?.total;
  const money = (v: number) => `${Number.isInteger(v) ? n0(v) : n2(v)} ฿`;
  const allBranches = b.scope === 'all';
  const isVoid = (r: BillReportRow) => r.status === 'void';
  const num = (r: BillReportRow, v: number, bold = false) => (
    <Text style={[k.tdText, { textAlign: 'center' }, bold && { fontWeight: '600' }, (!v || isVoid(r)) && { color: colors.faint, fontWeight: '400' }, isVoid(r) && s.strike]}>
      {money(v)}
    </Text>
  );
  const text = (v: string | null | undefined, faint = false) => (
    <Text style={[k.tdText, (faint || !v) && { color: colors.faint }]} numberOfLines={1}>{v || '-'}</Text>
  );

  const cols: Column<BillReportRow>[] = [
    {
      id: 'no', label: 'เลขที่บิล', width: 150, sortable: true,
      render: (r) => (
        <Pressable onPress={() => open(r.id)} accessibilityRole="link" accessibilityLabel={`ดูบิล ${r.orderNo}`}>
          <Text style={[k.tdText, { color: colors.primary, fontWeight: '600' }, isVoid(r) && s.strike]} numberOfLines={1}>{r.orderNo}</Text>
        </Pressable>
      ),
      total: t ? `รวม ${n0(t.bills)} บิล` : undefined,
    },
    {
      id: 'time', label: 'วันที่ - เวลา', width: 150, sortable: true,
      render: (r) => <Text style={k.tdText} numberOfLines={1}>{dateTime(r.createdAt)}</Text>,
    },
    ...(allBranches ? [{ id: 'branch', label: 'สาขา', width: 120, render: (r: BillReportRow) => text(r.branch) }] : []),
    { id: 'staff', label: 'พนักงานขาย', width: 120, sortable: true, render: (r) => text(r.salesperson) },
    { id: 'customer', label: 'ลูกค้า', width: 130, sortable: true, render: (r) => text(r.customer) },
    { id: 'payment', label: 'ชำระโดย', width: 140, sortable: true, render: (r) => text(r.paymentLabel, isVoid(r)) },
    {
      id: 'units', label: 'ชิ้น', width: 64, align: 'center', sortable: true,
      render: (r) => <Text style={[k.tdText, { textAlign: 'center' }, isVoid(r) && { color: colors.faint }]}>{n0(r.units)}</Text>,
      total: t && n0(t.units),
    },
    { id: 'gross', label: 'ยอดขาย', width: 110, align: 'center', sortable: true, render: (r) => num(r, r.gross), total: t && money(t.gross) },
    { id: 'discount', label: 'ส่วนลด', width: 96, align: 'center', sortable: true, render: (r) => num(r, r.discount), total: t && money(t.discount) },
    { id: 'net', label: 'ยอดสุทธิ', width: 120, align: 'center', sortable: true, render: (r) => num(r, r.net, true), total: t && money(t.net) },
    { id: 'vat', label: 'VAT', width: 96, align: 'center', sortable: true, render: (r) => num(r, r.vat), total: t && money(t.vat) },
    { id: 'cost', label: 'ต้นทุน', width: 110, align: 'center', sortable: true, render: (r) => num(r, r.cost), total: t && money(t.cost) },
    {
      id: 'profit', label: 'กำไร', width: 110, align: 'center', sortable: true,
      render: (r) =>
        isVoid(r) ? (
          <Text style={[k.tdText, { textAlign: 'center', color: colors.faint }]}>-</Text>
        ) : (
          <Text style={[k.tdText, { textAlign: 'center', color: r.profit < 0 ? colors.danger : r.profit ? colors.success : colors.faint }]}>{money(r.profit)}</Text>
        ),
      total: t && money(t.profit),
    },
    {
      id: 'status', label: 'สถานะ', width: 110, align: 'center', sortable: true,
      render: (r) => (
        <View style={{ alignItems: 'center' }}>
          <Badge status={r.status} edits={r.editCount} />
        </View>
      ),
    },
  ];

  const methods = settings.payments.methods.filter((m) => m.enabled || m.id === payment);

  return (
    <ReportPage
      route="billReport"
      title="รายงานยอดขายรายบิล"
      sub="ทุกบิลในช่วงวันที่ — ยอดขาย ส่วนลด ยอดสุทธิ ต้นทุน กำไร วิธีชำระ และสถานะบิล"
      onNavigate={onNavigate}
      right={<ExcelButton url={() => api.billReportXlsxUrl(filter)} disabled={!data} />}
    >
      <View style={k.toolbar}>
        <PeriodControl p={p} />
        <BranchControl b={b} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="ค้นหา เลขที่บิล / ลูกค้า / พนักงานขาย"
          placeholderTextColor={colors.faint}
          style={k.search}
          accessibilityLabel="ค้นหาบิล"
        />
        <Pressable style={k.pill} onPress={load} accessibilityLabel="โหลดใหม่">
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="refresh" size={16} color={colors.primary} />}
        </Pressable>
      </View>
      <View style={k.toolbar}>
        <View style={[k.seg, { flexWrap: 'wrap' }]}>
          {[{ id: '', label: 'ทุกวิธีชำระ' }, ...methods.map((m) => ({ id: m.id as string, label: m.label }))].map((m) => (
            <Pressable key={m.id || 'all'} style={[k.segBtn, payment === m.id && k.segOn]} onPress={() => setPayment(m.id)} accessibilityRole="button" accessibilityState={{ selected: payment === m.id }}>
              <Text style={[k.segText, payment === m.id && { color: '#fff', fontWeight: '600' }]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={k.seg}>
          {STATUSES.map((x) => (
            <Pressable key={x.id || 'all'} style={[k.segBtn, status === x.id && k.segOn]} onPress={() => setStatus(x.id)} accessibilityRole="button" accessibilityState={{ selected: status === x.id }}>
              <Text style={[k.segText, status === x.id && { color: '#fff', fontWeight: '600' }]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error ? <Text style={k.error}>{error}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        {t ? (
          <View style={s.cards}>
            <Card label="จำนวนบิล" value={n0(t.bills)} sub={[t.edited ? `แก้ไข ${n0(t.edited)}` : '', t.voided ? `ยกเลิก ${n0(t.voided)}` : ''].filter(Boolean).join(' · ') || 'ไม่รวมบิลที่ยกเลิก'} />
            <Card label="ยอดสุทธิ" value={money(t.net)} sub={`เฉลี่ย ${money(t.bills ? Math.round((t.net / t.bills) * 100) / 100 : 0)} / บิล`} tone={colors.primary} />
            <Card label="กำไร" value={money(t.profit)} sub={`ต้นทุน ${money(t.cost)} · VAT ${money(t.vat)}`} tone={t.profit < 0 ? colors.danger : colors.success} />
            <View style={[s.card, { flexGrow: 2 }]}>
              <Text style={s.cardLabel}>แยกตามวิธีชำระ</Text>
              {data.byPayment.length === 0 ? <Text style={s.cardSub}>-</Text> : null}
              {data.byPayment.map((m) => (
                <View key={m.payment} style={s.payRow}>
                  <Text style={s.payText} numberOfLines={1}>{m.label} <Text style={s.cardSub}>({n0(m.bills)} บิล)</Text></Text>
                  <Text style={[s.payText, { fontWeight: '700' }]}>{money(m.net)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <Pager page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} info={data ? `ทั้งหมด ${n0(data.total.rows)} บิล · ${b.label}` : ''} />
        <View style={{ opacity: loading ? 0.55 : 1 }}>
          <DataTable
            cols={cols}
            rows={data?.rows ?? []}
            keyOf={(r) => String(r.id)}
            sort={sort}
            onSort={(id) => setSort((x) => ({ id, dir: x.id === id ? (x.dir === 'desc' ? 'asc' : 'desc') : ['no', 'staff', 'customer', 'payment'].includes(id) ? 'asc' : 'desc' }))}
            empty={loading ? 'กำลังโหลด…' : 'ไม่มีบิลในช่วงนี้'}
            rowStyle={(r) => (r.status === 'void' ? { backgroundColor: '#FFF7F7' } : undefined)}
          />
        </View>
        <Text style={k.note}>
          ยอดขาย = ก่อนส่วนลดท้ายบิล · ยอดสุทธิ = ยอดที่เก็บจริง (หลังแก้ไขบิล รวม VAT) · กำไร = ยอดสุทธิ − VAT − ต้นทุน · บิลที่ยกเลิกแสดงไว้ (ขีดฆ่า) แต่ไม่นับในยอดรวม ·
          ยอดรวมตรงกับรายงานยอดขาย · กดเลขที่บิลเพื่อดูรายละเอียด
        </Text>
      </ScrollView>

      <OrderDetailModal orderId={selected} catalog={catalog} onClose={() => setSelected(null)} onChanged={load} notify={notify} />
      <ToastView toast={toast} onDone={() => setToast(null)} />
    </ReportPage>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{label}</Text>
      <Text style={[s.cardValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={s.cardSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

/** 2026-10-23 11:56:31 → 23/10/2569 11:56 */
function dateTime(s: string) {
  const [d, t] = s.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  return `${day}/${m}/${y + 543} ${t?.slice(0, 5) ?? ''}`;
}

const s = StyleSheet.create({
  strike: { textDecorationLine: 'line-through' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { flexGrow: 1, flexBasis: 180, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 4 },
  cardLabel: { fontFamily: font, fontSize: 12, color: colors.sub },
  cardValue: { fontFamily: font, fontSize: 22, fontWeight: '700', color: colors.text },
  cardSub: { fontFamily: font, fontSize: 11, color: colors.sub },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  payText: { fontFamily: font, fontSize: 13, color: colors.text, flexShrink: 1 },
});
