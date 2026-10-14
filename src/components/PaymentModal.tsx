import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { baht, bahtShort, MONEY_RE, moneyInput, PAYMENT_LABEL } from '../format';
import { colors, font, radius } from '../theme';
import type { PaymentMethod } from '../types';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { feeOf, useAppSettings } from '../appSettings';

const METHODS: { id: PaymentMethod; icon: IconName }[] = [
  { id: 'cash', icon: 'cash-outline' },
  { id: 'promptpay', icon: 'qr-code-outline' },
  { id: 'card', icon: 'card-outline' },
  { id: 'transfer', icon: 'swap-horizontal-outline' },
];

interface Props {
  visible: boolean;
  total: number;
  initial: { method: PaymentMethod; cashReceived?: number } | null;
  /** checkout = ยืนยันแล้วบันทึกการขายทันที */
  mode: 'select' | 'checkout';
  onClose: () => void;
  onConfirm: (p: { method: PaymentMethod; cashReceived?: number }) => void;
}

export function PaymentModal({ visible, total: base, initial, mode, onClose, onConfirm }: Props) {
  const settings = useAppSettings();
  // ตั้งค่า → วิธีชำระเงิน: แสดงเฉพาะที่เปิดใช้ ตามลำดับที่ตั้งไว้
  const methods = settings.payments.methods.filter((m) => m.enabled).map((m) => ({ ...m, icon: METHODS.find((x) => x.id === m.id)!.icon }));
  const firstId = methods[0]?.id ?? 'cash';
  const [method, setMethod] = useState<PaymentMethod>(firstId);
  const [cash, setCash] = useState('');
  const cfg = methods.find((m) => m.id === method);
  // ค่าธรรมเนียมของวิธีที่เลือก — ถ้าลูกค้าจ่าย บวกเพิ่มในยอดที่ต้องชำระ
  const fee = feeOf(method, base);
  const total = Math.round((base + (fee?.customer ? fee.fee : 0)) * 100) / 100;

  useEffect(() => {
    if (visible) {
      setMethod(initial?.method && methods.some((m) => m.id === initial.method) ? initial.method : firstId);
      setCash(initial?.cashReceived ? String(initial.cashReceived) : '');
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const quick = useMemo(() => {
    const set = new Set<number>([total]);
    for (const step of [100, 500, 1000]) set.add(Math.ceil(total / step) * step);
    return Array.from(set).filter((n) => n > 0).sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  const received = cash === '' ? total : MONEY_RE.test(cash) && cash !== '.' ? Number(cash) : NaN;
  const change = received - total;
  const valid = method !== 'cash' || (Number.isFinite(received) && change >= 0);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="ชำระเงิน"
      width={480}
      footer={
        <Pressable
          style={[s.confirm, !valid && { backgroundColor: '#9DB7F7' }]}
          disabled={!valid}
          onPress={() => onConfirm({ method, cashReceived: method === 'cash' ? received : undefined })}
        >
          <Text style={s.confirmText}>{mode === 'checkout' ? `ยืนยันรับชำระ ${baht(total)}` : 'บันทึกวิธีชำระเงิน'}</Text>
        </Pressable>
      }
    >
      <View style={s.totalBox}>
        <Text style={s.totalLabel}>ยอดที่ต้องชำระ</Text>
        <Text style={s.totalVal}>{baht(total)}</Text>
        {fee?.customer ? (
          <Text style={s.feeBreak}>
            สินค้า {baht(base)} + ค่าธรรมเนียม{fee.label} {fee.rule} {baht(fee.fee)}
          </Text>
        ) : null}
      </View>

      <View style={s.grid}>
        {methods.map((m) => {
          const on = m.id === method;
          return (
            <Pressable key={m.id} style={[s.method, on && s.methodOn]} onPress={() => setMethod(m.id)}>
              <Icon name={m.icon} size={22} color={on ? colors.primary : colors.sub} />
              <Text style={[s.methodText, on && { color: colors.primary, fontWeight: '600' }]} numberOfLines={1}>{m.label || PAYMENT_LABEL[m.id]}</Text>
            </Pressable>
          );
        })}
      </View>

      {method === 'cash' ? (
        <View style={{ marginTop: 14 }}>
          <Text style={s.label}>รับเงินมา</Text>
          <TextInput
            value={cash}
            onChangeText={(t) => setCash((c) => moneyInput(t, c))}
            placeholder={total.toFixed(2)}
            placeholderTextColor={colors.faint}
            keyboardType="decimal-pad"
            style={s.input}
            autoFocus
          />
          <View style={s.quickRow}>
            {quick.map((q) => (
              <Pressable key={q} style={s.quick} onPress={() => setCash(String(q))}>
                <Text style={s.quickText}>{q === total ? 'พอดี' : bahtShort(q)}</Text>
              </Pressable>
            ))}
          </View>
          {!Number.isFinite(received) ? (
            <View style={[s.changeBox, { backgroundColor: colors.dangerSoft }]}>
              <Text style={[s.changeLabel, { color: colors.danger }]}>จำนวนเงินไม่ถูกต้อง</Text>
              <Text style={[s.changeVal, { color: colors.danger, fontSize: 13 }]}>ใช้รูปแบบ บาท.สตางค์ เช่น 500.50</Text>
            </View>
          ) : (
            <View style={[s.changeBox, change < 0 && { backgroundColor: colors.dangerSoft }]}>
              <Text style={[s.changeLabel, change < 0 && { color: colors.danger }]}>{change < 0 ? 'ยังขาดอีก' : 'เงินทอน'}</Text>
              <Text style={[s.changeVal, change < 0 && { color: colors.danger }]}>{baht(Math.abs(change || 0))}</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={s.note}>
          <Icon name="information-circle-outline" size={18} color={colors.sub} />
          <Text style={s.noteText}>
            {method === 'promptpay'
              ? `ให้ลูกค้าสแกน QR พร้อมเพย์ของร้าน${settings.payments.promptpayId ? ` (${settings.payments.promptpayId})` : ''} แล้วกดยืนยันเมื่อได้รับยอดโอน`
              : method === 'card'
                ? 'รูดบัตรที่เครื่อง EDC แล้วกดยืนยันเมื่อรายการผ่าน'
                : 'ตรวจสอบสลิปโอนเงินของลูกค้าก่อนกดยืนยัน'}
          </Text>
        </View>
      )}
      {fee && !fee.customer ? (
        <Text style={s.feeText}>ค่าธรรมเนียม{fee.label} {fee.rule} = {baht(fee.fee)} (ร้านเป็นผู้จ่าย · ลูกค้าจ่ายเท่าเดิม)</Text>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  feeBreak: { fontFamily: font, fontSize: 12, color: colors.primary, marginTop: 4, textAlign: 'center' },
  feeText: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 10, textAlign: 'center' },
  totalBox: { backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 16, alignItems: 'center', marginBottom: 14 },
  totalLabel: { fontFamily: font, fontSize: 12, color: colors.primary },
  totalVal: { fontFamily: font, fontSize: 28, fontWeight: '700', color: colors.primary, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  method: {
    flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line,
  },
  methodOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  methodText: { fontFamily: font, fontSize: 13, color: colors.text },
  label: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: {
    fontFamily: font, fontSize: 22, fontWeight: '600', color: colors.text, height: 54, borderRadius: radius.md,
    backgroundColor: colors.surface, paddingHorizontal: 16, textAlign: 'right',
  },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quick: { flex: 1, height: 38, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  quickText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  changeBox: {
    marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.successSoft, borderRadius: radius.md, padding: 14,
  },
  changeLabel: { fontFamily: font, fontSize: 14, color: colors.success, fontWeight: '600' },
  changeVal: { fontFamily: font, fontSize: 20, color: colors.success, fontWeight: '700' },
  note: { flexDirection: 'row', gap: 8, marginTop: 14, backgroundColor: colors.surface, padding: 14, borderRadius: radius.md },
  noteText: { fontFamily: font, fontSize: 13, color: colors.sub, flex: 1, lineHeight: 20 },
  confirm: { height: 54, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontFamily: font, fontSize: 16, color: '#fff', fontWeight: '600' },
});
