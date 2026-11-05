// ส่งของจากโรงงาน → รายงานการส่ง: ใบส่งของ (DO) ทุกใบที่ส่งออกแล้วในช่วงวันที่ แสดงเป็นรายการเอกสาร
// กรองสาขาปลายทาง · ค้นหาเลขที่ / หมายเหตุ / ผู้ส่ง · กดใบส่งของเพื่อดูสินค้าทุกรายการที่ส่งในใบนั้น (พิมพ์ / Excel ได้)
// คอลัมน์ "ปรับสต็อก": ส่งออกแล้วสต็อกยังไม่เปลี่ยน — รอปลายทางรับของ/ตรวจจำนวน → แก้ไข (ถ้าไม่ตรง) → ปรับสต็อก (โอนเข้าสต็อกจริง)
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
import { downloadFile } from '../download';

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
  const [editRow, setEditRow] = useState<ShipReportRow | null>(null);
  const [adjRow, setAdjRow] = useState<ShipReportRow | null>(null);
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
    {
      id: 'adj', label: 'ปรับสต็อก', width: 214, align: 'center',
      render: (r) =>
        r.adjustedAt ? (
          <View style={s.doneBox}>
            <View style={s.doneChip}>
              <Icon name="checkmark-circle" size={14} color={colors.success} />
              <Text style={s.doneText}>ปรับสต็อกแล้ว</Text>
            </View>
            <Text style={s.doneSub} numberOfLines={1}>{dateTime(r.adjustedAt)}{r.adjustedBy ? ` · ${r.adjustedBy}` : ''}</Text>
          </View>
        ) : canEdit ? (
          <View style={s.acts}>
            <TextBtn icon="create-outline" label="แก้ไข" hint={`แก้ไขจำนวนที่รับจริง ${r.docNo}`} onPress={() => setEditRow(r)} />
            <TextBtn icon="swap-vertical-outline" label="ปรับสต็อก" hint={`ปรับสต็อก ${r.docNo}`} primary onPress={() => setAdjRow(r)} />
          </View>
        ) : (
          <Text style={[k.tdText, { color: '#B26A00', textAlign: 'center' }]}>รอปรับสต็อก</Text>
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
            <Card label="รอปรับสต็อก" value={`${n0(t.pending ?? 0)} ใบ`} sub={t.pending ? 'ปลายทางตรวจรับแล้วกด ปรับสต็อก' : 'ปรับสต็อกครบทุกใบแล้ว'} tone={t.pending ? '#B26A00' : colors.success} />
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
          แสดงเฉพาะใบที่ส่งออกแล้ว (ไม่รวมฉบับร่างและใบที่ยกเลิก) ตามวันที่ส่ง · กดแถวหรือปุ่ม ดู เพื่อเปิดใบส่งของ · ส่งออกแล้วสต็อกยังไม่เปลี่ยน จนกว่าจะกด ปรับสต็อก (ถ้าปลายทางนับได้ไม่ตรงกับกระดาษ กด แก้ไข ก่อน) · ปุ่มลบ = ลบเอกสารอย่างเดียว สต็อกไม่เปลี่ยน
        </Text>
      </ScrollView>

      <DocSheet id={openId} onClose={() => setOpenId(null)} />
      <EditSheet
        row={editRow}
        onClose={() => setEditRow(null)}
        onDone={(msg) => {
          setEditRow(null);
          notify('success', msg);
          load();
        }}
      />
      <AdjustSheet
        row={adjRow}
        onClose={() => setAdjRow(null)}
        onEdit={(r) => {
          setAdjRow(null);
          setEditRow(r);
        }}
        onDone={(msg) => {
          setAdjRow(null);
          notify('success', msg);
          load();
        }}
      />
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
  downloadFile(api.shipmentXlsxUrl(id));
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
      style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [s.actBtn, hovered && { backgroundColor: colors.surface, borderColor: tone }]}
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
 * ยืนยันลบใบส่งของที่ส่งออกแล้ว — ลบเอกสารอย่างเดียว ไม่แตะสต็อก · ต้องพิมพ์เลขที่ใบยืนยันก่อน
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
      onDone(`ลบใบส่งของ ${r.docNo} แล้ว · สต็อกไม่เปลี่ยน`);
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
              {row.adjustedAt
                ? 'ลบเอกสารออกจากระบบถาวร เอาคืนไม่ได้ · สต็อกทุกสาขาคงเดิม (ไม่ดึงของกลับตามใบนี้)'
                : 'ลบเอกสารออกจากระบบถาวร เอาคืนไม่ได้ · ใบนี้ยังไม่ได้ปรับสต็อก จึงไม่มีสต็อกสาขาใดเปลี่ยน'}
            </Text>
          </View>
          <View style={s.info}>
            <Info icon="document-text-outline" label="เลขที่" value={row.docNo} strong />
            <Info icon="calendar-outline" label="วันที่ส่ง" value={dateTime(row.shippedAt)} />
            <Info icon="cube-outline" label="จำนวน" value={`${n0(row.units)} ชิ้น · ${n0(row.lines)} รายการ`} />
            <Info icon="person-outline" label="ผู้ส่ง" value={row.shippedBy ?? row.createdBy ?? '-'} />
          </View>
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
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.delText}>ลบถาวร</Text>}
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
            <Info
              icon={sh.adjustedAt ? 'checkmark-circle-outline' : 'time-outline'}
              label="สต็อก"
              value={sh.adjustedAt ? `ปรับสต็อกแล้ว ${dateTime(sh.adjustedAt)}${sh.adjustedBy ? ` · ${sh.adjustedBy}` : ''}` : 'รอปลายทางตรวจรับ — ยังไม่ปรับสต็อก'}
              strong={!sh.adjustedAt}
            />
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

