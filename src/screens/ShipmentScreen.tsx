// ส่งของจากโรงงาน: สร้างใบส่งของ (DO) → สแกนบาร์โค้ด → ส่งออก
// ส่งออกแล้ว: ตัดสต็อกจากสาขาที่เลือก (หรือไม่ตัด) และเพิ่มสต็อกให้สาขาปลายทาง · รายการถูกล็อก
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { api, type ShipBranch, type Shipment, type ShipmentDetail } from '../api';
import { beep } from '../appSettings';
import { Icon } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { Sheet } from '../components/Sheet';
import { ToastView } from '../components/ToastView';
import { thaiDateTime } from '../format';
import { printShipment } from '../print';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';

const STATUS = {
  draft: { label: 'กำลังจัดเตรียม', bg: '#FFF4E0', fg: '#B26A00' },
  shipped: { label: 'ส่งออกแล้ว', bg: colors.successSoft, fg: colors.success },
  cancelled: { label: 'ยกเลิก', bg: colors.dangerSoft, fg: colors.danger },
  held: { label: 'พักไว้ (Hold)', bg: '#EFE9FF', fg: '#6B3FC4' },
} as const;
/** สถานะที่แสดง: draft ที่พักไว้ = held */
const statusOf = (x: Shipment): keyof typeof STATUS => (x.status === 'draft' && x.heldAt ? 'held' : x.status);
const STEPS = [1, 2, 5, 10];

