import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { baht, moneyInput } from '../../format';
import { useSession } from '../../session';
import { colors, font, radius } from '../../theme';
import type { Shift } from '../../types';
import { Chips, FieldLabel } from '../history/Chips';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';

const REASONS = {
  in: ['เติมเงินทอน', 'แลกเหรียญ', 'รับเงินคืนจากเจ้าของ'],
  out: ['ค่าส่งของ', 'ซื้อของใช้ในร้าน', 'นำเงินฝากธนาคาร', 'เจ้าของเบิกเงิน'],
};

interface Props {
  visible: boolean;
  kind: 'in' | 'out';
  onClose: () => void;
  onDone: (s: Shift) => void;
}

/** นำเงินเข้า / นำเงินออกจากลิ้นชักระหว่างกะ */
export function CashMoveDialog({ visible, kind: initialKind, onClose, onDone }: Props) {
  const { me } = useSession();
  const [kind, setKind] = useState<'in' | 'out'>(initialKind);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setKind(initialKind);
    setAmount('');
    setReason('');
    setError(null);
  }, [visible, initialKind]);

  const n = Number(amount);
  const ready = n > 0 && reason.trim().length > 0;
  const tone = kind === 'in' ? colors.success : colors.danger;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.cashMove({ kind, amount: n, reason, staff: me.name });
      onDone(r.shift);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="นำเงินเข้า / ออกลิ้นชัก"
      width={460}
      footer={
        <Pressable style={[s.btn, { backgroundColor: tone }, !ready && { opacity: 0.45 }]} disabled={!ready || busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{kind === 'in' ? 'บันทึกนำเงินเข้า' : 'บันทึกนำเงินออก'} {n > 0 ? baht(n) : ''}</Text>}
        </Pressable>
      }
    >
      <View style={s.seg}>
        {(['in', 'out'] as const).map((k) => (
          <Pressable key={k} style={[s.segBtn, kind === k && { backgroundColor: k === 'in' ? colors.success : colors.danger }]} onPress={() => { setKind(k); setReason(''); }}>
            <Icon name={k === 'in' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'} size={18} color={kind === k ? '#fff' : colors.text} />
            <Text style={[s.segText, kind === k && { color: '#fff', fontWeight: '600' }]}>{k === 'in' ? 'นำเงินเข้า' : 'นำเงินออก'}</Text>
          </Pressable>
        ))}
      </View>

      <FieldLabel required>จำนวนเงิน</FieldLabel>
      <TextInput
        value={amount}
        onChangeText={(t) => setAmount((c) => moneyInput(t, c))}
        placeholder="0.00"
        placeholderTextColor={colors.faint}
        keyboardType="decimal-pad"
        style={s.bigInput}
        autoFocus
      />

      <FieldLabel required>เหตุผล</FieldLabel>
      <Chips options={REASONS[kind].map((r) => ({ value: r, label: r }))} value={REASONS[kind].includes(reason) ? reason : null} onChange={setReason} tone={tone} />
      <TextInput value={reason} onChangeText={setReason} placeholder="หรือพิมพ์เหตุผล…" placeholderTextColor={colors.faint} style={s.input} maxLength={200} />

      <FieldLabel>ผู้ทำรายการ</FieldLabel>
      <View style={s.byMe}>
        <Icon name="person-circle-outline" size={18} color={colors.primary} />
        <Text style={s.byMeText}>{me.name}</Text>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segText: { fontFamily: font, fontSize: 14, color: colors.text },
  bigInput: { fontFamily: font, fontSize: 24, fontWeight: '600', color: colors.text, height: 56, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 16, textAlign: 'right' },
  input: { fontFamily: font, fontSize: 13, color: colors.text, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12, marginTop: 8 },
  byMe: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  byMeText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.primary },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 12 },
  btn: { height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
