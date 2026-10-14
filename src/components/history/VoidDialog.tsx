import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { baht, PAYMENT_LABEL } from '../../format';
import type { Toast } from '../../store/usePos';
import { colors, font, radius } from '../../theme';
import type { OrderDetail, PaymentMethod } from '../../types';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { Chips, FieldLabel } from './Chips';

const REASONS = ['ลูกค้าคืนสินค้าทั้งหมด', 'คิดเงินผิด', 'ทดสอบระบบ', 'ลูกค้ายกเลิกการซื้อ'];
const METHODS: PaymentMethod[] = ['cash', 'promptpay', 'card', 'transfer'];

interface Props {
  visible: boolean;
  order: OrderDetail;
  onClose: () => void;
  onDone: (o: OrderDetail) => void;
  notify: (kind: Toast['kind'], text: string) => void;
}

/** ยกเลิกทั้งบิล: คืนสินค้าเข้าสต็อก + บันทึกการคืนเงิน */
export function VoidDialog({ visible, order, onClose, onDone, notify }: Props) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(order.paymentMethod);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPin('');
      setReason('');
      setMethod(order.paymentMethod);
      setError(null);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.voidOrder(order.id, { pin, reason, refundMethod: method });
      notify('success', `ยกเลิกบิล ${order.orderNo} แล้ว · คืนเงิน ${baht(order.total)}`);
      onDone(res.order);
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const ready = /^\d{6}$/.test(pin) && reason.trim().length > 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="ยกเลิกบิล"
      width={460}
      footer={
        <Pressable style={[s.btn, !ready && { opacity: 0.45 }]} disabled={!ready || busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>ยืนยันยกเลิกบิล · คืนเงิน {baht(order.total)}</Text>}
        </Pressable>
      }
    >
      <View style={s.warn}>
        <Icon name="warning-outline" size={18} color={colors.danger} />
        <Text style={s.warnText}>
          สินค้าทั้งหมดในบิล {order.orderNo} จะถูกคืนเข้าสต็อก และบิลจะไม่นับเป็นยอดขาย (ย้อนกลับไม่ได้)
        </Text>
      </View>

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
        accessibilityLabel="PIN ยืนยันการยกเลิกบิล"
        onSubmitEditing={() => ready && submit()}
      />
      <Text style={s.pinHint}>ใช้ PIN ของพนักงานที่มีสิทธิ์ยกเลิกบิล (หรือ PIN ผู้จัดการ) — ระบบบันทึกชื่อเจ้าของ PIN เป็นผู้อนุมัติ</Text>

      {error ? <Text style={s.error}>{error}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  warn: { flexDirection: 'row', gap: 8, backgroundColor: colors.dangerSoft, padding: 12, borderRadius: radius.md },
  warnText: { fontFamily: font, fontSize: 13, color: colors.danger, flex: 1, lineHeight: 20 },
  input: { fontFamily: font, fontSize: 13, color: colors.text, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12, marginTop: 8 },
  pin: { fontFamily: font, fontSize: 26, letterSpacing: 10, textAlign: 'center', color: colors.text, height: 56, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: '#F3C4C6' },
  pinHint: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 6, lineHeight: 16 },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 12 },
  btn: { height: 50, borderRadius: radius.md, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