/** ปุ่มมีข้อความในคอลัมน์ "ปรับสต็อก" */
function TextBtn({ icon, label, hint, onPress, primary }: { icon: Parameters<typeof Icon>[0]['name']; label: string; hint: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [s.txtBtn, primary && s.txtBtnPrimary, hovered && (primary ? { opacity: 0.88 } : { borderColor: colors.primary })]}
      onPress={(e) => {
        (e as unknown as { stopPropagation?: () => void }).stopPropagation?.();
        onPress();
      }}
      accessibilityLabel={hint}
      accessibilityRole="button"
    >
      <Icon name={icon} size={15} color={primary ? '#fff' : colors.primary} />
      <Text style={[s.txtBtnText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * แก้ไขจำนวนตามที่สาขาปลายทางรับจริง (ก่อนปรับสต็อก)
 * เพิ่ม / ลดจำนวน · ใส่ 0 หรือกดลบ = เอารายการออก · บันทึกแล้วกลับไปหน้ารายงานการส่ง (ยังไม่แตะสต็อก)
 */
function EditSheet({ row, onClose, onDone }: { row: ShipReportRow | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [d, setD] = useState<ShipmentDetail | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState('');
  useEffect(() => {
    setD(null);
    setErr('');
    setBusy(false);
    setFind('');
    setQty({});
    if (row)
      api.shipment(row.id).then(
        (x) => {
          setD(x);
          setQty(Object.fromEntries(x.items.map((i) => [i.variantId, String(i.qty)])));
        },
        (e: Error) => setErr(e.message),
      );
  }, [row]);
  const val = (v: number) => {
    const n = Math.floor(Number(qty[v] ?? 0));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const setN = (v: number, n: number) => setQty((x) => ({ ...x, [v]: String(Math.max(0, Math.min(99999, n))) }));
  const items = d?.items ?? [];
  const f = find.trim().toLowerCase();
  const shown = items.filter((i) => !f || `${i.name} ${i.label} ${i.sku} ${i.barcode ?? ''}`.toLowerCase().includes(f));
  const before = items.reduce((a, i) => a + i.qty, 0);
  const after = items.reduce((a, i) => a + val(i.variantId), 0);
  const changed = items.filter((i) => val(i.variantId) !== i.qty).length;
  const bad = items.some((i) => qty[i.variantId] !== undefined && qty[i.variantId] !== '' && !/^\d+$/.test(qty[i.variantId]));
  const save = async () => {
    if (!row || !d) return;
    setBusy(true);
    setErr('');
    try {
      await api.editShippedItems(row.id, items.map((i) => ({ variantId: i.variantId, qty: val(i.variantId) })));
      onDone(changed ? `บันทึกการแก้ไข ${row.docNo} แล้ว (${n0(changed)} รายการ) · ยังไม่ปรับสต็อก` : `ไม่มีการเปลี่ยนแปลงใน ${row.docNo}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={!!row}
      onClose={() => !busy && onClose()}
      title={row ? `แก้ไขจำนวน ${row.docNo}` : 'แก้ไขจำนวน'}
      width={760}
      footer={
        <View style={[k.row, { gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }]}>
          <Text style={[k.note, { flex: 1, minWidth: 180 }]}>
            {changed ? `รวม ${n0(before)} → ${n0(after)} ชิ้น · แก้ ${n0(changed)} รายการ` : `รวม ${n0(after)} ชิ้น`}
          </Text>
          <Pressable style={k.pill} onPress={onClose} disabled={busy} accessibilityLabel="ยกเลิก">
            <Text style={k.pillText}>ยกเลิก</Text>
          </Pressable>
          <Pressable style={[s.saveBtn, (busy || !d || bad) && { opacity: 0.45 }]} disabled={busy || !d || bad} onPress={save} accessibilityLabel="บันทึกการแก้ไข">
            {busy ? <ActivityIndicator color="#fff" /> : <Icon name="save-outline" size={16} color="#fff" />}
            <Text style={s.delText}>บันทึก</Text>
          </Pressable>
        </View>
      }
    >
      {err ? <Text style={k.error}>{err}</Text> : null}
      {!d && !err ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} /> : null}
      {d ? (
        <View style={{ gap: 10, paddingBottom: 8 }}>
          <View style={s.hintBox}>
            <Icon name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={s.hintText}>
              {`ใส่จำนวนที่ ${d.shipment.destBranchName ?? 'สาขาปลายทาง'} รับจริง · ใส่ 0 หรือกดลบ = เอารายการออก · บันทึกแล้วสต็อกยังไม่เปลี่ยน จนกว่าจะกด ปรับสต็อก`}
            </Text>
          </View>
          {/* ช่องค้นหาอยู่ในแถว (flexBasis ของ k.search เป็นความกว้าง ไม่ใช่ความสูง) */}
          <View style={k.row}>
            <TextInput value={find} onChangeText={setFind} placeholder="ค้นหาสินค้า / สี / ไซส์ / รหัส" placeholderTextColor={colors.faint} style={[k.search, { flex: 1, minWidth: 200 }]} />
          </View>
          <View style={s.table}>
            <View style={[s.tr, s.th]}>
              <Text style={[s.thText, { width: 36, textAlign: 'center' }]}>#</Text>
              <Text style={[s.thText, { flex: 1 }]}>สินค้า</Text>
              <Text style={[s.thText, { width: 130 }]}>สี / ไซส์</Text>
              <Text style={[s.thText, { width: 56, textAlign: 'center' }]}>เดิม</Text>
              <Text style={[s.thText, { width: 150, textAlign: 'center' }]}>รับจริง</Text>
              <Text style={[s.thText, { width: 36 }]} />
            </View>
            <ScrollView style={{ maxHeight: Platform.OS === 'web' ? ('44vh' as unknown as number) : 340 }}>
              {shown.map((i, n) => {
                const v = val(i.variantId);
                const removed = v === 0;
                const diff = v !== i.qty;
                return (
                  <View key={i.variantId} style={[s.tr, n % 2 === 1 && { backgroundColor: colors.surface }, removed && { opacity: 0.55 }]}>
                    <Text style={[s.td, { width: 36, textAlign: 'center', color: colors.sub }]}>{n + 1}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.td, { fontWeight: '600' }, removed && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{i.name}</Text>
                      <Text style={s.sku} numberOfLines={1}>{removed ? 'จะเอาออกจากใบ' : i.sku}</Text>
                    </View>
                    <Text style={[s.td, { width: 130 }]} numberOfLines={1}>{i.label}</Text>
                    <Text style={[s.td, { width: 56, textAlign: 'center', color: colors.sub }]}>{n0(i.qty)}</Text>
                    <View style={[s.stepper, { width: 150 }]}>
                      <Pressable style={s.stepBtn} onPress={() => setN(i.variantId, v - 1)} disabled={v === 0} accessibilityLabel={`ลดจำนวน ${i.name}`}>
                        <Icon name="remove" size={16} color={v === 0 ? colors.faint : colors.text} />
                      </Pressable>
                      <TextInput
                        value={qty[i.variantId] ?? ''}
                        onChangeText={(t) => setQty((x) => ({ ...x, [i.variantId]: t.replace(/[^0-9]/g, '').slice(0, 5) }))}
                        keyboardType="number-pad"
                        selectTextOnFocus
                        style={[s.qtyInput, diff && { borderColor: colors.primary, color: colors.primary }]}
                        accessibilityLabel={`จำนวนที่รับจริง ${i.name} ${i.label}`}
                      />
                      <Pressable style={s.stepBtn} onPress={() => setN(i.variantId, v + 1)} accessibilityLabel={`เพิ่มจำนวน ${i.name}`}>
                        <Icon name="add" size={16} color={colors.text} />
                      </Pressable>
                    </View>
                    <Pressable
                      style={s.rmBtn}
                      onPress={() => setN(i.variantId, removed ? i.qty : 0)}
                      accessibilityLabel={removed ? `เอา ${i.name} กลับมา` : `ลบรายการ ${i.name}`}
                    >
                      <Icon name={removed ? 'arrow-undo-outline' : 'trash-outline'} size={16} color={removed ? colors.primary : colors.danger} />
                    </Pressable>
                  </View>
                );
              })}
              {shown.length === 0 ? <Text style={[k.note, { padding: 14, textAlign: 'center' }]}>{f ? 'ไม่พบสินค้าที่ค้นหา' : 'ไม่มีรายการ'}</Text> : null}
            </ScrollView>
          </View>
          {after === 0 && items.length ? (
            <Text style={[k.note, { color: colors.danger }]}>เอาออกทุกรายการแล้ว — ใบนี้จะปรับสต็อกไม่ได้ ถ้าไม่ได้ส่งของจริงให้ลบใบนี้แทน</Text>
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}

/** ยืนยันปรับสต็อก: โอนจำนวนในใบเข้าสต็อกจริง (ตัดต้นทางถ้าเลือก + เพิ่มปลายทาง) แล้วล็อกใบ */
function AdjustSheet({ row, onClose, onEdit, onDone }: { row: ShipReportRow | null; onClose: () => void; onEdit: (r: ShipReportRow) => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    setBusy(false);
    setErr('');
  }, [row]);
  const go = async () => {
    if (!row) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.adjustShipment(row.id);
      onDone(
        row.sourceBranchName
          ? `ปรับสต็อก ${row.docNo} แล้ว · เพิ่มสต็อก ${row.destBranchName ?? 'ปลายทาง'} ${n0(r.units)} ชิ้น · ตัดสต็อก ${row.sourceBranchName}`
          : `ปรับสต็อก ${row.docNo} แล้ว · เพิ่มสต็อก ${row.destBranchName ?? 'ปลายทาง'} ${n0(r.units)} ชิ้น`,
      );
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={!!row}
      onClose={() => !busy && onClose()}
      title={row ? `ปรับสต็อก ${row.docNo}` : 'ปรับสต็อก'}
      width={500}
      footer={
        row ? (
          <View style={[k.row, { gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }]}>
            <Pressable style={k.pill} onPress={() => onEdit(row)} disabled={busy} accessibilityLabel="แก้ไขจำนวนก่อน">
              <Icon name="create-outline" size={16} color={colors.primary} />
              <Text style={k.pillText}>แก้ไขจำนวนก่อน</Text>
            </Pressable>
            <Pressable style={[s.saveBtn, busy && { opacity: 0.45 }]} disabled={busy} onPress={go} accessibilityLabel="ยืนยันปรับสต็อก">
              {busy ? <ActivityIndicator color="#fff" /> : <Icon name="swap-vertical-outline" size={16} color="#fff" />}
              <Text style={s.delText}>ยืนยันปรับสต็อก</Text>
            </Pressable>
          </View>
        ) : null
      }
    >
      {row ? (
        <View style={{ gap: 12, paddingBottom: 4 }}>
          <View style={s.info}>
            <Info icon="document-text-outline" label="เลขที่" value={row.docNo} strong />
            <Info icon="cube-outline" label="จำนวน" value={`${n0(row.units)} ชิ้น · ${n0(row.lines)} รายการ`} strong />
          </View>
          <View style={{ gap: 8 }}>
            <View style={s.lineRow}>
              <Icon name="add-circle-outline" size={18} color={colors.success} />
              <Text style={s.lineText}>{`เพิ่มสต็อก ${row.destBranchName ?? 'สาขาปลายทาง'} ${n0(row.units)} ชิ้น`}</Text>
            </View>
            <View style={s.lineRow}>
              <Icon name={row.sourceBranchName ? 'remove-circle-outline' : 'ban-outline'} size={18} color={row.sourceBranchName ? colors.danger : colors.sub} />
              <Text style={s.lineText}>
                {row.sourceBranchName ? `ตัดสต็อก ${row.sourceBranchName} ${n0(row.units)} ชิ้น` : 'ไม่ตัดสต็อกสาขาใด (ของใหม่จากโรงงาน)'}
              </Text>
            </View>
          </View>
          <Text style={k.note}>ตรวจว่าจำนวนตรงกับที่ปลายทางรับจริงแล้ว · ปรับสต็อกแล้วใบนี้จะถูกล็อก แก้ไขจำนวนไม่ได้อีก</Text>
          {err ? <Text style={k.error}>{err}</Text> : null}
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
  txtBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  txtBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  txtBtnText: { fontFamily: font, fontSize: 12.5, fontWeight: '600', color: colors.primary },
  doneBox: { alignItems: 'center', gap: 2 },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.successSoft },
  doneText: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.success },
  doneSub: { fontFamily: font, fontSize: 10.5, color: colors.faint },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.primary },
  hintBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  hintText: { fontFamily: font, fontSize: 12.5, color: colors.text, flex: 1, lineHeight: 18 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  stepBtn: { width: 30, height: 32, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  qtyInput: { width: 62, height: 32, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, textAlign: 'center', fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text, backgroundColor: '#fff' },
  rmBtn: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineText: { fontFamily: font, fontSize: 14, color: colors.text, flex: 1 },
});
