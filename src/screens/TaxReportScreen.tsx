// รายงาน → ภาษีขาย (VAT) สำหรับฝ่ายบัญชี
// - สรุปรายวันต่อเครื่อง POS: เลขที่บิลแรก–สุดท้าย · ยอดขาย · ฐานภาษี · VAT · ยอดยกเว้น · บิลยกเลิก · Grand Total สะสม
// - รายงานภาษีขาย (รายบิล) · บิลยกเลิก (เหตุผล / ผู้ทำรายการ / ผู้อนุมัติ / เวลา)
// - สรุปตามอัตรา VAT (ประกอบ ภ.พ.30) · ส่งออก Excel ครบทุกแผ่นในไฟล์เดียว
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, type TaxBillRow, type TaxCreditRow, type TaxDayRow, type TaxFullInvoiceRow, type TaxReport, type TaxReportFilter } from '../api';
import { useAppSettings } from '../appSettings';
import { Badge } from '../components/history/Badge';
import { OrderDetailModal } from '../components/history/OrderDetailModal';
import { Icon } from '../components/Icon';
import type { Route } from '../components/NavMenu';
import { BranchControl, DataTable, ExcelButton, k, Pager, PeriodControl, ReportPage, useBranchScope, usePeriod, type Column } from '../components/report/ReportKit';
import { ToastView } from '../components/ToastView';
import { n0, n2 } from '../format';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import type { Bootstrap, OrderStatus } from '../types';

type Tab = 'days' | 'bills' | 'voids' | 'credits' | 'invoices';
const TABS: { id: Tab; label: string }[] = [
  { id: 'days', label: 'สรุปรายวันต่อเครื่อง' },
  { id: 'bills', label: 'รายงานภาษีขาย (รายบิล)' },
  { id: 'voids', label: 'บิลยกเลิก' },
  { id: 'credits', label: 'ใบลดหนี้' },
  { id: 'invoices', label: 'ใบกำกับเต็มรูป' },
];

