import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api } from '../../api';
import { baht, duration, PAYMENT_LABEL, VERDICT } from '../../format';
import { openPrintWindow, printDaySummary } from '../../print';
import { useSession } from '../../session';
import { colors, font, radius } from '../../theme';
import type { PaymentMethod, Shift } from '../../types';
import { FieldLabel } from '../history/Chips';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { CashCounter } from './CashCounter';

interface Props {
  visible: boolean;
  shift: Shift;
  onClose: () => void;
  onClosed: (s: Shift) => void;
  /** แสดงปุ่ม "ออกจากระบบ" หลังปิดกะ (ใช้จากหน้าขาย) */
  onLogout?: () => void;
}

/** ปิดกะ: นับเงินจริงในลิ้นชัก → เทียบกับยอดที่ควรมี → แจ้งผล */
export function CloseShiftDialog({ visible, shift, onClose, onClosed, onLogout }: Props) {
  const { me } = useSession();
  const { width } = useWindowDimensions();
  const twoCol = width >= 900;
  const [counted, setCounted] = useState<number | null>(null);
  const [denoms, setDenoms] = useState<Record<string, number> | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Shift | null>(null);
  const [key, setKey] = useState(0);
  const [step, setStep] = useState<'count' | 'confirm'>('count');
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCounted(null);
    setDenoms(null);
    setNote('');
    setError(null);
    setResult(null);
    setStep('count');
    setKey((k) => k + 1);
  }, [visible]);

  const diff = counted == null ? null : Math.round((counted - shift.expectedCash) * 100) / 100;
  const v = diff == null ? null : VERDICT[diff === 0 ? 'match' : diff > 0 ? 'over' : 'short'];
  const ready = counted != null && (diff === 0 || note.trim().length > 0);

  /** พิมพ์สรุปยอดของวันนี้ (หน้าต่างพิมพ์ต้องเปิดตอนกดปุ่ม) */
  const printDay = async (closed: Shift, win?: Window | null) => {
    const w = win ?? openPrintWindow();
    setPrinting(true);
    try {
      printDaySummary(await api.daySummary(closed.businessDate), closed, w);
    } catch (e) {
      w?.close();
      setError(`พิมพ์ไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setPrinting(false);
    }
  };

  const submit = async (print: boolean) => {
    setBusy(true);
    setError(null);
    const win = print ? openPrintWindow() : null;
    try {
      const s = await api.closeShift({ staff: me.name, countedCash: counted!, note: note || undefined, denominations: denoms ?? undefined });
      setResult(s);
      if (print) await printDay(s, win);
    } catch (e) {
      win?.close();
      setError((e as Error).message);
      setStep('count');
    } finally {
      setBusy(false);
    }
  };

  // ---------- ยืนยัน + ถามพิมพ์สรุปยอด ----------
  if (step === 'confirm' && !result && counted != null && v) {
    return (
      <Sheet visible={visible} onClose={onClose} title={`ปิดกะ #${shift.shiftNo}`} width={480}>
        <View style={{ gap: 12 }}>
          <View style={[s.result, { backgroundColor: v.bg, marginTop: 0, padding: 16 }]}>
            <Icon name={v.icon} size={40} color={v.fg} />
            <Text style={[s.resultTitle, { color: v.fg, fontSize: 18, marginTop: 2 }]}>{v.label}{diff ? ` ${diff > 0 ? '+' : '−'}${baht(Math.abs(diff))}` : ''}</Text>
            <Text style={s.resultSub}>นับได้ {baht(counted)} · ควรมี {baht(shift.expectedCash)}</Text>
          </View>
          <View style={s.ask}>
            <View style={s.askIcon}><Icon name="print-outline" size={24} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.askTitle}>พิมพ์สรุปยอดขายของวันนี้ด้วยไหม?</Text>
              <Text style={s.resultSub}>ยอดขาย · แยกช่องทางชำระ · เงินในลิ้นชัก · ค่าใช้จ่าย · สินค้าขายดี (กระดาษ 80 มม.)</Text>
            </View>
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Pressable style={[s.btn, { backgroundColor: colors.primary }]} disabled={busy} onPress={() => submit(true)} accessibilityLabel="พิมพ์สรุปยอดและปิดกะ">
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Icon name="print-outline" size={18} color="#fff" />
                <Text style={s.btnText}>พิมพ์สรุปยอด & ปิดกะ</Text>
              </>
            )}
          </Pressable>
          <Pressable style={[s.btn, s.ghost]} disabled={busy} onPress={() => submit(false)} accessibilityLabel="ปิดกะโดยไม่พิมพ์">
            <Text style={s.ghostText}>ปิดกะ ไม่ต้องพิมพ์</Text>
          </Pressable>
          <Pressable onPress={() => setStep('count')} disabled={busy} style={{ alignSelf: 'center', padding: 6 }}>
            <Text style={[s.resultSub, { color: colors.primary }]}>← กลับไปแก้ยอดที่นับ</Text>
          </Pressable>
        </View>
      </Sheet>
    );
  }

  // ---------- ผลการปิดกะ ----------
  if (result) {
    const rv = VERDICT[result.verdict];
    return (
      <Sheet
        visible={visible}
        onClose={() => onClosed(result)}
        width={440}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[s.btn, s.ghost]} onPress={() => printDay(result)} disabled={printing}>
              {printing ? <ActivityIndicator color={colors.primary} /> : <Icon name="print-outline" size={17} color={colors.text} />}
              <Text style={s.ghostText}>พิมพ์สรุปยอด</Text>
            </Pressable>
            {onLogout ? (
              <Pressable style={[s.btn, s.ghost]} onPress={() => { onClosed(result); onLogout(); }}>
                <Icon name="log-out-outline" size={17} color={colors.danger} />
                <Text style={[s.ghostText, { color: colors.danger }]}>ออกจากระบบ</Text>
              </Pressable>
            ) : null}
            <Pressable style={[s.btn, { backgroundColor: colors.primary, flexGrow: 2 }]} onPress={() => onClosed(result)}>
              <Text style={s.btnText}>เสร็จสิ้น</Text>
            </Pressable>
          </View>
        }
      >
        <View style={[s.result, { backgroundColor: rv.bg }]}>
          <Icon name={rv.icon} size={56} color={rv.fg} />
          <Text style={[s.resultTitle, { color: rv.fg }]}>{rv.label}</Text>
          {result.diff ? <Text style={[s.resultDiff, { color: rv.fg }]}>{result.diff > 0 ? '+' : '−'}{baht(Math.abs(result.diff))}</Text> : null}
          <Text style={s.resultSub}>ปิดกะ #{result.shiftNo} เรียบร้อย · {duration(result.minutes)}</Text>
        </View>
        <View style={{ gap: 6, marginTop: 14 }}>
          <Line l="เงินที่ควรมีในลิ้นชัก" r={baht(result.expectedCash)} />
          <Line l="นับได้จริง" r={baht(result.countedCash ?? 0)} bold />
          <Line l="ยอดขายรวมทุกช่องทาง" r={baht(result.totalSales)} />
          <Line l="จำนวนบิล" r={`${result.billCount} บิล`} />
        </View>
      </Sheet>
    );
  }

  const breakdown = (
    <View>
      <View style={s.box}>
        <Text style={s.boxTitle}>เงินสดที่ควรมีในลิ้นชัก</Text>
        <Line l="เงินตั้งต้น (เข้ากะ)" r={baht(shift.openingCash)} />
        <Line l="+ เงินสด (ขาย)" r={baht(shift.cashSales)} />
        {shift.cashRefunds > 0 ? <Line l="   (รวมคืนเงินสดจากแก้ไข/ยกเลิกบิล)" r={`−${baht(shift.cashRefunds)}`} small /> : null}
        <Line l="+ นำเงินเข้า" r={baht(shift.cashIn)} />
        <Line l="− นำเงินออก / ค่าใช้จ่ายจากลิ้นชัก" r={baht(shift.cashOut)} />
        <View style={s.sep} />
        <Line l="ควรมี" r={baht(shift.expectedCash)} bold />
      </View>
      <View style={[s.box, { marginTop: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line }]}>
        <Text style={s.boxTitle}>ช่องทางอื่น (ไม่อยู่ในลิ้นชัก)</Text>
        {(['promptpay', 'card', 'transfer'] as PaymentMethod[]).map((m) => (
          <Line key={m} l={PAYMENT_LABEL[m]} r={baht(shift.byMethod[m] ?? 0)} />
        ))}
        <View style={s.sep} />
        <Line l={`ยอดขายรวม (${shift.billCount} บิล)`} r={baht(shift.totalSales)} bold />
      </View>

      <FieldLabel>ผู้ปิดกะ</FieldLabel>
      <View style={s.byMe}>
        <Icon name="person-circle-outline" size={18} color={colors.primary} />
        <Text style={s.byMeText}>{me.name}</Text>
      </View>
    </View>
  );

  const counter = (
    <View>
      <FieldLabel required>แจงเงินสดในลิ้นชัก</FieldLabel>
      <CashCounter key={key} total="" onChange={(t, d) => { setCounted(t); setDenoms(d); }} />

      <View style={[s.live, { backgroundColor: v?.bg ?? colors.surface }]}>
        {v ? <Icon name={v.icon} size={26} color={v.fg} /> : <Icon name="calculator-outline" size={24} color={colors.sub} />}
        <View style={{ flex: 1 }}>
          <Text style={[s.liveLabel, { color: v?.fg ?? colors.sub }]}>{v ? v.label : 'กรอกยอดที่นับได้'}</Text>
          {diff != null ? <Text style={s.liveSub}>นับได้ {baht(counted ?? 0)} · ควรมี {baht(shift.expectedCash)}</Text> : null}
        </View>
        {diff != null && diff !== 0 ? (
          <Text style={[s.liveDiff, { color: v!.fg }]}>{diff > 0 ? '+' : '−'}{baht(Math.abs(diff))}</Text>
        ) : null}
      </View>

      <FieldLabel required={diff != null && diff !== 0}>หมายเหตุ</FieldLabel>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={diff ? 'ยอดไม่ตรง: ระบุสาเหตุ เช่น ทอนเงินผิด' : 'ไม่บังคับ'}
        placeholderTextColor={colors.faint}
        style={s.input}
        maxLength={300}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`ปิดกะ #${shift.shiftNo} · ${duration(shift.minutes)}`}
      width={twoCol ? 900 : 520}
      footer={
        <Pressable style={[s.btn, { backgroundColor: colors.primary }, !ready && { opacity: 0.45 }]} disabled={!ready || busy} onPress={() => setStep('confirm')}>
          <Text style={s.btnText}>{counted == null ? 'แจงเงินในลิ้นชักก่อน' : diff !== 0 && !note.trim() ? 'ยอดไม่ตรง — ระบุหมายเหตุก่อน' : `ถัดไป · นับได้ ${baht(counted)}`}</Text>
          {ready ? <Icon name="arrow-forward" size={18} color="#fff" /> : null}
        </Pressable>
      }
    >
      {twoCol ? (
        <View style={{ flexDirection: 'row', gap: 20 }}>
          <ScrollView style={{ flex: 1, maxHeight: 580 }}>{breakdown}</ScrollView>
          <ScrollView style={{ flex: 1, maxHeight: 580 }}>{counter}</ScrollView>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 560 }}>
          {breakdown}
          {counter}
        </ScrollView>
      )}
    </Sheet>
  );
}

