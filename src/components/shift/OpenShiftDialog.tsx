import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { useAppSettings } from '../../appSettings';
import { baht } from '../../format';
import { useSession } from '../../session';
import { colors, font, radius } from '../../theme';
import type { Shift } from '../../types';
import { FieldLabel } from '../history/Chips';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { CashCounter } from './CashCounter';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpened: (s: Shift) => void;
  /** ข้อความเพิ่มเติม (เช่น เปิดจากหน้าขาย) */
  hint?: string;
  /** เด้งอัตโนมัติหลังเข้าสู่ระบบ → มีปุ่ม "ข้ามไปก่อน" */
  onSkip?: () => void;
}

export function OpenShiftDialog({ visible, onClose, onOpened, hint, onSkip }: Props) {
  const { me } = useSession();
  // ตั้งค่า "บังคับแจกแจงจำนวนเงิน" → ต้องนับเงินจริง (ไม่ใช้ยอดจากปิดกะล่าสุด)
  const forced = !!useAppSettings().payments.requireDenominations;
  const [cash, setCash] = useState<number | null>(null);
  const [denoms, setDenoms] = useState<Record<string, number> | null>(null);
  const [note, setNote] = useState('');
  const [suggest, setSuggest] = useState<number | null>(null);
  const [useSuggest, setUseSuggest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setCash(null);
    setDenoms(null);
    setNote('');
    setError(null);
    setUseSuggest(false);
    setKey((k) => k + 1);
    api.currentShift().then((r) => setSuggest(r.shift ? null : r.suggestOpening ?? null)).catch(() => setSuggest(null));
  }, [visible]);

  const amount = useSuggest ? suggest : cash;
  const ready = amount != null && amount >= 0;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.openShift({ staff: me.name, openingCash: amount!, note: note || undefined, denominations: useSuggest ? undefined : denoms ?? undefined });
      onOpened(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onSkip ?? onClose}
      title={onSkip ? 'เริ่มกะการทำงาน' : 'เปิดกะการขาย'}
      width={640}
      footer={
        <View style={{ flexDirection: 'row', gap: 8, flex: 1 }}>
          {onSkip ? (
            <Pressable style={[s.btn, s.ghost]} onPress={onSkip} accessibilityLabel="ข้ามไปก่อน">
              <Text style={s.ghostText}>ข้ามไปก่อน</Text>
            </Pressable>
          ) : null}
          <Pressable style={[s.btn, { flex: 2 }, !ready && { opacity: 0.45 }]} disabled={!ready || busy} onPress={submit}>
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Icon name="lock-open-outline" size={18} color="#fff" />
                <Text style={s.btnText}>เปิดกะ · เงินตั้งต้น {baht(amount ?? 0)}</Text>
              </>
            )}
          </Pressable>
        </View>
      }
    >
      <ScrollView style={{ maxHeight: 600 }} contentContainerStyle={{ gap: 10 }}>
        {onSkip ? (
          <View style={s.welcome}>
            <View style={s.welcomeIcon}><Icon name="sunny-outline" size={22} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.welcomeTitle}>สวัสดี {me.name}</Text>
              <Text style={s.hintText}>ยังไม่ได้เปิดกะวันนี้ — แจงเงินทอนตั้งต้นในลิ้นชักก่อนเริ่มขาย</Text>
            </View>
          </View>
        ) : hint ? (
          <View style={s.hint}>
            <Icon name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={s.hintText}>{hint}</Text>
          </View>
        ) : (
          <View style={s.byMe}>
            <Icon name="person-circle-outline" size={18} color={colors.primary} />
            <Text style={s.byMeText}>ผู้เปิดกะ: {me.name}</Text>
          </View>
        )}

        {suggest != null && suggest > 0 && !forced ? (
          <Pressable style={[s.suggest, useSuggest && s.suggestOn]} onPress={() => setUseSuggest((v) => !v)}>
            <Icon name={useSuggest ? 'checkbox' : 'square-outline'} size={18} color={useSuggest ? colors.primary : colors.sub} />
            <Text style={s.suggestText}>ใช้ยอดที่นับได้ตอนปิดกะล่าสุด</Text>
            <Text style={s.suggestAmt}>{baht(suggest)}</Text>
          </Pressable>
        ) : null}
        {!useSuggest ? (
          <CashCounter
            key={key}
            total=""
            autoFocus
            forceCount={forced}
            onChange={(t, d) => {
              setCash(t);
              setDenoms(d);
            }}
          />
        ) : null}

        <View>
          <FieldLabel>หมายเหตุ</FieldLabel>
          <TextInput value={note} onChangeText={setNote} placeholder="เช่น รับเงินทอนจากผู้จัดการ" placeholderTextColor={colors.faint} style={s.input} maxLength={200} />
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  hint: { flexDirection: 'row', gap: 8, backgroundColor: colors.primarySoft, padding: 12, borderRadius: radius.md },
  hintText: { fontFamily: font, fontSize: 13, color: colors.primary, flex: 1, lineHeight: 20 },
  byMe: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  byMeText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.primary },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  suggestOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  suggestText: { fontFamily: font, fontSize: 13, color: colors.text, flex: 1 },
  suggestAmt: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text },
  input: { fontFamily: font, fontSize: 13, color: colors.text, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 12 },
  btn: { flex: 1, height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  ghost: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.line },
  ghostText: { fontFamily: font, fontSize: 14, color: colors.text, fontWeight: '500' },
  welcome: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primarySoft, padding: 12, borderRadius: radius.md },
  welcomeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  welcomeTitle: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  btnText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