export function TaxReportScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const p = usePeriod('month');
  const b = useBranchScope('');
  const tax = useAppSettings().tax;
  const [tab, setTab] = useState<Tab>('days');
  const [terminal, setTerminal] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<Bootstrap | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);

  useEffect(() => {
    setPage(1);
  }, [p.range.from, p.range.to, b.scope, terminal]);
  const filter: TaxReportFilter = { ...p.range, branch: b.scope || undefined, terminal: terminal || undefined };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.taxReport({ ...filter, page, limit: 100 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [p.range.from, p.range.to, b.scope, terminal, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const open = (id: number) => {
    setSelected(id);
    if (!catalog) api.bootstrap().then(setCatalog, () => {});
  };

  const t = data?.total;
  const money = (v: number) => n2(v);
  const num = (v: number, bold = false, faint = false) => (
    <Text style={[k.tdText, { textAlign: 'right' }, bold && { fontWeight: '700' }, (faint || !v) && { color: colors.faint, fontWeight: '400' }]}>{money(v)}</Text>
  );
  const allBranches = b.scope === 'all';

  const dayCols: Column<TaxDayRow>[] = [
    { id: 'day', label: 'วันที่', width: 96, render: (r) => <Text style={k.tdText}>{dateText(r.day)}</Text>, total: 'รวม' },
    ...(allBranches ? [{ id: 'branch', label: 'สาขา', width: 120, render: (r: TaxDayRow) => <Text style={k.tdText} numberOfLines={1}>{r.branch}</Text> }] : []),
    {
      id: 'terminal', label: 'เครื่อง POS', width: 132,
      render: (r) => (
        <View>
          <Text style={[k.tdText, { fontWeight: '600' }, !r.terminal && { color: colors.faint }]}>{r.terminal ?? 'ไม่ระบุเครื่อง'}</Text>
          {r.rdNo ? <Text style={s.mini} numberOfLines={1}>{r.rdNo}</Text> : null}
        </View>
      ),
    },
    {
      id: 'range', label: 'เลขที่บิลแรก – สุดท้าย', width: 230,
      render: (r) => (
        <View>
          <Text style={[k.tdText, s.mono]} numberOfLines={1}>{r.firstNo}</Text>
          <Text style={[k.tdText, s.mono]} numberOfLines={1}>{r.lastNo}</Text>
          {r.continuous === false ? <Text style={[s.mini, { color: colors.danger }]}>⚠ เลขที่ไม่ต่อเนื่อง — ตรวจสอบ</Text> : null}
        </View>
      ),
    },
    { id: 'bills', label: 'บิล', width: 56, align: 'center', render: (r) => <Text style={[k.tdText, { textAlign: 'center' }]}>{n0(r.bills)}</Text>, total: t && n0(t.bills) },
    { id: 'total', label: 'ยอดขาย', width: 110, align: 'right', render: (r) => num(r.total, true), total: t && money(t.total) },
    { id: 'base', label: 'ฐานภาษี', width: 110, align: 'right', render: (r) => num(r.vatBase), total: t && money(t.vatBase) },
    { id: 'vat', label: 'VAT', width: 96, align: 'right', render: (r) => num(r.vat), total: t && money(t.vat) },
    { id: 'exempt', label: 'ยกเว้น VAT', width: 100, align: 'right', render: (r) => num(r.exempt), total: t && money(t.exempt) },
    {
      id: 'void', label: 'บิลยกเลิก', width: 110, align: 'right',
      render: (r) =>
        r.voids ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[k.tdText, { color: colors.danger }]}>{n0(r.voids)} ใบ</Text>
            <Text style={s.mini}>{money(r.voidTotal)}</Text>
          </View>
        ) : (
          <Text style={[k.tdText, { textAlign: 'right', color: colors.faint }]}>-</Text>
        ),
      total: t && (t.voids ? `${n0(t.voids)} ใบ · ${money(t.voidTotal)}` : '-'),
    },
    {
      id: 'gt', label: 'Grand Total สะสม', width: 140, align: 'right',
      render: (r) => (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[k.tdText, { fontWeight: '700', color: colors.primary }]}>{money(r.gtEnd)}</Text>
          <Text style={s.mini}>ยกมา {money(r.gtStart)}</Text>
        </View>
      ),
    },
  ];

  const billCols: Column<TaxBillRow>[] = [
    { id: 'time', label: 'วันที่-เวลา', width: 128, render: (r) => <Text style={k.tdText}>{dateTime(r.createdAt)}</Text> },
    {
      id: 'no', label: 'เลขที่บิล', width: 200,
      render: (r) => (
        <Pressable onPress={() => open(r.id)} accessibilityRole="link" accessibilityLabel={`ดูบิล ${r.orderNo}`}>
          <Text style={[k.tdText, s.mono, { color: colors.primary, fontWeight: '600' }, r.status === 'void' && s.strike]} numberOfLines={1}>{r.orderNo}</Text>
        </Pressable>
      ),
      total: t ? `รวม ${n0(t.bills - t.voids)} ใบ` : undefined,
    },
    ...(allBranches ? [{ id: 'branch', label: 'สาขา', width: 110, render: (r: TaxBillRow) => <Text style={k.tdText} numberOfLines={1}>{r.branch}</Text> }] : []),
    { id: 'terminal', label: 'เครื่อง', width: 80, render: (r) => <Text style={[k.tdText, !r.terminal && { color: colors.faint }]}>{r.terminal ?? '-'}</Text> },
    { id: 'rate', label: 'อัตรา', width: 60, align: 'center', render: (r) => <Text style={[k.tdText, { textAlign: 'center' }]}>{r.vatRate ? `${r.vatRate}%` : '-'}</Text> },
    { id: 'base', label: 'ฐานภาษี', width: 110, align: 'right', render: (r) => num(r.vatBase, false, r.status === 'void'), total: t && money(t.vatBase) },
    { id: 'vat', label: 'VAT', width: 96, align: 'right', render: (r) => num(r.vat, false, r.status === 'void'), total: t && money(t.vat) },
    { id: 'exempt', label: 'ยกเว้น VAT', width: 100, align: 'right', render: (r) => num(r.exempt, false, r.status === 'void'), total: t && money(t.exempt) },
    { id: 'total', label: 'รวมทั้งสิ้น', width: 110, align: 'right', render: (r) => num(r.total, true, r.status === 'void'), total: t && money(t.total) },
    {
      id: 'status', label: 'สถานะ', width: 100, align: 'center',
      render: (r) => (
        <View style={{ alignItems: 'center' }}>
          <Badge status={r.status as OrderStatus} edits={0} />
        </View>
      ),
    },
  ];

  const voidCols: Column<TaxBillRow>[] = [
    {
      id: 'no', label: 'เลขที่บิล', width: 200,
      render: (r) => (
        <Pressable onPress={() => open(r.id)} accessibilityRole="link">
          <Text style={[k.tdText, s.mono, { color: colors.primary, fontWeight: '600' }]} numberOfLines={1}>{r.orderNo}</Text>
        </Pressable>
      ),
      total: t ? `รวม ${n0(t.voids)} ใบ` : undefined,
    },
    { id: 'time', label: 'วันที่ออกบิล', width: 128, render: (r) => <Text style={k.tdText}>{dateTime(r.createdAt)}</Text> },
    { id: 'total', label: 'ยอดบิล', width: 100, align: 'right', render: (r) => num(r.total, true), total: t && money(t.voidTotal) },
    { id: 'voidedAt', label: 'เวลายกเลิก', width: 128, render: (r) => <Text style={k.tdText}>{r.voidedAt ? dateTime(r.voidedAt) : '-'}</Text> },
    { id: 'reason', label: 'เหตุผล', width: 200, render: (r) => <Text style={k.tdText} numberOfLines={2}>{r.voidReason ?? '-'}</Text> },
    { id: 'by', label: 'ผู้ทำรายการ', width: 120, render: (r) => <Text style={k.tdText} numberOfLines={1}>{r.voidedBy ?? '-'}</Text> },
    { id: 'approver', label: 'ผู้อนุมัติ', width: 120, render: (r) => <Text style={[k.tdText, { fontWeight: '600' }]} numberOfLines={1}>{r.voidApprover ?? '-'}</Text> },
  ];

  const ct = data?.creditTotal;
  const creditCols: Column<TaxCreditRow>[] = [
    { id: 'no', label: 'เลขที่ใบลดหนี้', width: 150, render: (r) => <Text style={[k.tdText, s.mono, { fontWeight: '600' }]}>{r.docNo}</Text>, total: ct ? `รวม ${n0(ct.count)} ใบ` : undefined },
    { id: 'time', label: 'วันที่', width: 128, render: (r) => <Text style={k.tdText}>{dateTime(r.issuedAt)}</Text> },
    {
      id: 'ref', label: 'อ้างอิงบิล', width: 190,
      render: (r) => (
        <View>
          <Text style={[k.tdText, s.mono]} numberOfLines={1}>{r.orderNo}</Text>
          <Text style={s.mini}>บิลวันที่ {dateTime(r.orderDate)}</Text>
        </View>
      ),
    },
    { id: 'rate', label: 'อัตรา', width: 60, align: 'center', render: (r) => <Text style={[k.tdText, { textAlign: 'center' }]}>{r.vatRate}%</Text> },
    { id: 'base', label: 'ฐานภาษี', width: 110, align: 'right', render: (r) => num(r.vatBase), total: ct && money(ct.vatBase) },
    { id: 'vat', label: 'VAT', width: 96, align: 'right', render: (r) => num(r.vat), total: ct && money(ct.vat) },
    { id: 'exempt', label: 'ยกเว้น VAT', width: 100, align: 'right', render: (r) => num(r.exempt), total: ct && money(ct.exempt) },
    { id: 'total', label: 'ยอดคืน', width: 110, align: 'right', render: (r) => num(r.total, true), total: ct && money(ct.total) },
    { id: 'reason', label: 'เหตุผล', width: 180, render: (r) => <Text style={k.tdText} numberOfLines={2}>{r.reason}</Text> },
    { id: 'by', label: 'ผู้ทำ / ผู้อนุมัติ', width: 160, render: (r) => <Text style={k.tdText} numberOfLines={2}>{r.issuedBy} / {r.approver}</Text> },
  ];
  const invoiceCols: Column<TaxFullInvoiceRow>[] = [
    { id: 'no', label: 'เลขที่', width: 150, render: (r) => <Text style={[k.tdText, s.mono, { fontWeight: '600' }, r.status === 'cancelled' && s.strike]}>{r.docNo}</Text> },
    { id: 'time', label: 'วันที่', width: 128, render: (r) => <Text style={k.tdText}>{dateTime(r.issuedAt)}</Text> },
    { id: 'ref', label: 'อ้างอิงบิล', width: 190, render: (r) => <Text style={[k.tdText, s.mono]} numberOfLines={1}>{r.orderNo}</Text> },
    {
      id: 'buyer', label: 'ผู้ซื้อ', width: 220,
      render: (r) => (
        <View>
          <Text style={k.tdText} numberOfLines={1}>{r.buyerName}</Text>
          <Text style={s.mini}>{r.buyerTaxId}{r.buyerBranchText ? ` · ${r.buyerBranchText}` : ''}</Text>
        </View>
      ),
    },
    { id: 'base', label: 'ฐานภาษี', width: 110, align: 'right', render: (r) => num(r.vatBase, false, r.status === 'cancelled') },
    { id: 'vat', label: 'VAT', width: 96, align: 'right', render: (r) => num(r.vat, false, r.status === 'cancelled') },
    { id: 'total', label: 'รวม', width: 110, align: 'right', render: (r) => num(r.total, true, r.status === 'cancelled') },
    {
      id: 'status', label: 'สถานะ', width: 160,
      render: (r) => (
        <Text style={[k.tdText, r.status === 'cancelled' && { color: colors.danger }]} numberOfLines={2}>
          {r.status === 'cancelled' ? `ยกเลิก: ${r.cancelReason ?? ''}` : 'ใช้งาน'}
        </Text>
      ),
    },
  ];

  const h = data?.header;
  return (
    <ReportPage
      route="taxReport"
      title="รายงานภาษีขาย (VAT)"
      sub="สรุปรายวันต่อเครื่อง POS · รายงานภาษีขายรายบิล · บิลยกเลิก · Grand Total สะสม — สำหรับฝ่ายบัญชี / ยื่น ภ.พ.30"
      onNavigate={onNavigate}
      right={<ExcelButton url={() => api.taxReportXlsxUrl(filter)} disabled={!data} />}
    >
      <View style={k.toolbar}>
        <PeriodControl p={p} />
        <BranchControl b={b} />
        <Pressable style={k.pill} onPress={load} accessibilityLabel="โหลดใหม่">
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="refresh" size={16} color={colors.primary} />}
        </Pressable>
      </View>
      {data && data.terminals.length ? (
        <View style={k.toolbar}>
          <View style={[k.seg, { flexWrap: 'wrap' }]}>
            {[{ id: '', label: 'ทุกเครื่อง' }, ...data.terminals.map((x) => ({ id: String(x.id), label: x.code })), ...(t?.noTerminal ? [{ id: 'none', label: 'ไม่ระบุเครื่อง' }] : [])].map((x) => (
              <Pressable key={x.id || 'all'} style={[k.segBtn, terminal === x.id && k.segOn]} onPress={() => setTerminal(x.id)} accessibilityRole="button">
                <Text style={[k.segText, terminal === x.id && { color: '#fff', fontWeight: '600' }]}>{x.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {error ? <Text style={k.error}>{error}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        {h ? (
          <View style={s.head}>
            <Icon name="business-outline" size={16} color={colors.sub} />
            <Text style={s.headText}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{h.legalName}</Text>
              {h.taxId ? ` · เลขประจำตัวผู้เสียภาษี ${h.taxId}` : ' · ยังไม่ได้ใส่เลขประจำตัวผู้เสียภาษี'}
              {h.branches.length ? ` · ${h.branches.map((x) => `${x.name}${x.taxBranch ? ` (${x.taxBranch})` : ''}`).join(', ')}` : ''}
            </Text>
            {!h.taxId || (tax && !tax.taxBranchNo && tax.vatRegistered) ? (
              <Pressable onPress={() => onNavigate('settings')}>
                <Text style={s.link}>ตั้งค่าภาษี</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {t ? (
          <View style={s.cards}>
            <Card label="ยอดขาย (รวม VAT)" value={money(t.total)} sub={`${n0(t.bills - t.voids)} บิล${t.edited ? ` · แก้ไข ${n0(t.edited)}` : ''}`} />
            <Card label="ฐานภาษี" value={money(t.vatBase)} sub="มูลค่าก่อน VAT ของสินค้าที่เสีย VAT" />
            <Card label="ภาษีขาย (VAT)" value={money(t.vat)} tone={colors.primary} sub={data.byRate.filter((x) => x.rate > 0).map((x) => `${x.rate}%: ${money(x.vat)}`).join(' · ') || '-'} />
            <Card label="ยอดยกเว้น VAT" value={money(t.exempt)} sub="สินค้าที่ตั้งเป็นยกเว้น VAT" />
            <Card label="บิลยกเลิก" value={`${n0(t.voids)} ใบ`} tone={t.voids ? colors.danger : undefined} sub={t.voids ? `ยอด ${money(t.voidTotal)} · ไม่นับในยอดขาย` : 'ไม่มี'} />
            {ct && ct.count > 0 && data.net ? (
              <Card label="ภาษีขายสุทธิ (หักใบลดหนี้)" value={money(data.net.vat)} tone={colors.primary} sub={`ใบลดหนี้ ${n0(ct.count)} ใบ · VAT ${money(ct.vat)} · ฐานภาษีสุทธิ ${money(data.net.vatBase)}`} />
            ) : null}
          </View>
        ) : null}
        {t && t.noTerminal > 0 ? (
          <View style={s.warn}>
            <Icon name="information-circle-outline" size={16} color="#B26A00" />
            <Text style={s.warnText}>มี {n0(t.noTerminal)} บิลที่ไม่ระบุเครื่อง POS (ขายก่อนตั้งเครื่อง หรือสาขายังไม่ได้ตั้ง) — ตั้งที่ ตั้งค่า → ภาษี (VAT) → เครื่อง POS</Text>
          </View>
        ) : null}

        <View style={[k.seg, { alignSelf: 'flex-start' }]}>
          {TABS.map((x) => (
            <Pressable key={x.id} style={[k.segBtn, tab === x.id && k.segOn]} onPress={() => setTab(x.id)} accessibilityRole="tab">
              <Text style={[k.segText, tab === x.id && { color: '#fff', fontWeight: '600' }]}>
                {x.label}{x.id === 'voids' && t?.voids ? ` (${n0(t.voids)})` : ''}{x.id === 'credits' && ct?.count ? ` (${n0(ct.count)})` : ''}
                {x.id === 'invoices' && data?.taxInvoices?.length ? ` (${n0(data.taxInvoices.length)})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ opacity: loading ? 0.55 : 1 }}>
          {tab === 'days' ? (
            <DataTable cols={dayCols} rows={data?.days ?? []} keyOf={(r) => `${r.day}-${r.branchId}-${r.terminalId}`} empty={loading ? 'กำลังโหลด…' : 'ไม่มีบิลในช่วงนี้'} />
          ) : null}
          {tab === 'bills' ? (
            <>
              <Pager page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} info={t ? `ทั้งหมด ${n0(t.bills)} บิล (รวมบิลยกเลิก)` : ''} />
              <DataTable
                cols={billCols}
                rows={data?.bills ?? []}
                keyOf={(r) => String(r.id)}
                empty={loading ? 'กำลังโหลด…' : 'ไม่มีบิลในช่วงนี้'}
                rowStyle={(r) => (r.status === 'void' ? { backgroundColor: '#FFF7F7' } : undefined)}
              />
            </>
          ) : null}
          {tab === 'voids' ? (
            <DataTable cols={voidCols} rows={data?.voids ?? []} keyOf={(r) => String(r.id)} empty={loading ? 'กำลังโหลด…' : 'ไม่มีบิลยกเลิกในช่วงนี้'} />
          ) : null}
          {tab === 'credits' ? (
            <DataTable cols={creditCols} rows={data?.creditNotes ?? []} keyOf={(r) => String(r.id)} empty={loading ? 'กำลังโหลด…' : 'ไม่มีใบลดหนี้ในช่วงนี้'} />
          ) : null}
          {tab === 'invoices' ? (
            <DataTable cols={invoiceCols} rows={data?.taxInvoices ?? []} keyOf={(r) => String(r.id)} empty={loading ? 'กำลังโหลด…' : 'ไม่มีใบกำกับภาษีเต็มรูปในช่วงนี้'} />
          ) : null}
        </View>

        {data && data.byRate.length > 1 ? (
          <View style={s.rateBox}>
            <Text style={s.cardLabel}>สรุปตามอัตรา VAT (ช่วงวันที่คร่อมการเปลี่ยนอัตรา)</Text>
            {data.byRate.map((x) => (
              <Text key={x.rate} style={s.headText}>
                {x.rate}% · {n0(x.bills)} บิล · ฐานภาษี {money(x.vatBase)} · VAT {money(x.vat)} · ยกเว้น {money(x.exempt)}
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={k.note}>
          ยอดขาย / ฐานภาษี / VAT / ยกเว้น ไม่รวมบิลยกเลิก (บิลยกเลิกเก็บไว้ทุกใบ ไม่ถูกลบ) · ฐานภาษี + VAT + ยกเว้น = ยอดขาย · Grand Total = ยอดขายสะสมของเครื่องตั้งแต่เริ่มใช้ระบบ (ไม่รีเซ็ต) ·
          VAT ใช้อัตราที่บันทึกไว้ในแต่ละบิล · ใบลดหนี้หักภาษีขายในเดือนที่ออกใบลดหนี้ (บิลเดิมไม่เปลี่ยน) · ใบกำกับเต็มรูปออกแทนบิลเดิม ยอดไม่นับซ้ำ ·
          กดเลขที่บิลเพื่อดูรายละเอียด · ส่งออก Excel ได้ทั้ง 6 แผ่น (สรุปรายวันต่อเครื่อง / รายบิล / ตามอัตรา VAT / บิลยกเลิก / ใบลดหนี้ / ใบกำกับเต็มรูป)
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
      {sub ? <Text style={s.cardSub} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

/** 2026-10-23 → 23/10/2569 */
function dateText(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return `${day}/${m}/${y + 543}`;
}
/** 2026-10-23 11:56:31 → 23/10/2569 11:56 */
function dateTime(v: string) {
  const [d, t] = v.split(' ');
  return `${dateText(d)} ${t?.slice(0, 5) ?? ''}`;
}

const s = StyleSheet.create({
  mono: { fontVariant: ['tabular-nums'] },
  mini: { fontFamily: font, fontSize: 10.5, color: colors.sub },
  strike: { textDecorationLine: 'line-through' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, flexWrap: 'wrap' },
  headText: { fontFamily: font, fontSize: 12.5, color: colors.sub, flexShrink: 1 },
  link: { fontFamily: font, fontSize: 12.5, color: colors.primary, textDecorationLine: 'underline' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { flexGrow: 1, flexBasis: 160, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 4 },
  cardLabel: { fontFamily: font, fontSize: 12, color: colors.sub },
  cardValue: { fontFamily: font, fontSize: 21, fontWeight: '700', color: colors.text },
  cardSub: { fontFamily: font, fontSize: 11, color: colors.sub },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: '#FFF4E0' },
  warnText: { fontFamily: font, fontSize: 12, color: '#8A5300', flex: 1 },
  rateBox: { gap: 4, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
});
