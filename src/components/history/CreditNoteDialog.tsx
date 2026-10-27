// รับคืนสินค้า → ออกใบลดหนี้ (บิลที่คิด VAT): เลือกสินค้า/จำนวนที่คืน · คืนสต็อก · คืนเงินในกะ · ยืนยันด้วย PIN
// บิลเดิมไม่เปลี่ยน — VAT ของใบลดหนี้ไปหักภาษีขายในเดือนที่ออกใบลดหนี้ (รายงานภาษีขาย)
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { baht, PAYMENT_LABEL, variantLabel } from '../../format';
import { printTaxDoc } from '../../print';
import type { Toast } from '../../store/usePos';
import { colors, font, radius } from '../../theme';
import type { OrderDetail, PaymentMethod } from '../../types';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { Chips, FieldLabel } from './Chips';

const REASONS = ['สินค้าชำรุด', 'ไซซ์ไม่พอดี', 'ลูกค้าเปลี่ยนใจ', 'ได้สินค้าผิด'];
const METHODS: PaymentMethod[] = ['cash', 'promptpay', 'card', 'transfer'];

interface Props {
  visible: boolean;
  order: OrderDetail;
  onClose: () => void;
  onDone: () => void;
  notify: (kind: Toast['kind'], text: string) => void;
}

export function CreditNoteDialog({ visible, order, onClose, onDone, notify }: Props) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(order.paymentMethod);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setQty({});
      setReason('');
      setMethod(order.paymentMethod);
      setPin('');
      setError(null);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // จำนวนที่ยังคืนได้ต่อรายการ
  const lines = order.items
    .filter((i) => i.itemId != null)
    .map((i) => ({ ...i, left: i.qty - (order.returned?.[String(i.itemId)] ?? 0) }));
  // ยอดคืนโดยประมาณ (เซิร์ฟเวอร์คำนวณจริง: หักส่วนลดท้ายบิลตามสัดส่วน)
  const estimate = useMemo(() => {
    const gross = lines.reduce((s, l) => s + (qty[l.itemId!] ?? 0) * l.unitPrice, 0);
    const factor = order.subtotal > 0 ? (order.subtotal - order.discount) / order.subtotal : 1;
    return Math.round(gross * factor * 100) / 100;
  }, [qty, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = Object.values(qty).some((n) => n > 0);
  const ready = picked && reason.trim().length > 0 && /^\d{6}$/.test(pin);

  const step = (id: number, max: number, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, (q[id] ?? 0) + d)) }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc = await api.creditNote(order.id, {
        pin,
        reason: reason.trim(),
        refundMethod: method,
        items: Object.entries(qty).filter(([, n]) => n > 0).map(([id, n]) => ({ itemId: Number(id), qty: n })),
      });
      notify('success', `ออกใบลดหนี้ ${doc.docNo} แล้ว · คืนเงิน ${baht(doc.total)}`);
      printTaxDoc({ kind: 'credit', doc });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="คืนสินค้า / ออกใบลดหนี้"
      width={520}
      footer={
        <Pressable style={[s.btn, !ready && { opacity: 0.45 }]} disabled={!ready || busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>ออกใบลดหนี้ · คืนเงิน ~{baht(estimate)}</Text>}
        </Pressable>
      }
    >
      <View style={s.info}>
        <Icon name="information-circle-outline" size={18} color={colors.primary} />
        <Text style={s.infoText}>
          บิล {order.orderNo} ไม่ถูกแก้ไข — ระบบออกใบลดหนี้ (CN-…) คืนสินค้าเข้าสต็อก และหัก VAT ในเดือนนี้ · คืนได้หลายครั้งจนครบจำนวนที่ซื้อ
        </Text>
      </View>

      <FieldLabel required>สินค้าที่รับคืน</FieldLabel>
      {lines.map((l) => {
        const n = qty[l.itemId!] ?? 0;
        return (
          <View key={l.itemId} style={[s.row, l.left <= 0 && { opacity: 0.4 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name} numberOfLines={1}>{l.name}</Text>
              <Text style={s.sub}>
                {variantLabel(l)} · {baht(l.unitPrice)} · ซื้อ {l.qty} · {l.left > 0 ? `คืนได้อีก ${l.left}` : 'คืนครบแล้ว'}
              </Text>
            </View>
            <View style={s.stepper}>
              <Pressable style={s.stepBtn} onPress={() => step(l.itemId!, l.left, -1)} disabled={n <= 0} accessibilityLabel="ลดจำนวน">
                <Text style={s.stepText}>−</Text>
              </Pressable>
              <Text style={s.qty}>{n}</Text>
              <Pressable style={s.stepBtn} onPress={() => step(l.itemId!, l.left, 1)} disabled={n >= l.left} accessibilityLabel="เพิ่มจำนวน">
                <Text style={s.stepText}>+</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <FieldLabel required>เหตุผล</FieldLabel>
      <Chips options={REASONS.map((r) => ({ value: r, label: r }))} value={REASONS.includes(reason) ? reason : null} onChange={setReason} />
      <TextInput value={reason} onChangeText={setReason} placeholder="หรือพิมพ์เหตุผล…" placeholderTextColor={colors.faint} style={s.input} maxLength={200} />

      <FieldLabel>คืนเงินโดย</FieldLabel>
      <Chips options={METHODS.map((m) => ({ value: m, label: PAYMENT_LABEL[m] }))} value={method} onChange={setMethod} />

      <FieldLabel required>ยืนยันด้วย PIN 6 หลัก</FieldLabel>
      <TextInput
        value={pin}
        onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
        placeholder="••••••"
        placeholderTextColor={colors.faint}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={6}
        style={s.pin}
        accessibilityLabel="PIN ยืนยันการคืนสินค้า"
        onSubmitEditing={() => ready && submit()}
      />
      <Text style={s.hint}>ใช้ PIN ของพนักงานที่มีสิทธิ์ยกเลิกบิล (หรือ PIN ผู้จัดการ) — ระบบบันทึกเป็นผู้อนุมัติ</Text>

      {error ? <Text style={s.error}>{error}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  info: { flexDirection: 'row', gap: 8, backgroundColor: colors.primarySoft, padding: 12, borderRadius: radius.md },
  infoText: { fontFamily: font, fontSize: 12.5, color: colors.text, flex: 1, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  name: { fontFamily: font, fontSize: 13, fontWeight: '500', color: colors.text },
  sub: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: font, fontSize: 18, color: colors.text, fontWeight: '600' },
  qty: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text, minWidth: 24, textAlign: 'center' },
  input: { fontFamily: font, fontSize: 13, color: colors.text, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12, marginTop: 8 },
  pin: { fontFamily: font, fontSize: 26, letterSpacing: 10, textAlign: 'center', color: colors.text, height: 56, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  hint: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 6, lineHeight: 16 },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 12 },
  btn: { height: 50, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