function Line({ l, r, bold, small }: { l: string; r: string; bold?: boolean; small?: boolean }) {
  const st = [s.lineText, bold && { fontWeight: '700' as const, fontSize: 15 }, small && { fontSize: 11, color: colors.faint }];
  return (
    <View style={s.line}>
      <Text style={st}>{l}</Text>
      <Text style={st}>{r}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  byMe: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  byMeText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.primary },
  box: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 6 },
  boxTitle: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub, marginBottom: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  lineText: { fontFamily: font, fontSize: 13, color: colors.text },
  sep: { borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginVertical: 2 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, marginTop: 12 },
  liveLabel: { fontFamily: font, fontSize: 15, fontWeight: '700' },
  liveSub: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 1 },
  liveDiff: { fontFamily: font, fontSize: 20, fontWeight: '700' },
  input: { fontFamily: font, fontSize: 13, color: colors.text, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 12 },
  btn: { flexGrow: 1, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  btnText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
  ghost: { borderWidth: 1.5, borderColor: colors.line },
  ghostText: { fontFamily: font, fontSize: 14, color: colors.text, fontWeight: '500' },
  result: { alignItems: 'center', padding: 22, borderRadius: radius.lg, gap: 4, marginTop: 6 },
  resultTitle: { fontFamily: font, fontSize: 22, fontWeight: '700', marginTop: 6 },
  resultDiff: { fontFamily: font, fontSize: 18, fontWeight: '700' },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  askIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  askTitle: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  resultSub: { fontFamily: font, fontSize: 12, color: colors.sub, marginTop: 4 },
});
