// รายละเอียดบิล: รายการ · ยอด · VAT · พิมพ์ · ยกเลิก · แก้ไข · ใบกำกับเต็มรูป · ใบลดหนี้ · ประวัติ
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { api } from '../../api';
import { useAppSettings } from '../../appSettings';
import { baht, PAYMENT_LABEL, thaiDateTime, variantLabel, vatLabel } from '../../format';
import { printReceipt, printTaxDoc } from '../../print';
import type { Toast } from '../../store/usePos';
import { colors, font, radius } from '../../theme';
import type { Bootstrap, Order, OrderDetail } from '../../types';
import { GarmentArt } from '../GarmentArt';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { Badge } from './Badge';
import { BillEditor } from './BillEditor';
import { CreditNoteDialog } from './CreditNoteDialog';
import { TaxInvoiceDialog } from './TaxInvoiceDialog';
import { VoidDialog } from './VoidDialog';

interface Props {
  orderId: number | null;
  catalog: Bootstrap | null;
  onClose: () => void;
  onChanged: () => void;
  notify: (kind: Toast['kind'], text: string) => void;
}

export function OrderDetailModal({ orderId, catalog, onClose, onChanged, notify }: Props) {
  const { width } = useWindowDimensions();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [crediting, setCrediting] = useState(false);

  const load = useCallback(async (id: number) => {
    setError(null);
    try {
      setOrder(await api.orderDetail(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setOrder(null);
    if (orderId != null) load(orderId);
  }, [orderId, load]);

  const isVoid = order?.status === 'void';
  const narrow = width < 600;
  // สาขาที่จด VAT + ตั้ง "ห้ามแก้ไขบิล" → เปลี่ยน/คืนสินค้าต้องยกเลิกบิลแล้วออกใหม่
  const locked = !!useAppSettings().tax?.lockEdit;
  // เอกสารภาษีหลังการขาย (เฉพาะบิลที่คิด VAT): ใบกำกับภาษีเต็มรูป · ใบลดหนี้
  const taxed = !!order && !isVoid && (order.vatRate ?? 0) > 0 && order.vat > 0;
  const activeTiv = order?.taxInvoices?.find((t) => t.status === 'active') ?? null;
  const credits = order?.creditNotes ?? [];
  const returnable = !!order && order.items.some((i) => i.itemId != null && i.qty - (order.returned?.[String(i.itemId)] ?? 0) > 0);
  const refresh = () => {
    if (order) load(order.id);
    onChanged();
  };
  const openTiv = async (id: number) => {
    try {
      printTaxDoc({ kind: 'invoice', doc: await api.taxInvoice(id) });
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };
  const openCn = async (id: number) => {
    try {
      printTaxDoc({ kind: 'credit', doc: await api.creditNoteDoc(id) });
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };
  const cancelTiv = async (id: number, docNo: string) => {
    const reason = typeof window !== 'undefined' ? window.prompt(`เหตุผลที่ยกเลิกใบกำกับภาษี ${docNo} (เช่น ชื่อ/ที่อยู่ผิด)`) : null;
    if (!reason?.trim()) return;
    try {
      await api.cancelTaxInvoice(id, reason.trim());
      notify('success', `ยกเลิกใบกำกับภาษี ${docNo} แล้ว — ออกใบใหม่ได้`);
      refresh();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  return (
    <>
      <Sheet
        visible={orderId != null}
        onClose={onClose}
        title={order ? `บิล ${order.orderNo}` : 'รายละเอียดบิล'}
        width={620}
        footer={
          order ? (
            <View style={[s.actions, narrow && { flexWrap: 'wrap' }]}>
              <Pressable style={[s.btn, s.ghost]} onPress={() => printReceipt(order as unknown as Order)}>
                <Icon name="print-outline" size={17} color={colors.text} />
                <Text style={s.ghostText}>พิมพ์</Text>
              </Pressable>
              <Pressable style={[s.btn, s.danger, isVoid && s.disabled]} disabled={isVoid} onPress={() => setVoiding(true)}>
                <Icon name="close-circle-outline" size={17} color={colors.danger} />
                <Text style={s.dangerText}>ยกเลิกบิล</Text>
              </Pressable>
              {taxed ? (
                <Pressable style={[s.btn, s.ghost, !!(activeTiv || credits.length) && s.disabled]} disabled={!!(activeTiv || credits.length)} onPress={() => setIssuing(true)}>
                  <Icon name="document-text-outline" size={17} color={colors.text} />
                  <Text style={s.ghostText}>ใบกำกับเต็มรูป</Text>
                </Pressable>
              ) : null}
              {taxed ? (
                <Pressable style={[s.btn, s.ghost, !returnable && s.disabled]} disabled={!returnable} onPress={() => setCrediting(true)}>
                  <Icon name="return-down-back-outline" size={17} color={colors.text} />
                  <Text style={s.ghostText}>คืนสินค้า / ใบลดหนี้</Text>
                </Pressable>
              ) : null}
              {locked ? null : (
                <Pressable
                  style={[s.btn, s.primary, { flexGrow: 2 }, (isVoid || !catalog) && s.disabled]}
                  disabled={isVoid || !catalog}
                  onPress={() => setEditing(true)}
                >
                  <Icon name="swap-horizontal" size={17} color="#fff" />
                  <Text style={s.primaryText}>แก้ไขบิล / เปลี่ยนสินค้า</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
      >
        {error ? <Text style={s.error}>{error}</Text> : null}
        {!order && !error ? <ActivityIndicator style={{ marginVertical: 40 }} color={colors.primary} /> : null}
        {order ? (
          <ScrollView style={{ maxHeight: 560 }}>
            {isVoid ? (
              <View style={s.voidBanner}>
                <Icon name="alert-circle" size={18} color={colors.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={s.voidText}>บิลนี้ถูกยกเลิก · {order.voidReason}</Text>
                  {order.voidedAt ? (
                    <Text style={s.voidSub}>
                      เมื่อ {thaiDateTime(order.voidedAt)} · ทำรายการโดย {order.voidedBy ?? '-'} · ผู้อนุมัติ {order.voidApprover ?? '-'} · บิลยังเก็บไว้ในระบบ (ไม่ถูกลบ)
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
            {locked && !isVoid ? (
              <Text style={s.lockNote}>สาขานี้จด VAT — บิลที่ออกแล้วแก้ไขไม่ได้ คืนสินค้าใช้ "คืนสินค้า / ใบลดหนี้" (ยกเลิกทั้งบิลได้เฉพาะเดือนเดียวกัน)</Text>
            ) : null}

            <View style={s.meta}>
              <Meta label="วันที่ขาย" value={thaiDateTime(order.createdAt ?? '')} />
              <Meta label="ลูกค้า" value={order.customerName || 'ลูกค้าทั่วไป'} />
              <Meta label="พนักงานขาย" value={order.salesperson?.replace('พนักงาน: ', '') || '—'} />
              <Meta label="ประเภท" value={order.orderType} />
              <Meta label="ชำระโดย" value={PAYMENT_LABEL[order.paymentMethod]} />
              {order.terminal ? <Meta label="เครื่อง POS" value={`${order.terminal.code}${order.terminal.rdNo ? ` · ${order.terminal.rdNo}` : ''}`} /> : null}
              <View style={s.metaCell}>
                <Text style={s.metaLabel}>สถานะ</Text>
                <View style={{ alignItems: 'flex-start', marginTop: 3 }}>
                  <Badge status={order.status} edits={order.editCount} />
                </View>
              </View>
            </View>

            <Text style={s.section}>รายการสินค้า</Text>
            {order.items.map((it, i) => (
              <View key={i} style={s.item}>
                <View style={s.thumb}>
                  <GarmentArt art={it.art ?? 'tshirt'} color={it.colorHex ?? '#ccc'} size={38} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.itemName, isVoid && s.strike]} numberOfLines={1}>{it.name}</Text>
                  <Text style={s.itemSub}>
                    {variantLabel(it)} · {it.qty} × {baht(it.unitPrice)}{it.vatExempt ? ' · ยกเว้น VAT' : ''}
                  </Text>
                </View>
                <Text style={[s.itemTotal, isVoid && s.strike]}>{baht(it.lineTotal)}</Text>
              </View>
            ))}

            <View style={s.totals}>
              <Row l="รวม" r={baht(order.subtotal)} />
              {order.discount > 0 ? <Row l={`ส่วนลด (${order.promoCode})`} r={`−${baht(order.discount)}`} green /> : null}
              {order.fee ? (
                order.feePayer === 'customer' ? (
                  <Row l={`ค่าธรรมเนียม${PAYMENT_LABEL[order.paymentMethod] ?? ''}`} r={`+${baht(order.fee)}`} />
                ) : (
                  <Row l={`ค่าธรรมเนียม${PAYMENT_LABEL[order.paymentMethod] ?? ''} (ร้านจ่าย)`} r={baht(order.fee)} small />
                )
              ) : null}
              {order.vat > 0 && order.vatBase != null ? <Row l="ฐานภาษี (มูลค่าที่เสีย VAT)" r={baht(order.vatBase)} small /> : null}
              {order.vat > 0 ? <Row l={vatLabel(order)} r={baht(order.vat)} small /> : null}
              {(order.exemptAmount ?? 0) > 0 ? <Row l="มูลค่าสินค้ายกเว้น VAT" r={baht(order.exemptAmount!)} small /> : null}
              <View style={s.grand}>
                <Text style={s.grandL}>ยอดสุทธิ</Text>
                <Text style={[s.grandR, isVoid && s.strike]}>{baht(order.total)}</Text>
              </View>
            </View>

            {order.taxInvoices?.length || credits.length ? (
              <>
                <Text style={s.section}>เอกสารภาษี</Text>
                {(order.taxInvoices ?? []).map((t) => (
                  <View key={`t${t.id}`} style={s.doc}>
                    <Icon name="document-text-outline" size={18} color={t.status === 'active' ? colors.primary : colors.faint} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.docHead, t.status === 'cancelled' && s.strike]}>ใบกำกับภาษีเต็มรูป {t.docNo}</Text>
                      <Text style={s.editText} numberOfLines={2}>
                        {t.buyerName} · เลขผู้เสียภาษี {t.buyerTaxId} · {thaiDateTime(t.issuedAt)}
                        {t.status === 'cancelled' ? ` · ยกเลิกแล้ว: ${t.cancelReason ?? ''}` : ''}
                      </Text>
                    </View>
                    <Pressable style={s.docBtn} onPress={() => openTiv(t.id)} accessibilityLabel={`พิมพ์ ${t.docNo}`}>
                      <Icon name="print-outline" size={16} color={colors.text} />
                    </Pressable>
                    {t.status === 'active' ? (
                      <Pressable style={s.docBtn} onPress={() => cancelTiv(t.id, t.docNo)} accessibilityLabel={`ยกเลิก ${t.docNo}`}>
                        <Icon name="close-circle-outline" size={16} color={colors.danger} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {credits.map((c) => (
                  <View key={`c${c.id}`} style={s.doc}>
                    <Icon name="return-down-back-outline" size={18} color={colors.danger} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.docHead}>ใบลดหนี้ {c.docNo} · คืนเงิน {baht(c.total)}</Text>
                      <Text style={s.editText} numberOfLines={2}>
                        {c.items.map((i) => `${i.name} × ${i.qty}`).join(', ')} · {c.reason} · {thaiDateTime(c.issuedAt)} · อนุมัติ {c.approver}
                      </Text>
                    </View>
                    <Pressable style={s.docBtn} onPress={() => openCn(c.id)} accessibilityLabel={`พิมพ์ ${c.docNo}`}>
                      <Icon name="print-outline" size={16} color={colors.text} />
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}

            {order.edits.length > 0 ? (
              <>
                <Text style={s.section}>ประวัติการแก้ไข ({order.edits.length})</Text>
                {order.edits.map((e) => (
                  <View key={e.id} style={s.edit}>
                    <View style={[s.editDot, { backgroundColor: e.kind === 'void' ? colors.danger : e.kind === 'credit' ? colors.primary : '#E0A23B' }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.editHead}>
                        {e.kind === 'void' ? 'ยกเลิกบิล' : e.kind === 'credit' ? 'ใบลดหนี้ (คืนสินค้า)' : 'แก้ไขบิล'} · {thaiDateTime(e.editedAt)} · {e.staff.replace('พนักงาน: ', '')}
                      </Text>
                      <Text style={s.editText}>เหตุผล: {e.reason}</Text>
                      <Text style={s.editText}>{e.summary}</Text>
                      <Text style={s.editText}>
                        {baht(e.oldTotal)} → {baht(e.newTotal)}
                        {e.diff !== 0 ? (
                          <Text style={{ color: e.diff > 0 ? colors.primary : colors.danger, fontWeight: '600' }}>
                            {'  '}
                            {e.diff > 0 ? `เก็บเพิ่ม ${baht(e.diff)}` : `คืนเงิน ${baht(-e.diff)}`}
                            {e.settleMethod ? ` (${PAYMENT_LABEL[e.settleMethod]})` : ''}
                          </Text>
                        ) : null}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        ) : null}
      </Sheet>

      {order && catalog ? (
        <BillEditor
          visible={editing}
          order={order}
          catalog={catalog}
          notify={notify}
          onClose={() => setEditing(false)}
          onSaved={(o) => {
            setEditing(false);
            setOrder(o);
            onChanged();
          }}
        />
      ) : null}
      {order ? (
        <TaxInvoiceDialog
          visible={issuing}
          order={order}
          notify={notify}
          onClose={() => setIssuing(false)}
          onDone={() => {
            setIssuing(false);
            refresh();
          }}
        />
      ) : null}
      {order ? (
        <CreditNoteDialog
          visible={crediting}
          order={order}
          notify={notify}
          onClose={() => setCrediting(false)}
          onDone={() => {
            setCrediting(false);
            refresh();
          }}
        />
      ) : null}
      {order ? (
        <VoidDialog
          visible={voiding}
          order={order}
          notify={notify}
          onClose={() => setVoiding(false)}
          onDone={(o) => {
            setVoiding(false);
            setOrder(o);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Row({ l, r, small, green }: { l: string; r: string; small?: boolean; green?: boolean }) {
  const st = [small ? s.small : s.rowText, green && { color: colors.success }];
  return (
    <View style={s.row}>
      <Text style={st}>{l}</Text>
      <Text style={st}>{r}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  error: { fontFamily: font, color: colors.danger, textAlign: 'center', marginVertical: 20 },
  voidBanner: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.dangerSoft, padding: 12, borderRadius: radius.md, marginBottom: 10 },
  voidSub: { fontFamily: font, fontSize: 11.5, color: colors.danger, marginTop: 2, opacity: 0.85 },
  lockNote: { fontFamily: font, fontSize: 12, color: '#B26A00', backgroundColor: '#FFF4E0', padding: 8, borderRadius: radius.md, marginBottom: 8 },
  voidText: { fontFamily: font, color: colors.danger, fontSize: 13, flex: 1 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.surface, borderRadius: radius.md, padding: 6 },
  metaCell: { width: '33.33%', minWidth: 140, flexGrow: 1, padding: 8 },
  metaLabel: { fontFamily: font, fontSize: 11, color: colors.sub },
  metaValue: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500', marginTop: 2 },
  section: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 16, marginBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  thumb: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  itemName: { fontFamily: font, fontSize: 13, fontWeight: '500', color: colors.text },
  itemSub: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 2 },
  itemTotal: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  strike: { textDecorationLine: 'line-through', color: colors.faint },
  totals: { paddingTop: 10, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowText: { fontFamily: font, fontSize: 13, color: colors.text },
  small: { fontFamily: font, fontSize: 11, color: colors.faint },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 },
  grandL: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  grandR: { fontFamily: font, fontSize: 18, fontWeight: '700', color: colors.text },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  docHead: { fontFamily: font, fontSize: 12.5, fontWeight: '600', color: colors.text },
  docBtn: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  edit: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  editDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  editHead: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text },
  editText: { fontFamily: font, fontSize: 12, color: colors.sub, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flexGrow: 1, height: 48, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  ghost: { borderWidth: 1.5, borderColor: colors.line },
  ghostText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  danger: { borderWidth: 1.5, borderColor: '#F3C4C6' },
  dangerText: { fontFamily: font, fontSize: 13, color: colors.danger, fontWeight: '500' },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
