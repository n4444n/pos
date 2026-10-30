// ส่งของจากโรงงาน → รายงานการส่ง: ใบส่งของ (DO) ทุกใบที่ส่งออกแล้วในช่วงวันที่ แสดงเป็นรายการเอกสาร
// กรองสาขาปลายทาง · ค้นหาเลขที่ / หมายเหตุ / ผู้ส่ง · กดใบส่งของเพื่อดูสินค้าทุกรายการที่ส่งในใบนั้น (พิมพ์ / Excel ได้)
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type ShipBranch, type ShipmentDetail, type ShipReport, type ShipReportFilter, type ShipReportRow } from '../api';
import { ToastView } from '../components/ToastView';
import { can, useSession } from '../session';
import type { Toast } from '../store/usePos';
import { Icon } from '../components/Icon';
import type { Route } from '../components/NavMenu';
import { DataTable, ExcelButton, k, Pager, PeriodControl, ReportPage, usePeriod, type Column } from '../components/report/ReportKit';
import { Sheet } from '../components/Sheet';
import { n0 } from '../format';
import { printShipment } from '../print';
import { colors, font, radius } from '../theme';

export function ShipmentReportScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const p = usePeriod('month');
  const [branches, setBranches] = useState<ShipBranch[]>([]);
  const [dest, setDest] = useState('');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' }>({ id: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ShipReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [delRow, setDelRow] = useState<ShipReportRow | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const { me } = useSession();
  const canEdit = can(me, 'shipments', 'edit');
  const notify = (kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text });

  useEffect(() => {
    api.shipments().then((r) => setBranches(r.branches), () => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    setPage(1);
  }, [p.range.from, p.range.to, dest, q, sort.id, sort.dir]);

  const filter: ShipReportFilter = { ...p.range, dest: dest || undefined, q: q || undefined, sort: sort.id, dir: sort.dir };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.shipmentReport({ ...filter, page, limit: 50 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [p.range.from, p.range.to, dest, q, sort.id, sort.dir, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const t = data?.total;
  const text = (v: string | null | undefined) => <Text style={[k.tdText, !v && { color: colors.faint }]} numberOfLines={1}>{v || '-'}</Text>;
  const num = (v: number) => <Text style={[k.tdText, { textAlign: 'center' }]}>{n0(v)}</Text>;
  const cols: Column<ShipReportRow>[] = [
    {
      id: 'no', label: 'เลขที่ใบส่งของ', width: 150, sortable: true,
      render: (r) => (
        <View style={s.docCell}>
          <Icon name="document-text-outline" size={16} color={colors.primary} />
          <Text style={[k.tdText, { color: colors.primary, fontWeight: '600' }]} numberOfLines={1}>{r.docNo}</Text>
        </View>
      ),
      total: t ? `รวม ${n0(t.docs)} ใบ` : undefined,
    },
    { id: 'date', label: 'วันที่ส่ง', width: 140, sortable: true, render: (r) => <Text style={k.tdText} numberOfLines={1}>{dateTime(r.shippedAt)}</Text> },
    { id: 'source', label: 'ต้นทาง', width: 150, sortable: true, render: (r) => text(r.sourceBranchName ?? 'โรงงาน (ไม่ตัดสต็อก)') },
    { id: 'dest', label: 'ปลายทาง', width: 150, sortable: true, render: (r) => <Text style={[k.tdText, { fontWeight: '600' }]} numberOfLines={1}>{r.destBranchName ?? '-'}</Text> },
    { id: 'bags', label: 'ถุง/กล่อง', width: 112, align: 'center', sortable: true, render: (r) => num(r.bags), total: t && n0(t.bags) },
    { id: 'lines', label: 'รายการ', width: 100, align: 'center', sortable: true, render: (r) => num(r.lines), total: t && n0(t.lines) },
    {
      id: 'units', label: 'จำนวนชิ้น', width: 116, align: 'center', sortable: true,
      render: (r) => <Text style={[k.tdText, { textAlign: 'center', fontWeight: '700' }]}>{n0(r.units)}</Text>, total: t && n0(t.units),
    },
    { id: 'by', label: 'ผู้ส่ง', width: 120, sortable: true, render: (r) => text(r.shippedBy ?? r.createdBy) },
    {
      id: 'act', label: 'จัดการ', width: canEdit ? 132 : 96, align: 'center',
      render: (r) => (
        <View style={s.acts}>
          <ActBtn icon="eye-outline" label={`ดูใบส่งของ ${r.docNo}`} onPress={() => setOpenId(r.id)} />
          <ActBtn icon="grid-outline" label={`ส่งออก Excel ${r.docNo}`} tone={colors.success} onPress={() => openXlsx(r.id)} />
          {canEdit ? <ActBtn icon="trash-outline" label={`ลบใบส่งของ ${r.docNo}`} tone={colors.danger} onPress={() => setDelRow(r)} /> : null}
        </View>
      ),
    },
  ];

  return (
    <ReportPage
      route="shipmentReport"
      title="รายงานการส่ง"
      sub="ใบส่งของจากโรงงานที่ส่งออกแล้ว — กดใบส่งของเพื่อดูสินค้าทุกรายการที่ส่ง"
      onNavigate={onNavigate}
      right={<ExcelButton url={() => api.shipmentReportXlsxUrl(filter)} disabled={!data} />}
    >
      <View style={k.toolbar}>
        <PeriodControl p={p} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="ค้นหา เลขที่ใบส่งของ / หมายเหตุ / ผู้ส่ง"
          placeholderTextColor={colors.faint}
          style={k.search}
          accessibilityLabel="ค้นหาใบส่งของ"
        />
        <Pressable style={k.pill} onPress={load} accessibilityLabel="โหลดใหม่">
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="refresh" size={16} color={colors.primary} />}
        </Pressable>
      </View>
      {branches.length > 1 ? (
        <View style={k.toolbar}>
          <View style={[k.seg, { flexWrap: 'wrap' }]}>
            {[{ id: '', label: 'ทุกสาขาปลายทาง' }, ...branches.map((x) => ({ id: String(x.id), label: x.name }))].map((x) => (
              <Pressable key={x.id || 'all'} style={[k.segBtn, dest === x.id && k.segOn]} onPress={() => setDest(x.id)} accessibilityRole="button">
                <Text style={[k.segText, dest === x.id && { color: '#fff', fontWeight: '600' }]}>{x.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {error ? <Text style={k.error}>{error}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        {t ? (
          <View style={s.cards}>
            <Card label="ใบส่งของ" value={`${n0(t.docs)} ใบ`} sub={`${n0(t.bags)} ถุง/กล่อง`} />
            <Card label="จำนวนที่ส่ง" value={`${n0(t.units)} ชิ้น`} sub={`${n0(t.lines)} รายการ`} tone={colors.primary} />
            <View style={[s.card, { flexGrow: 2 }]}>
              <Text style={s.cardLabel}>แยกตามสาขาปลายทาง</Text>
              {data.byDest.length === 0 ? <Text style={s.cardSub}>-</Text> : null}
              {data.byDest.map((x) => (
                <View key={x.destBranchId} style={s.payRow}>
                  <Text style={s.payText} numberOfLines={1}>{x.destBranchName ?? '-'} <Text style={s.cardSub}>({n0(x.docs)} ใบ)</Text></Text>
                  <Text style={[s.payText, { fontWeight: '700' }]}>{n0(x.units)} ชิ้น</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <Pager page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} info={data ? `ทั้งหมด ${n0(data.total.docs)} ใบ` : ''} />
        <View style={{ opacity: loading ? 0.55 : 1 }}>
          <DataTable
            cols={cols}
            rows={data?.rows ?? []}
            keyOf={(r) => String(r.id)}
            sort={sort}
            onSort={(id) => setSort((x) => ({ id, dir: x.id === id ? (x.dir === 'desc' ? 'asc' : 'desc') : ['no', 'source', 'dest', 'by'].includes(id) ? 'asc' : 'desc' }))}
            empty={loading ? 'กำลังโหลด…' : 'ไม่มีใบส่งของที่ส่งออกในช่วงนี้'}
            onRowPress={(r) => setOpenId(r.id)}
            rowHint={(r) => `ดูรายการสินค้าใน ${r.docNo}`}
          />
        </View>
        <Text style={k.note}>
          แสดงเฉพาะใบที่ส่งออกแล้ว (ไม่รวมฉบับร่างและใบที่ยกเลิก) ตามวันที่ส่ง · กดแถวหรือปุ่ม ดู เพื่อเปิดใบส่งของ · ปุ่มลบจะคืนสต็อกกลับให้อัตโนมัติ
        </Text>
      </ScrollView>

      <DocSheet id={openId} onClose={() => setOpenId(null)} />
      <DeleteSheet
        row={delRow}
        onClose={() => setDelRow(null)}
        onDone={(msg) => {
          setDelRow(null);
          notify('success', msg);
          load();
        }}
      />
      <ToastView toast={toast} onDone={() => setToast(null)} />
    </ReportPage>
  );
}

/** เปิดไฟล์ Excel ของใบส่งของใบเดียว */
function openXlsx(id: number) {
  if (Platform.OS === 'web') window.open(api.shipmentXlsxUrl(id), '_blank');
}

/** ปุ่มเล็กในคอลัมน์ "จัดการ" */
function ActBtn({ icon, label, onPress, tone = colors.primary }: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onPress: () => void;
  tone?: string;
}) {
  return (
    <Pressable
      style={({ hovered }: { hovered?: boolean }) => [s.actBtn, hovered && { backgroundColor: colors.surface, borderColor: tone }]}
      onPress={(e) => {
        // กันไม่ให้ไปโดนการกดทั้งแถว (ซึ่งเปิดใบส่งของ)
        (e as unknown as { stopPropagation?: () => void }).stopPropagation?.();
        onPress();
      }}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Icon name={icon} size={16} color={tone} />
    </Pressable>
  );
}

/**
 * ยืนยันลบใบส่งของที่ส่งออกแล้ว
 * ลบถาวร + คืนสต็อก: ดึงของออกจากปลายทาง คืนเข้าต้นทาง — ต้องพิมพ์เลขที่ใบยืนยันก่อน
 */
function DeleteSheet({ row, onClose, onDone }: { row: ShipReportRow | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    setConfirm('');
    setErr('');
    setBusy(false);
  }, [row]);
  const ok = !!row && confirm.trim().toUpperCase() === row.docNo.toUpperCase();
  const go = async () => {
    if (!row || !ok) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.deleteShipment(row.id);
      onDone(`ลบใบส่งของ ${r.docNo} และคืนสต็อกแล้ว (${r.items} รายการ)`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet visible={!!row} onClose={onClose} title="ลบใบส่งของถาวร" width={520}>
      {row ? (
        <View style={{ gap: 12 }}>
          <View style={s.warnBox}>
            <Icon name="warning-outline" size={20} color={colors.danger} />
            <Text style={s.warnText}>
              ลบแล้วเอาคืนไม่ได้ · ระบบจะ<Text style={{ fontWeight: '700' }}>ดึงของ {n0(row.units)} ชิ้นออกจาก{row.destBranchName ?? 'สาขาปลายทาง'}</Text>
              {row.sourceBranchName ? ` และคืนเข้า${row.sourceBranchName}` : ' (ตอนส่งไม่ได้ตัดสต็อกต้นทาง จึงไม่มีของคืนกลับ)'}
            </Text>
          </View>
          <View style={s.info}>
            <Info icon="document-text-outline" label="เลขที่" value={row.docNo} strong />
            <Info icon="calendar-outline" label="วันที่ส่ง" value={dateTime(row.shippedAt)} />
            <Info icon="cube-outline" label="จำนวน" value={`${n0(row.units)} ชิ้น · ${n0(row.lines)} รายการ`} />
            <Info icon="person-outline" label="ผู้ส่ง" value={row.shippedBy ?? row.createdBy ?? '-'} />
          </View>
          <Text style={k.note}>ถ้าของถูกขายหรือย้ายออกจากปลายทางไปแล้วจนคืนไม่ครบ ระบบจะไม่ยอมลบ</Text>
          <Text style={s.confirmLabel}>พิมพ์ <Text style={{ fontWeight: '700' }}>{row.docNo}</Text> เพื่อยืนยัน</Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            placeholder={row.docNo}
            placeholderTextColor={colors.faint}
            autoCapitalize="characters"
            style={s.confirmInput}
            accessibilityLabel="พิมพ์เลขที่ใบส่งของเพื่อยืนยันการลบ"
          />
          {err ? <Text style={k.error}>{err}</Text> : null}
          <View style={[k.row, { gap: 8, justifyContent: 'flex-end' }]}>
            <Pressable style={k.pill} onPress={onClose} accessibilityLabel="ยกเลิก">
              <Text style={k.pillText}>ยกเลิก</Text>
            </Pressable>
            <Pressable style={[s.delBtn, (!ok || busy) && { opacity: 0.45 }]} disabled={!ok || busy} onPress={go} accessibilityLabel="ยืนยันลบใบส่งของ">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.delText}>ลบถาวร และคืนสต็อก</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

/** รายละเอียดใบส่งของ: สินค้าทุกรายการที่ส่ง */
function DocSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [d, setD] = useState<ShipmentDetail | null>(null);
  const [err, setErr] = useState('');
  const [find, setFind] = useState('');
  useEffect(() => {
    setD(null);
    setErr('');
    setFind('');
    if (id) api.shipment(id).then(setD, (e: Error) => setErr(e.message));
  }, [id]);
  const sh = d?.shipment;
  const f = find.trim().toLowerCase();
  const items = (d?.items ?? []).filter((i) => !f || `${i.name} ${i.label} ${i.sku} ${i.barcode ?? ''}`.toLowerCase().includes(f));
  const units = (d?.items ?? []).reduce((a, i) => a + i.qty, 0);
  return (
    <Sheet visible={id !== null} onClose={onClose} title={sh ? `ใบส่งของ ${sh.docNo}` : 'ใบส่งของ'} width={720}>
      {err ? <Text style={k.error}>{err}</Text> : null}
      {!d && !err ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} /> : null}
      {sh ? (
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <View style={s.info}>
            <Info icon="calendar-outline" label="วันที่ส่ง" value={dateTime(sh.shippedAt ?? sh.createdAt)} />
            <Info icon="business-outline" label="ต้นทาง" value={sh.sourceBranchName ? `${sh.sourceBranchName} (ตัดสต็อก)` : 'โรงงาน (ไม่ตัดสต็อก)'} />
            <Info icon="storefront-outline" label="ปลายทาง" value={sh.destBranchName ?? '-'} strong />
            <Info icon="cube-outline" label="จำนวน" value={`${n0(units)} ชิ้น · ${n0(d.items.length)} รายการ · ${n0(sh.bags)} ถุง/กล่อง`} strong />
            <Info icon="person-outline" label="ผู้ส่ง" value={sh.shippedBy ?? sh.createdBy ?? '-'} />
            {sh.note ? <Info icon="chatbox-ellipses-outline" label="หมายเหตุ" value={sh.note} /> : null}
          </View>
          <View style={[k.row, { flexWrap: 'wrap', gap: 8 }]}>
            <TextInput value={find} onChangeText={setFind} placeholder="ค้นหาสินค้า / สี / ไซส์ / รหัส" placeholderTextColor={colors.faint} style={[k.search, { flex: 1, minWidth: 200 }]} />
            <Pressable style={k.pill} onPress={() => printShipment(d)} accessibilityLabel="พิมพ์ใบส่งของ A4">
              <Icon name="print-outline" size={16} color={colors.primary} />
              <Text style={k.pillText}>พิมพ์</Text>
            </Pressable>
            <ExcelButton url={() => api.shipmentXlsxUrl(sh.id)} />
          </View>
          <View style={s.table}>
            <View style={[s.tr, s.th]}>
              <Text style={[s.thText, { width: 36, textAlign: 'center' }]}>#</Text>
              <Text style={[s.thText, { flex: 1 }]}>สินค้า</Text>
              <Text style={[s.thText, { width: 150 }]}>สี / ไซส์</Text>
              <Text style={[s.thText, { width: 70, textAlign: 'center' }]}>จำนวน</Text>
            </View>
            <ScrollView style={{ maxHeight: Platform.OS === 'web' ? ('46vh' as unknown as number) : 360 }}>
              {items.map((i, n) => (
                <View key={i.variantId} style={[s.tr, n % 2 === 1 && { backgroundColor: colors.surface }]}>
                  <Text style={[s.td, { width: 36, textAlign: 'center', color: colors.sub }]}>{n + 1}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.td, { fontWeight: '600' }]} numberOfLines={1}>{i.name}</Text>
                    <Text style={s.sku} numberOfLines={1}>{i.sku}{i.barcode && i.barcode !== i.sku ? ` · ${i.barcode}` : ''}</Text>
                  </View>
                  <Text style={[s.td, { width: 150 }]} numberOfLines={1}>{i.label}</Text>
                  <Text style={[s.td, { width: 70, textAlign: 'center', fontWeight: '700' }]}>{n0(i.qty)}</Text>
                </View>
              ))}
              {items.length === 0 ? <Text style={[k.note, { padding: 14, textAlign: 'center' }]}>{f ? 'ไม่พบสินค้าที่ค้นหา' : 'ไม่มีรายการ'}</Text> : null}
            </ScrollView>
            <View style={[s.tr, s.tf]}>
              <Text style={[s.td, { flex: 1, fontWeight: '700' }]}>รวม {n0(d.items.length)} รายการ</Text>
              <Text style={[s.td, { width: 70, textAlign: 'center', fontWeight: '700', color: colors.primary }]}>{n0(units)}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

function Info({ icon, label, value, strong }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.infoItem}>
      <Icon name={icon} size={16} color={colors.sub} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, strong && { fontWeight: '700' }]} numberOfLines={2}>{value}</Text>
    </View>
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
function dateTime(v: string) {
  const [d, t] = v.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  return `${day}/${m}/${y + 543} ${t?.slice(0, 5) ?? ''}`;
}

const s = StyleSheet.create({
  acts: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  actBtn: { width: 32, height: 32, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  warnBox: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: '#F3C4C6' },
  warnText: { fontFamily: font, fontSize: 13, color: colors.danger, flex: 1, lineHeight: 19 },
  confirmLabel: { fontFamily: font, fontSize: 13, color: colors.text },
  confirmInput: { fontFamily: font, fontSize: 15, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, color: colors.text, backgroundColor: '#fff', letterSpacing: 1 },
  delBtn: { height: 42, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  delText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '700' },
  docCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { flexGrow: 1, flexBasis: 180, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 4 },
  cardLabel: { fontFamily: font, fontSize: 12, color: colors.sub },
  cardValue: { fontFamily: font, fontSize: 22, fontWeight: '700', color: colors.text },
  cardSub: { fontFamily: font, fontSize: 11, color: colors.sub },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  payText: { fontFamily: font, fontSize: 13, color: colors.text, flexShrink: 1 },
  info: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexBasis: '48%', flexGrow: 1, minWidth: 220 },
  infoLabel: { fontFamily: font, fontSize: 12, color: colors.sub, width: 62 },
  infoValue: { fontFamily: font, fontSize: 13, color: colors.text, flex: 1 },
  table: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  th: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line },
  tf: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.primarySoft },
  thText: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub },
  td: { fontFamily: font, fontSize: 13, color: colors.text },
  sku: { fontFamily: font, fontSize: 11, color: colors.faint },
});