export function ShipmentScreen({ onNavigate, onStockChanged }: { onNavigate: (r: Route) => void; onStockChanged?: () => void }) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const wide = width >= 1180;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [list, setList] = useState<Shipment[] | null>(null);
  const [cancelledList, setCancelledList] = useState<Shipment[]>([]);
  const [keepDays, setKeepDays] = useState(3);
  const [pickTab, setPickTab] = useState<'active' | 'cancelled'>('active');
  const [cancelAsk, setCancelAsk] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [branches, setBranches] = useState<ShipBranch[]>([]);
  const [cur, setCur] = useState<ShipmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  const clearToast = useCallback(() => setToast(null), []);

  const open = useCallback((id: number) => {
    api.shipment(id).then(setCur).catch((e: Error) => notify('error', e.message));
  }, [notify]);

  const load = useCallback((selectId?: number) => {
    setError(null);
    api
      .shipments()
      .then((r) => {
        setList(r.list);
        setCancelledList(r.cancelled ?? []);
        setKeepDays(r.keepDays ?? 3);
        setBranches(r.branches);
        const id = selectId ?? r.list.find((x) => x.status === 'draft' && !x.heldAt)?.id ?? r.list.find((x) => x.status === 'draft')?.id ?? r.list[0]?.id;
        if (id) open(id);
        else setCur(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [open]);
  useEffect(() => load(), [load]);

  /** อัปเดตใบปัจจุบัน + แถวในรายการ */
  const apply = useCallback((d: ShipmentDetail) => {
    setCur(d);
    setList((l) => (l ? l.map((x) => (x.id === d.shipment.id ? d.shipment : x)) : l));
    setCancelledList((l) => l.map((x) => (x.id === d.shipment.id ? d.shipment : x)));
  }, []);

  const sh = cur?.shipment;
  const isOpen = sh?.status === 'draft';
  const held = !!(isOpen && sh?.heldAt);
  /** แก้ไข/สแกนได้ = ยังไม่ส่ง และไม่ได้พักไว้ */
  const isDraft = isOpen && !held;
  const view = sh ? statusOf(sh) : 'draft';
  const units = cur?.items.reduce((a, i) => a + i.qty, 0) ?? 0;
  const short = useMemo(
    () => (cur?.sourceStock ? cur.items.filter((i) => (cur.sourceStock![i.variantId] ?? 0) < i.qty) : []),
    [cur],
  );

  const update = (b: Parameters<typeof api.updateShipment>[1]) => {
    if (!sh) return;
    api.updateShipment(sh.id, b).then(apply).catch((e: Error) => notify('error', e.message));
  };

  const ship = async () => {
    if (!sh) return;
    setBusy(true);
    try {
      const d = await api.shipShipment(sh.id);
      apply(d);
      setConfirm(false);
      onStockChanged?.();
      notify('success', `ส่งออก ${d.shipment.docNo} แล้ว · เพิ่มสต็อก${d.shipment.destBranchName} ${units.toLocaleString()} ตัว`);
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hold = async () => {
    if (!sh) return;
    try {
      const d = await api.holdShipment(sh.id);
      apply(d);
      notify('success', `พัก ${d.shipment.docNo} ไว้แล้ว — รายการ ${units.toLocaleString()} ตัวยังอยู่ครบ`);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };
  const resume = async () => {
    if (!sh) return;
    try {
      const d = await api.resumeShipment(sh.id);
      apply(d);
      notify('success', `ทำต่อ ${d.shipment.docNo} — สแกนต่อได้เลย`);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  /** ยกเลิก (หลังยืนยัน + เหตุผล) — ไม่กระทบสต็อก เก็บไว้ keepDays วันให้กู้คืนได้ */
  const cancel = async () => {
    if (!sh || !cancelReason.trim()) return;
    setBusy(true);
    try {
      await api.cancelShipment(sh.id, cancelReason.trim());
      setCancelAsk(false);
      notify('info', `ยกเลิก ${sh.docNo} แล้ว · สต็อกไม่เปลี่ยน · กู้คืนได้ภายใน ${keepDays} วัน`);
      load();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (id: number) => {
    try {
      const d = await api.restoreShipment(id);
      setPicker(false);
      notify('success', `กู้คืน ${d.shipment.docNo} เป็นฉบับร่างแล้ว — สแกนต่อได้`);
      load(id);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="shipments" onNavigate={onNavigate} /> : null}

      <View style={[s.main, mobile && { padding: 10 }]}>
        <View style={s.header}>
          <View style={s.row}>
            <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <View>
              <Text style={s.title}>ส่งของจากโรงงาน</Text>
              <Text style={s.sub}>สแกนสินค้าใส่ใบส่งของ → ส่งออก → สต็อกสาขาปลายทางเพิ่มอัตโนมัติ</Text>
            </View>
          </View>
          <Pressable style={[s.pillBtn, s.primaryBtn]} onPress={() => setCreating(true)} accessibilityLabel="สร้างใบส่งของใหม่">
            <Icon name="add" size={18} color="#fff" />
            <Text style={[s.pillText, { color: '#fff' }]}>สร้างใบส่งของใหม่</Text>
          </Pressable>
        </View>

        {error ? <Text style={s.err}>{error}</Text> : null}
        {!list ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : !sh ? (
          <View style={s.empty}>
            <Icon name="cube-outline" size={40} color={colors.faint} />
            <Text style={s.emptyText}>ยังไม่มีใบส่งของ</Text>
            <Pressable style={[s.pillBtn, s.primaryBtn]} onPress={() => setCreating(true)}>
              <Icon name="add" size={18} color="#fff" />
              <Text style={[s.pillText, { color: '#fff' }]}>สร้างใบส่งของใบแรก</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: isOpen ? 90 : 24 }}>
            {/* เลือกใบส่งของ */}
            <View style={[s.card, s.row, { flexWrap: 'wrap', gap: 10 }]}>
              <Icon name="cube-outline" size={18} color={colors.primary} />
              <Text style={s.label}>ใบส่งของ:</Text>
              <Pressable style={s.select} onPress={() => setPicker(true)} accessibilityLabel="เลือกใบส่งของ">
                <Text style={s.selectText} numberOfLines={1}>
                  {sh.docNo} ➔ {sh.destBranchName}
                </Text>
                <Icon name="caret-down" size={12} color={colors.text} />
              </Pressable>
              <StatusChip status={view} />
              <View style={{ flex: 1 }} />
              <Pressable style={s.pillBtn} onPress={() => cur && printShipment(cur)} accessibilityLabel="พิมพ์ใบส่งของ A4">
                <Icon name="print-outline" size={16} color={colors.text} />
                <Text style={s.pillText}>พิมพ์ใบส่งของ (A4)</Text>
              </Pressable>
              <Pressable
                style={[s.pillBtn, { backgroundColor: colors.successSoft, borderColor: colors.successSoft }]}
                onPress={() => cur && Platform.OS === 'web' && window.open(api.shipmentXlsxUrl(cur.shipment.id), '_blank')}
                accessibilityLabel="ส่งออกใบส่งของเป็น Excel"
              >
                <Icon name="grid-outline" size={16} color={colors.success} />
                <Text style={[s.pillText, { color: colors.success, fontWeight: '700' }]}>ส่งออก Excel</Text>
              </Pressable>
            </View>

            <View style={[{ gap: 12 }, wide && { flexDirection: 'row', alignItems: 'stretch' }]}>
              {/* ข้อมูลใบส่งของ */}
              <View style={[s.card, { gap: 12 }, wide && { flex: 1 }]}>
                <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }]}>
                  <View>
                    <Text style={s.small}>เลขที่เอกสาร</Text>
                    <Text style={s.docNo}>{sh.docNo}</Text>
                    <Text style={s.small}>{thaiDateTime(sh.shippedAt ?? sh.createdAt)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.small}>จำนวนที่สแกน</Text>
                    <Text style={s.big}>
                      {units.toLocaleString()} <Text style={s.unit}>ตัว ({cur!.items.length} รายการ)</Text>
                    </Text>
                    <Text style={s.small}>ผู้จัด: {sh.shippedBy ?? sh.createdBy ?? '-'}</Text>
                  </View>
                </View>

                <BranchField
                  label="ส่งถึงสาขา (เพิ่มสต็อก)" icon="storefront-outline" value={sh.destBranchId} branches={branches} disabled={!isDraft}
                  exclude={sh.sourceBranchId} onChange={(id) => update({ destBranchId: id! })}
                />
                <BranchField
                  label="ตัดสต็อกจากสาขา" icon="remove-circle-outline" value={sh.sourceBranchId} branches={branches} disabled={!isDraft}
                  exclude={sh.destBranchId} allowNone onChange={(id) => update({ sourceBranchId: id })}
                />
                <View style={[s.row, { gap: 16, flexWrap: 'wrap' }]}>
                  <View style={{ gap: 4 }}>
                    <Text style={s.label}>จำนวนบรรจุ</Text>
                    <Stepper value={sh.bags} suffix="ถุง" disabled={!isDraft} onChange={(n) => update({ bags: n })} />
                  </View>
                  <View style={{ flex: 1, minWidth: 200, gap: 4 }}>
                    <Text style={s.label}>หมายเหตุ</Text>
                    <NoteInput value={sh.note ?? ''} disabled={!isDraft} onSave={(t) => update({ note: t })} />
                  </View>
                </View>

                <View style={[s.statusBox, { backgroundColor: STATUS[view].bg }]}>
                  <Text style={[s.statusTitle, { color: STATUS[view].fg }]}>
                    {sh.status === 'cancelled'
                      ? `ยกเลิกแล้ว — โดย ${sh.cancelledBy ?? '-'}${sh.cancelledAt ? ` · ${thaiDateTime(sh.cancelledAt)}` : ''}`
                      : sh.status === 'shipped'
                      ? 'ส่งออกจากโรงงานแล้ว'
                      : held
                        ? `พักไว้ — โดย ${sh.heldBy ?? '-'} · ${thaiDateTime(sh.heldAt!)}`
                        : 'กำลังจัดเตรียม — สแกนสินค้าแล้วกด "ส่งออก" (หรือ "พักไว้" ถ้ายังไม่เสร็จ)'}
                  </Text>
                  <Text style={s.small}>
                    {sh.status === 'cancelled'
                      ? `เหตุผล: ${sh.cancelReason ?? '-'} · สต็อกไม่เปลี่ยน${sh.purgeAt ? ` · จะลบถาวร ${thaiDateTime(sh.purgeAt)}` : ''}`
                      : held
                      ? `รายการที่สแกนแล้ว ${units.toLocaleString()} ตัว ยังอยู่ครบ · กด "ทำต่อ" เพื่อสแกนต่อ`
                      : sh.status === 'shipped'
                      ? `เพิ่มสต็อก${sh.destBranchName}แล้ว${sh.sourceBranchName ? ` · ตัดสต็อก${sh.sourceBranchName}แล้ว` : ' · ไม่ได้ตัดสต็อกสาขาใด'} · รายการถูกล็อก`
                      : sh.sourceBranchName
                        ? `ตอนส่งออก: ตัดสต็อก${sh.sourceBranchName} → เพิ่มสต็อก${sh.destBranchName}`
                        : `ตอนส่งออก: เพิ่มสต็อก${sh.destBranchName} (ไม่ตัดสต็อกสาขาใด)`}
                  </Text>
                  {sh.status === 'cancelled' ? (
                    <Pressable style={[s.pillBtn, s.primaryBtn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => restore(sh.id)} accessibilityLabel="กู้คืนเป็นฉบับร่าง">
                      <Icon name="arrow-undo" size={16} color="#fff" />
                      <Text style={[s.pillText, { color: '#fff', fontWeight: '700' }]}>กู้คืนเป็นฉบับร่าง</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {/* สแกน (พักไว้ → แสดงปุ่มทำต่อแทน) */}
              {held ? (
                <View style={[s.card, s.heldCard, wide && { flex: 1 }]}>
                  <Icon name="pause-circle-outline" size={44} color={STATUS.held.fg} />
                  <Text style={[s.cardTitle, { color: STATUS.held.fg }]}>ใบส่งของนี้พักไว้</Text>
                  <Text style={[s.small, { textAlign: 'center' }]}>
                    สแกนไปแล้ว {units.toLocaleString()} ตัว ({cur!.items.length} รายการ) — กลับมาทำต่อได้ทุกเมื่อ แม้ปิดเบราว์เซอร์หรือเปลี่ยนเครื่อง
                  </Text>
                  <Pressable style={[s.pillBtn, s.primaryBtn, { paddingHorizontal: 28 }]} onPress={resume} accessibilityLabel="ทำต่อ">
                    <Icon name="play" size={18} color="#fff" />
                    <Text style={[s.pillText, { color: '#fff', fontWeight: '700' }]}>ทำต่อ</Text>
                  </Pressable>
                </View>
              ) : null}
              {isDraft ? (
                <ScanBox
                  docId={sh.id}
                  fill={wide}
                  style={wide ? { flex: 1 } : undefined}
                  onScan={async (code, qty) => {
                    try {
                      const d = await api.scanShipment(sh.id, code, qty);
                      apply(d);
                      beep(true);
                      return { ok: true, text: `${d.scanned!.added > 0 ? '+' : ''}${d.scanned!.added} · ${d.scanned!.name} (${d.scanned!.label}) → ${d.scanned!.qty} ตัว` };
                    } catch (e) {
                      beep(false);
                      return { ok: false, text: (e as Error).message };
                    }
                  }}
                />
              ) : null}
            </View>

            {/* รายการ */}
            <View style={[s.card, { gap: 8 }]}>
              <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
                <Text style={s.cardTitle}>
                  รายการที่สแกนแล้ว ({cur!.items.length} รายการ / รวม {units.toLocaleString()} ตัว)
                </Text>
                {short.length && isDraft ? (
                  <Text style={[s.small, { color: colors.danger }]}>⚠ สต็อก{sh.sourceBranchName}ไม่พอ {short.length} รายการ</Text>
                ) : null}
              </View>
              {cur!.items.length === 0 ? (
                <Text style={[s.small, { textAlign: 'center', paddingVertical: 24 }]}>ยังไม่มีสินค้า — สแกนบาร์โค้ดหรือพิมพ์รหัส SKU ในช่องสแกน</Text>
              ) : (
                <>
                  {!mobile ? (
                    <View style={s.thead}>
                      <Text style={[s.th, { width: 36 }]}>#</Text>
                      <Text style={[s.th, { flex: 1 }]}>สินค้า / รหัส</Text>
                      <Text style={[s.th, { width: 150 }]}>สี / ไซซ์</Text>
                      {cur!.sourceStock && isDraft ? <Text style={[s.th, { width: 90, textAlign: 'right' }]}>สต็อกต้นทาง</Text> : null}
                      <Text style={[s.th, { width: isDraft ? 150 : 90, textAlign: 'center' }]}>จำนวนส่ง</Text>
                    </View>
                  ) : null}
                  {cur!.items.map((it, n) => {
                    const have = cur!.sourceStock?.[it.variantId];
                    const lack = have !== undefined && have < it.qty;
                    return (
                      <View key={it.variantId} style={[s.tr, mobile && { flexWrap: 'wrap' }]}>
                        {!mobile ? <Text style={[s.cell, { width: 36 }]}>{n + 1}</Text> : null}
                        <View style={{ flex: 1, minWidth: 160 }}>
                          <Text style={s.name} numberOfLines={2}>{it.name}</Text>
                          <Text style={s.sku}>{it.barcode && it.barcode !== it.sku ? `CODE : ${it.barcode}  |  ` : ''}SKU : {it.sku}{mobile ? ` · ${it.label}` : ''}</Text>
                        </View>
                        {!mobile ? <Text style={[s.cell, { width: 150 }]}>{it.label}</Text> : null}
                        {cur!.sourceStock && isDraft && !mobile ? (
                          <Text style={[s.cell, { width: 90, textAlign: 'right' }, lack && { color: colors.danger, fontWeight: '700' }]}>{have ?? 0}</Text>
                        ) : null}
                        <View style={{ width: isDraft ? 150 : 90, alignItems: 'center' }}>
                          {isDraft ? (
                            <Stepper
                              value={it.qty}
                              min={0}
                              onChange={(q) => api.setShipmentItem(sh.id, it.variantId, q).then(apply).catch((e: Error) => notify('error', e.message))}
                            />
                          ) : (
                            <Text style={s.qty}>{it.qty.toLocaleString()} ตัว</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          </ScrollView>
        )}

        {/* แถบส่งออก */}
        {sh && isOpen ? (
          <View style={s.bar}>
            <Pressable style={s.ghostBtn} onPress={() => { setCancelReason(''); setCancelAsk(true); }} accessibilityLabel="ยกเลิกใบส่งของ">
              <Text style={[s.pillText, { color: colors.danger }]}>ยกเลิกใบนี้</Text>
            </Pressable>
            <Text style={[s.small, { flex: 1 }]} numberOfLines={2}>
              {held ? 'พักไว้ — กด "ทำต่อ" เพื่อสแกนต่อ' : units ? `${units.toLocaleString()} ตัว → ${sh.destBranchName}` : 'ยังไม่มีสินค้า'}
            </Text>
            {held ? (
              <Pressable style={[s.pillBtn, s.primaryBtn]} onPress={resume} accessibilityLabel="ทำต่อ">
                <Icon name="play" size={18} color="#fff" />
                <Text style={[s.pillText, { color: '#fff', fontWeight: '700' }]}>ทำต่อ</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={[s.pillBtn, s.holdBtn]} onPress={hold} accessibilityLabel="พักไว้ (Hold)">
                  <Icon name="pause" size={18} color={STATUS.held.fg} />
                  <Text style={[s.pillText, { color: STATUS.held.fg, fontWeight: '700' }]}>พักไว้ (Hold)</Text>
                </Pressable>
                <Pressable style={[s.pillBtn, s.shipBtn, !units && { opacity: 0.45 }]} disabled={!units} onPress={() => setConfirm(true)} accessibilityLabel="ส่งออก">
                  <Icon name="paper-plane-outline" size={18} color="#fff" />
                  <Text style={[s.pillText, { color: '#fff', fontWeight: '700' }]}>ส่งออก</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </View>

      {/* เลือกใบส่งของ */}
      <Sheet visible={picker} onClose={() => setPicker(false)} title="เลือกใบส่งของ" width={560}>
        <View style={[s.row, { gap: 6, marginBottom: 10 }]}>
          {([['active', `ใช้งาน (${list?.length ?? 0})`], ['cancelled', `ยกเลิกแล้ว (${cancelledList.length})`]] as const).map(([k, t]) => (
            <Pressable key={k} style={[s.tab, pickTab === k && s.tabOn]} onPress={() => setPickTab(k)}>
              <Text style={[s.tabText, pickTab === k && { color: '#fff' }]}>{t}</Text>
            </Pressable>
          ))}
        </View>
        {pickTab === 'cancelled' ? (
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 6 }}>
            <Text style={[s.small, { marginBottom: 4 }]}>ใบที่ยกเลิกจะเก็บไว้ {keepDays} วัน แล้วลบออกจากฐานข้อมูลถาวรอัตโนมัติ · กู้คืนได้ก่อนครบกำหนด</Text>
            {cancelledList.length === 0 ? <Text style={[s.small, { textAlign: 'center', paddingVertical: 24 }]}>ไม่มีใบที่ยกเลิก</Text> : null}
            {cancelledList.map((x) => (
              <View key={x.id} style={[s.opt, x.id === sh?.id && s.optOn]}>
                <Pressable style={{ flex: 1 }} onPress={() => { open(x.id); setPicker(false); }}>
                  <Text style={s.name}>{x.docNo} ➔ {x.destBranchName} · {x.units.toLocaleString()} ตัว</Text>
                  <Text style={s.small} numberOfLines={2}>
                    ยกเลิกโดย {x.cancelledBy ?? '-'}{x.cancelledAt ? ` · ${thaiDateTime(x.cancelledAt)}` : ''} · เหตุผล: {x.cancelReason ?? '-'}
                  </Text>
                  {x.purgeAt ? <Text style={[s.small, { color: colors.danger }]}>ลบถาวร {thaiDateTime(x.purgeAt)}</Text> : null}
                </Pressable>
                <Pressable style={[s.pillBtn, { paddingHorizontal: 12 }]} onPress={() => restore(x.id)} accessibilityLabel={`กู้คืน ${x.docNo}`}>
                  <Icon name="arrow-undo" size={15} color={colors.primary} />
                  <Text style={[s.pillText, { color: colors.primary }]}>กู้คืน</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : (
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 6 }}>
          {list?.map((x) => (
            <Pressable key={x.id} style={[s.opt, x.id === sh?.id && s.optOn]} onPress={() => { open(x.id); setPicker(false); }}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{x.docNo} ➔ {x.destBranchName}</Text>
                <Text style={s.small}>
                  {thaiDateTime(x.shippedAt ?? x.createdAt)} · {x.units.toLocaleString()} ตัว · {x.sourceBranchName ? `ตัดจาก${x.sourceBranchName}` : 'ไม่ตัดสต็อก'}
                </Text>
              </View>
              <StatusChip status={statusOf(x)} />
            </Pressable>
          ))}
        </ScrollView>
        )}
      </Sheet>

      {/* ยืนยันยกเลิก */}
      <Sheet
        visible={cancelAsk}
        onClose={() => !busy && setCancelAsk(false)}
        title={`ยกเลิก ${sh?.docNo ?? ''} (${units.toLocaleString()} ตัว) ใช่ไหม`}
        width={460}
        footer={
          <View style={[s.row, { justifyContent: 'flex-end' }]}>
            <Pressable style={s.ghostBtn} onPress={() => setCancelAsk(false)} disabled={busy}>
              <Text style={s.pillText}>ไม่ยกเลิก</Text>
            </Pressable>
            <Pressable style={[s.pillBtn, s.dangerBtn, !cancelReason.trim() && { opacity: 0.45 }]} onPress={cancel} disabled={busy || !cancelReason.trim()}>
              {busy ? <ActivityIndicator color="#fff" /> : <Icon name="close-circle-outline" size={18} color="#fff" />}
              <Text style={[s.pillText, { color: '#fff', fontWeight: '700' }]}>ยืนยันยกเลิก</Text>
            </Pressable>
          </View>
        }
      >
        <View style={{ gap: 10 }}>
          <Line icon="information-circle-outline" color={colors.sub} text="สต็อกทุกสาขาไม่เปลี่ยน (ใบนี้ยังไม่ได้ส่งออก)" />
          <Line icon="time-outline" color={colors.danger} text={`เก็บไว้ ${keepDays} วันให้กู้คืนได้ แล้วลบออกจากฐานข้อมูลถาวร`} />
          <Text style={s.label}>เหตุผลที่ยกเลิก *</Text>
          <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
            {['สร้างผิด', 'สแกนผิดทั้งใบ', 'ยกเลิกการส่ง', 'สร้างซ้ำ'].map((r) => (
              <Pressable key={r} style={[s.tab, cancelReason === r && s.tabOn]} onPress={() => setCancelReason(r)}>
                <Text style={[s.tabText, cancelReason === r && { color: '#fff' }]}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={cancelReason}
            onChangeText={setCancelReason}
            placeholder="หรือพิมพ์เหตุผล…"
            placeholderTextColor={colors.faint}
            style={s.reasonInput}
            maxLength={200}
          />
        </View>
      </Sheet>

      <CreateSheet
        visible={creating}
        branches={branches}
        onClose={() => setCreating(false)}
        onCreate={async (b) => {
          const d = await api.createShipment(b);
          setCreating(false);
          notify('success', `สร้าง ${d.shipment.docNo} แล้ว — เริ่มสแกนได้เลย`);
          load(d.shipment.id);
        }}
      />

      <Sheet
        visible={confirm}
        onClose={() => !busy && setConfirm(false)}
        title={`ยืนยันส่งออก ${sh?.docNo ?? ''}`}
        width={460}
        footer={
          <View style={[s.row, { justifyContent: 'flex-end' }]}>
            <Pressable style={s.ghostBtn} onPress={() => setConfirm(false)} disabled={busy}>
              <Text style={s.pillText}>กลับไปแก้ไข</Text>
            </Pressable>
            <Pressable style={[s.pillBtn, s.shipBtn]} onPress={ship} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Icon name="paper-plane-outline" size={18} color="#fff" />}
              <Text style={[s.pillText, { color: '#fff', fontWeight: '700' }]}>ยืนยันส่งออก</Text>
            </Pressable>
          </View>
        }
      >
        {sh ? (
          <View style={{ gap: 10 }}>
            <Line icon="cube-outline" text={`${units.toLocaleString()} ตัว (${cur?.items.length} รายการ) · ${sh.bags} ถุง`} />
            <Line icon="add-circle-outline" color={colors.success} text={`เพิ่มสต็อก ${sh.destBranchName}`} />
            <Line
              icon={sh.sourceBranchName ? 'remove-circle-outline' : 'ban-outline'}
              color={sh.sourceBranchName ? colors.danger : colors.sub}
              text={sh.sourceBranchName ? `ตัดสต็อก ${sh.sourceBranchName}` : 'ไม่ตัดสต็อกสาขาใด (ของใหม่จากโรงงาน)'}
            />
            {short.length ? (
              <Text style={[s.small, { color: colors.danger }]}>
                ⚠ สต็อก{sh.sourceBranchName}ไม่พอ {short.length} รายการ — ถ้าไม่ได้เปิด "ขายได้แม้สต็อกหมด" ระบบจะไม่ให้ส่ง
              </Text>
            ) : null}
            <Text style={s.small}>ส่งออกแล้วรายการจะถูกล็อก แก้ไขไม่ได้</Text>
          </View>
        ) : null}
      </Sheet>

      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="shipments" onNavigate={onNavigate} />
      <ToastView toast={toast} onDone={clearToast} />
    </View>
  );
}

function StatusChip({ status }: { status: keyof typeof STATUS }) {
  const t = STATUS[status];
  return (
    <View style={[s.chip, { backgroundColor: t.bg }]}>
      <Text style={[s.chipText, { color: t.fg }]}>{t.label}</Text>
    </View>
  );
}

function Line({ icon, text, color = colors.text }: { icon: Parameters<typeof Icon>[0]['name']; text: string; color?: string }) {
  return (
    <View style={s.row}>
      <Icon name={icon} size={18} color={color} />
      <Text style={[s.pillText, { color, flex: 1 }]}>{text}</Text>
    </View>
  );
}

/** เลือกสาขาแบบปุ่ม (allowNone = มีตัวเลือก "ไม่ตัดสต็อก") */
function BranchField({ label, icon, value, branches, onChange, disabled, allowNone, exclude }: {
  label: string; icon: Parameters<typeof Icon>[0]['name']; value: number | null; branches: ShipBranch[];
  onChange: (id: number | null) => void; disabled?: boolean; allowNone?: boolean; exclude?: number | null;
}) {
  const opts: [number | null, string][] = [
    ...(allowNone ? [[null, 'ไม่ตัดสต็อก'] as [null, string]] : []),
    ...branches.filter((b) => b.id !== exclude).map((b) => [b.id, b.name] as [number, string]),
  ];
  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <Icon name={icon} size={16} color={colors.sub} />
        <Text style={s.label}>{label}</Text>
      </View>
      <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
        {opts.map(([id, name]) => {
          const on = id === value;
          if (disabled && !on) return null;
          return (
            <Pressable key={String(id)} disabled={disabled} onPress={() => onChange(id)} style={[s.seg, on && s.segOn, disabled && on && { opacity: 0.9 }]}>
              <Text style={[s.segText, on && { color: '#fff', fontWeight: '600' }]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Stepper({ value, onChange, suffix, disabled, min = 1 }: { value: number; onChange: (n: number) => void; suffix?: string; disabled?: boolean; min?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (n: number) => {
    const v = Math.max(min, Math.min(99999, Math.floor(n) || 0));
    setText(String(v));
    if (v !== value) onChange(v);
  };
  if (disabled) return <Text style={s.qty}>{value.toLocaleString()} {suffix ?? ''}</Text>;
  return (
    <View style={s.stepper}>
      <Pressable style={s.stepBtn} onPress={() => commit(value - 1)} accessibilityLabel="ลด">
        <Icon name={value - 1 < 1 && min === 0 ? 'trash-outline' : 'remove'} size={14} color={value - 1 < 1 && min === 0 ? colors.danger : colors.text} />
      </Pressable>
      <TextInput
        value={text}
        onChangeText={(t) => setText(t.replace(/[^0-9]/g, '').slice(0, 5))}
        onBlur={() => commit(Number(text))}
        onSubmitEditing={() => commit(Number(text))}
        keyboardType="number-pad"
        selectTextOnFocus
        style={s.stepInput}
      />
      <Pressable style={s.stepBtn} onPress={() => commit(value + 1)} accessibilityLabel="เพิ่ม">
        <Icon name="add" size={14} color={colors.text} />
      </Pressable>
      {suffix ? <Text style={[s.small, { marginLeft: 4 }]}>{suffix}</Text> : null}
    </View>
  );
}

function NoteInput({ value, onSave, disabled }: { value: string; onSave: (t: string) => void; disabled?: boolean }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  if (disabled) return <Text style={s.cell}>{value || '-'}</Text>;
  return (
    <TextInput
      value={t}
      onChangeText={setT}
      onBlur={() => t !== value && onSave(t)}
      placeholder="เช่น ล็อตผลิต / ชื่อคนขับ"
      placeholderTextColor={colors.faint}
      maxLength={300}
      style={s.input}
    />
  );
}

/** ช่องสแกน: Enter = เพิ่มตามจำนวนที่เลือก · โหมดลบ = ลดจำนวน */
interface ScanLog { id: number; at: string; ok: boolean; text: string; code: string }
const LOG_MAX = 100;
/** ประวัติการสแกนของแต่ละใบส่งของ — เก็บในเครื่องนี้ (พัก/รีเฟรชแล้วยังอยู่) */
const logKey = (docId: number) => `pos.scanlog.${docId}`;
function readLog(docId: number): ScanLog[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(logKey(docId)) ?? '[]');
    return Array.isArray(v) ? v.slice(0, LOG_MAX) : [];
  } catch {
    return [];
  }
}
function writeLog(docId: number, log: ScanLog[]) {
  try {
    globalThis.localStorage?.setItem(logKey(docId), JSON.stringify(log.slice(0, LOG_MAX)));
  } catch {
    /* เก็บไม่ได้ก็ใช้ในหน้านี้ไปก่อน */
  }
}
const hhmmss = () => new Date().toTimeString().slice(0, 8);

/** fill = สูงเท่าการ์ดข้าง ๆ (จอกว้าง) — ประวัติยาวเกินจะเลื่อนดูในกรอบ */
function ScanBox({ docId, onScan, style, fill }: { docId: number; onScan: (code: string, qty: number) => Promise<{ ok: boolean; text: string }>; style?: object; fill?: boolean }) {
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  const [remove, setRemove] = useState(false);
  const [log, setLog] = useState<ScanLog[]>(() => readLog(docId));
  const [filter, setFilter] = useState<'all' | 'error'>('all');
  const [busy, setBusy] = useState(false);
  const ref = useRef<TextInput>(null);
  useEffect(() => setLog(readLog(docId)), [docId]);

  const submit = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    const r = await onScan(c, remove ? -step : step);
    setBusy(false);
    setLog((l) => {
      const next = [{ id: Date.now(), at: hhmmss(), ok: r.ok, text: r.text, code: c }, ...l].slice(0, LOG_MAX);
      writeLog(docId, next);
      return next;
    });
    setCode('');
    setTimeout(() => ref.current?.focus(), 0);
  };
  const errors = log.filter((x) => !x.ok).length;
  const shown = filter === 'error' ? log.filter((x) => !x.ok) : log;

  return (
    <View style={[s.card, { gap: 10, borderColor: colors.primary, borderWidth: 1.5 }, style]}>
      <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
        <View style={s.row}>
          <Icon name="barcode-outline" size={20} color={colors.primary} />
          <Text style={s.cardTitle}>สแกนสินค้าใส่ใบส่งของ</Text>
        </View>
        <Pressable onPress={() => setRemove((r) => !r)} style={[s.chip, { backgroundColor: remove ? colors.dangerSoft : colors.surface }]}>
          <Text style={[s.chipText, { color: remove ? colors.danger : colors.sub }]}>{remove ? 'โหมดลบออก (−)' : 'โหมดเพิ่ม (+)'}</Text>
        </Pressable>
      </View>
      <View style={s.row}>
        <TextInput
          ref={ref}
          value={code}
          onChangeText={setCode}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          autoFocus
          autoCapitalize="characters"
          placeholder="สแกนบาร์โค้ด หรือพิมพ์รหัส SKU แล้วกด Enter"
          placeholderTextColor={colors.faint}
          style={[s.input, s.scanInput, remove && { borderColor: colors.danger }]}
        />
        <Pressable style={[s.pillBtn, s.primaryBtn, remove && { backgroundColor: colors.danger, borderColor: colors.danger }]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Icon name={remove ? 'remove' : 'add'} size={18} color="#fff" />}
        </Pressable>
      </View>
      <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
        <Text style={s.small}>สแกน 1 ครั้ง =</Text>
        {STEPS.map((n) => (
          <Pressable key={n} onPress={() => setStep(n)} style={[s.seg, step === n && s.segOn]}>
            <Text style={[s.segText, step === n && { color: '#fff', fontWeight: '600' }]}>{n} ตัว</Text>
          </Pressable>
        ))}
      </View>
      {/* ล่าสุด (ตัวใหญ่ เห็นชัดตอนสแกนรัว ๆ) */}
      {log[0] ? (
        <View style={[s.lastScan, { backgroundColor: log[0].ok ? colors.successSoft : colors.dangerSoft }]}>
          <Icon name={log[0].ok ? 'checkmark-circle' : 'alert-circle'} size={20} color={log[0].ok ? colors.success : colors.danger} />
          <Text style={[s.pillText, { flex: 1, color: log[0].ok ? colors.success : colors.danger, fontWeight: '600' }]} numberOfLines={2}>{log[0].text}</Text>
        </View>
      ) : null}

      {/* ประวัติการสแกน */}
      <View style={[s.logBox, fill && { flex: 1, minHeight: 170 }]}>
        <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
          <View style={s.row}>
            <Icon name="time-outline" size={16} color={colors.sub} />
            <Text style={s.label}>ประวัติการสแกน</Text>
            <Text style={s.small}>
              {log.length} ครั้ง{errors ? ' · ' : ''}
              {errors ? <Text style={{ color: colors.danger, fontWeight: '600' }}>ผิดพลาด {errors}</Text> : null}
            </Text>
          </View>
          <View style={[s.row, { gap: 6 }]}>
            {(['all', 'error'] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)} style={[s.logTab, filter === f && s.logTabOn]}>
                <Text style={[s.small, filter === f && { color: colors.text, fontWeight: '600' }]}>{f === 'all' ? 'ทั้งหมด' : 'เฉพาะผิดพลาด'}</Text>
              </Pressable>
            ))}
            {log.length ? (
              <Pressable onPress={() => { setLog([]); writeLog(docId, []); }} accessibilityLabel="ล้างประวัติการสแกน">
                <Text style={[s.small, { color: colors.danger }]}>ล้าง</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {shown.length === 0 ? (
          <Text style={[s.small, { textAlign: 'center', paddingVertical: 14 }]}>
            {filter === 'error' ? 'ไม่มีรายการผิดพลาด' : 'ยังไม่มีการสแกน — ผลการสแกนแต่ละครั้งจะแสดงที่นี่'}
          </Text>
        ) : (
          // จอกว้าง: กรอบเลื่อนวางทับพื้นที่ที่เหลือ (ไม่ดันการ์ดให้สูงขึ้น) · จอแคบ: สูงสุด 260
          <View style={fill ? { flex: 1, minHeight: 0 } : undefined}>
          <ScrollView style={fill ? StyleSheet.absoluteFill : { maxHeight: 260 }} nestedScrollEnabled>
            {shown.map((x, i) => (
              <View key={x.id + '-' + i} style={[s.logRow, i === 0 && filter === 'all' && { backgroundColor: '#F7F9FF' }]}>
                <Icon name={x.ok ? 'checkmark-circle' : 'close-circle'} size={16} color={x.ok ? colors.success : colors.danger} />
                <Text style={s.logTime}>{x.at}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.logText, !x.ok && { color: colors.danger }]} numberOfLines={2}>{x.text}</Text>
                  <Text style={s.logCode} numberOfLines={1}>{x.code}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

function CreateSheet({ visible, branches, onClose, onCreate }: {
  visible: boolean; branches: ShipBranch[]; onClose: () => void;
  onCreate: (b: { destBranchId: number; sourceBranchId: number | null; bags: number; note?: string }) => Promise<void>;
}) {
  const [dest, setDest] = useState<number | null>(null);
  const [source, setSource] = useState<number | null>(null);
  const [bags, setBags] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setDest(branches.find((b) => !b.isMain)?.id ?? branches[0]?.id ?? null);
    setSource(null);
    setBags(1);
    setNote('');
    setErr(null);
  }, [visible, branches]);

  const go = async () => {
    if (!dest) return setErr('กรุณาเลือกสาขาปลายทาง');
    setBusy(true);
    setErr(null);
    try {
      await onCreate({ destBranchId: dest, sourceBranchId: source, bags, note: note.trim() || undefined });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="สร้างใบส่งของใหม่ (DO)"
      width={520}
      footer={
        <View style={[s.row, { justifyContent: 'flex-end' }]}>
          <Pressable style={s.ghostBtn} onPress={onClose}>
            <Text style={s.pillText}>ยกเลิก</Text>
          </Pressable>
          <Pressable style={[s.pillBtn, s.primaryBtn]} onPress={go} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Icon name="add" size={18} color="#fff" />}
            <Text style={[s.pillText, { color: '#fff' }]}>สร้างและเริ่มสแกน</Text>
          </Pressable>
        </View>
      }
    >
      <View style={{ gap: 14 }}>
        <BranchField label="ส่งถึงสาขา (เพิ่มสต็อก)" icon="storefront-outline" value={dest} branches={branches} exclude={source} onChange={setDest} />
        <BranchField label="ตัดสต็อกจากสาขา" icon="remove-circle-outline" value={source} branches={branches} exclude={dest} allowNone onChange={setSource} />
        <Text style={s.small}>
          {source ? 'ตอนส่งออก ระบบจะตัดสต็อกสาขาที่เลือก แล้วเพิ่มให้สาขาปลายทาง (โอนย้ายสต็อก)' : '"ไม่ตัดสต็อก" = ของผลิตใหม่จากโรงงาน — ระบบเพิ่มสต็อกให้สาขาปลายทางอย่างเดียว'}
        </Text>
        <View style={[s.row, { gap: 16, flexWrap: 'wrap' }]}>
          <View style={{ gap: 4 }}>
            <Text style={s.label}>จำนวนบรรจุ</Text>
            <Stepper value={bags} suffix="ถุง" onChange={setBags} />
          </View>
          <View style={{ flex: 1, minWidth: 200, gap: 4 }}>
            <Text style={s.label}>หมายเหตุ</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="ไม่บังคับ" placeholderTextColor={colors.faint} maxLength={300} style={s.input} />
          </View>
        </View>
        {err ? <Text style={s.err}>{err}</Text> : null}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  sub: { fontFamily: font, fontSize: 12, color: colors.sub },
  pillBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, paddingHorizontal: 16,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  primaryBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
  shipBtn: { backgroundColor: colors.success, borderColor: colors.success, paddingHorizontal: 24 },
  holdBtn: { backgroundColor: '#EFE9FF', borderColor: '#D9CCFA' },
  dangerBtn: { backgroundColor: colors.danger, borderColor: colors.danger, paddingHorizontal: 20 },
  tab: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '600' },
  reasonInput: { fontFamily: font, fontSize: 14, color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, height: 44 },
  heldCard: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 28, borderColor: '#D9CCFA', borderWidth: 1.5, backgroundColor: '#FBF9FF' },
  ghostBtn: { height: 44, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, backgroundColor: '#fff' },
  cardTitle: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  label: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text },
  small: { fontFamily: font, fontSize: 11.5, color: colors.sub },
  docNo: { fontFamily: 'monospace', fontSize: 20, fontWeight: '700', color: colors.text, marginVertical: 2 },
  big: { fontFamily: font, fontSize: 24, fontWeight: '700', color: colors.text },
  unit: { fontSize: 12, fontWeight: '400', color: colors.sub },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 42, paddingHorizontal: 14, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, minWidth: 260, maxWidth: 460,
  },
  selectText: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  chipText: { fontFamily: font, fontSize: 11.5, fontWeight: '600' },
  seg: { paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  segOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText: { fontFamily: font, fontSize: 12.5, color: colors.text },
  statusBox: { borderRadius: radius.md, padding: 12, gap: 2 },
  statusTitle: { fontFamily: font, fontSize: 13, fontWeight: '700' },
  input: {
    fontFamily: font, fontSize: 13, color: colors.text, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 12, backgroundColor: '#fff',
  },
  scanInput: { flex: 1, height: 48, fontSize: 16, borderColor: colors.primary },
  lastScan: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md },
  logBox: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, gap: 6 },
  logTab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surface },
  logTabOn: { backgroundColor: colors.primarySoft },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#F2F4F7', borderRadius: 6 },
  logTime: { fontFamily: 'monospace', fontSize: 11.5, color: colors.sub, width: 62 },
  logText: { fontFamily: font, fontSize: 12.5, color: colors.text },
  logCode: { fontFamily: 'monospace', fontSize: 10.5, color: colors.faint },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3 },
  stepBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stepInput: { width: 54, textAlign: 'center', fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text, outlineStyle: 'none' } as object,
  thead: { flexDirection: 'row', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 8 },
  th: { fontFamily: font, fontSize: 12, color: colors.sub },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  cell: { fontFamily: font, fontSize: 12.5, color: colors.sub },
  name: { fontFamily: font, fontSize: 13.5, fontWeight: '600', color: colors.text },
  sku: { fontFamily: 'monospace', fontSize: 11.5, color: colors.success, marginTop: 2 },
  qty: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  bar: {
    position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10,
    borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  optOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 60 },
  emptyText: { fontFamily: font, fontSize: 14, color: colors.sub },
  err: { fontFamily: font, fontSize: 12.5, color: colors.danger },
});
