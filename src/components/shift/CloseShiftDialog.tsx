import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api } from '../../api';
import { useAppSettings } from '../../appSettings';
import { baht, duration, MONEY_RE, moneyInput, PAYMENT_LABEL, VERDICT } from '../../format';
import { openPrintWindow, printDaySummary } from '../../print';
import { useSession } from '../../session';
import { colors, font, radius } from '../../theme';
import type { PaymentMethod, Shift, ShiftTender } from '../../types';
import { FieldLabel } from '../history/Chips';
import { Icon, type IconName } from '../Icon';
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

const METHOD_ICON: Record<string, IconName> = { promptpay: 'qr-code-outline', card: 'card-outline', transfer: 'swap-horizontal-outline' };
const verdictOf = (d: number) => VERDICT[d === 0 ? 'match' : d > 0 ? 'over' : 'short'];
const signed = (d: number) => `${d > 0 ? '+' : '−'}${baht(Math.abs(d))}`;

/**
 * ปิดกะ — ตรวจยอด 2 ช่องแยกกัน
 *  1) เงินสดในลิ้นชัก: นับแบงก์/เหรียญ เทียบกับยอดที่ควรมี
 *  2) บัตร / QR / โอน: เงินไม่เข้าลิ้นชัก → กรอกยอดจากสลิปสรุปเครื่อง EDC / ยอดเงินเข้าบัญชี เทียบกับยอดระบบ
 */
export function CloseShiftDialog({ visible, shift, onClose, onClosed, onLogout }: Props) {
  const { me } = useSession();
  const settings = useAppSettings();
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
  const [tab, setTab] = useState<'cash' | 'other'>('cash');
  const [tend, setTend] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    setCounted(null);
    setDenoms(null);
    setTend({});
    setTab('cash');
    setNote('');
    setError(null);
    setResult(null);
    setStep('count');
    setKey((k) => k + 1);
  }, [visible]);

  const diff = counted == null ? null : Math.round((counted - shift.expectedCash) * 100) / 100;
  const v = diff == null ? null : verdictOf(diff);

  // ---------- ช่องที่ 2: บัตร / QR / โอน ----------
  // แสดงช่องทางที่เปิดใช้ หรือมียอดในกะนี้ (ตามลำดับในตั้งค่า)
  const others = settings.payments.methods
    .filter((m) => m.id !== 'cash' && (m.enabled || (shift.byMethod[m.id] ?? 0) !== 0))
    .map((m) => {
      const system = shift.byMethod[m.id] ?? 0;
      const txt = tend[m.id] ?? '';
      const actual = txt !== '' && txt !== '.' && MONEY_RE.test(txt) ? Number(txt) : null;
      return { id: m.id, label: m.label || PAYMENT_LABEL[m.id], system, count: shift.countByMethod?.[m.id] ?? 0, actual, need: system !== 0 };
    });
  const missing = others.filter((o) => o.need && o.actual == null);
  const otherSystem = Math.round(others.reduce((a, o) => a + o.system, 0) * 100) / 100;
  const otherActual = Math.round(others.reduce((a, o) => a + (o.actual ?? 0), 0) * 100) / 100;
  const otherDiff = missing.length ? null : Math.round(others.reduce((a, o) => a + (o.actual != null ? o.actual - o.system : 0), 0) * 100) / 100;
  const ov = otherDiff == null ? null : verdictOf(otherDiff);
  const mismatch = (diff != null && diff !== 0) || (otherDiff != null && otherDiff !== 0);
  const ready = counted != null && otherDiff != null && (!mismatch || note.trim().length > 0);
  const fillAll = () => setTend(Object.fromEntries(others.map((o) => [o.id, String(o.system < 0 ? 0 : o.system)])));

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
      const tenders = Object.fromEntries(others.filter((o) => o.actual != null).map((o) => [o.id, o.actual!]));
      const s = await api.closeShift({ staff: me.name, countedCash: counted!, note: note || undefined, denominations: denoms ?? undefined, tenders });
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
  if (step === 'confirm' && !result && counted != null && v && ov && otherDiff != null) {
    return (
      <Sheet visible={visible} onClose={onClose} title={`ปิดกะ #${shift.shiftNo}`} width={560}>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Tile icon="cash-outline" title="เงินสดในลิ้นชัก" v={v} d={diff ?? 0} sub={`นับได้ ${baht(counted)} · ควรมี ${baht(shift.expectedCash)}`} />
            <Tile icon="card-outline" title="บัตร / QR / โอน" v={ov} d={otherDiff} sub={`ยอดจริง ${baht(otherActual)} · ระบบ ${baht(otherSystem)}`} />
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
    // หัวผลลัพธ์: ไม่ตรงช่องใดช่องหนึ่ง → แสดงสถานะไม่ตรง
    const head = result.diff ? rv : result.tenderDiff ? verdictOf(result.tenderDiff) : rv;
    const t = Object.values(result.tenders ?? {}) as (ShiftTender | undefined)[];
    const tSys = Math.round(t.reduce((a, x) => a + (x?.system ?? 0), 0) * 100) / 100;
    const tAct = Math.round(t.reduce((a, x) => a + (x?.actual ?? 0), 0) * 100) / 100;
    return (
      <Sheet
        visible={visible}
        onClose={() => onClosed(result)}
        width={560}
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
        <View style={[s.result, { backgroundColor: head.bg }]}>
          <Icon name={head.icon} size={48} color={head.fg} />
          <Text style={s.resultSub}>ปิดกะ #{result.shiftNo} เรียบร้อย · {duration(result.minutes)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Tile icon="cash-outline" title="เงินสดในลิ้นชัก" v={rv} d={result.diff ?? 0} sub={`นับได้ ${baht(result.countedCash ?? 0)} · ควรมี ${baht(result.expectedCash)}`} />
          {result.tenderDiff != null ? (
            <Tile icon="card-outline" title="บัตร / QR / โอน" v={verdictOf(result.tenderDiff)} d={result.tenderDiff} sub={`ยอดจริง ${baht(tAct)} · ระบบ ${baht(tSys)}`} />
          ) : null}
        </View>
        <View style={{ gap: 6, marginTop: 14 }}>
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
          <Line key={m} l={`${PAYMENT_LABEL[m]}${shift.countByMethod?.[m] ? ` (${shift.countByMethod[m]} บิล)` : ''}`} r={baht(shift.byMethod[m] ?? 0)} />
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

  const cashPanel = (
    <View>
      {/* CashCounter ต้องคงอยู่ตอนสลับแท็บ (ไม่ให้ยอดที่แจงหาย) → ซ่อนด้วย display แทนการ unmount */}
      <CashCounter key={key} total="" onChange={(t, d) => { setCounted(t); setDenoms(d); }} />
      <View style={[s.live, { backgroundColor: v?.bg ?? colors.surface }]}>
        {v ? <Icon name={v.icon} size={26} color={v.fg} /> : <Icon name="calculator-outline" size={24} color={colors.sub} />}
        <View style={{ flex: 1 }}>
          <Text style={[s.liveLabel, { color: v?.fg ?? colors.sub }]}>{v ? `เงินสด: ${v.label}` : 'กรอกยอดเงินสดที่นับได้'}</Text>
          {diff != null ? <Text style={s.liveSub}>นับได้ {baht(counted ?? 0)} · ควรมี {baht(shift.expectedCash)}</Text> : null}
        </View>
        {diff != null && diff !== 0 ? <Text style={[s.liveDiff, { color: v!.fg }]}>{signed(diff)}</Text> : null}
      </View>
    </View>
  );

  const otherPanel = (
    <View style={{ gap: 10 }}>
      <View style={s.hintBox}>
        <Icon name="information-circle-outline" size={18} color={colors.primary} />
        <Text style={s.hintText}>
          เงินช่องทางนี้ไม่เข้าลิ้นชัก — กรอกยอดจากสลิปสรุปยอด (Settlement) ของเครื่อง EDC สำหรับบัตร / QR และยอดเงินเข้าบัญชีสำหรับเงินโอน
        </Text>
      </View>
      {others.length === 0 ? <Text style={s.resultSub}>ไม่มีช่องทางอื่นที่เปิดใช้</Text> : null}
      {others.length ? (
        <Pressable style={s.fillAll} onPress={fillAll}>
          <Icon name="checkmark-done-outline" size={16} color={colors.primary} />
          <Text style={s.fillAllText}>ยอดตรงกับระบบทั้งหมด</Text>
        </Pressable>
      ) : null}
      {others.map((o) => {
        const d = o.actual == null ? null : Math.round((o.actual - o.system) * 100) / 100;
        const dv = d == null ? null : verdictOf(d);
        return (
          <View key={o.id} style={[s.tRow, o.need && o.actual == null && { borderColor: '#F5C2C4' }]}>
            <View style={s.tHead}>
              <Icon name={METHOD_ICON[o.id] ?? 'wallet-outline'} size={18} color={colors.text} />
              <Text style={s.tLabel}>{o.label}</Text>
              <Text style={s.tSys}>ระบบ {baht(o.system)}{o.count ? ` · ${o.count} บิล` : ''}</Text>
            </View>
            <View style={s.tInputRow}>
              <View style={s.tInputWrap}>
                <Text style={s.tBaht}>฿</Text>
                <TextInput
                  value={tend[o.id] ?? ''}
                  onChangeText={(t) => setTend((x) => ({ ...x, [o.id]: moneyInput(t, x[o.id] ?? '') }))}
                  placeholder={o.id === 'transfer' ? 'ยอดเงินเข้าบัญชี' : 'ยอดจากสลิป EDC'}
                  placeholderTextColor={colors.faint}
                  keyboardType="decimal-pad"
                  style={s.tInput}
                  accessibilityLabel={`ยอดจริง ${o.label}`}
                />
              </View>
              <Pressable style={s.tSame} onPress={() => setTend((x) => ({ ...x, [o.id]: String(o.system < 0 ? 0 : o.system) }))}>
                <Text style={s.tSameText}>ตรง</Text>
              </Pressable>
            </View>
            <Text style={[s.tDiff, { color: dv?.fg ?? (o.need ? colors.danger : colors.faint) }]}>
              {d == null ? (o.need ? 'ยังไม่กรอกยอดจริง' : 'ไม่มีรายการ (ไม่ต้องกรอก)') : d === 0 ? '✓ ตรงกับระบบ' : `${dv!.label.replace('เงิน', '')} ${signed(d)}`}
            </Text>
          </View>
        );
      })}
      {others.length ? (
        <View style={[s.live, { backgroundColor: ov?.bg ?? colors.surface, marginTop: 2 }]}>
          {ov ? <Icon name={ov.icon} size={26} color={ov.fg} /> : <Icon name="card-outline" size={24} color={colors.sub} />}
          <View style={{ flex: 1 }}>
            <Text style={[s.liveLabel, { color: ov?.fg ?? colors.sub }]}>{ov ? `บัตร / QR / โอน: ${ov.label.replace('เงิน', 'ยอด')}` : `กรอกยอดจริงอีก ${missing.length} ช่องทาง`}</Text>
            <Text style={s.liveSub}>ยอดจริง {baht(otherActual)} · ระบบ {baht(otherSystem)}</Text>
          </View>
          {otherDiff ? <Text style={[s.liveDiff, { color: ov!.fg }]}>{signed(otherDiff)}</Text> : null}
        </View>
      ) : null}
    </View>
  );

  const counter = (
    <View>
      <FieldLabel required>ตรวจยอดปิดกะ (แยก 2 ช่อง)</FieldLabel>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <TabCard
          on={tab === 'cash'}
          icon="cash-outline"
          title="① เงินสดในลิ้นชัก"
          sub={counted == null ? 'ยังไม่แจง' : `นับได้ ${baht(counted)}`}
          v={v}
          onPress={() => setTab('cash')}
        />
        <TabCard
          on={tab === 'other'}
          icon="card-outline"
          title="② บัตร / QR / โอน"
          sub={missing.length ? `ยังไม่กรอก ${missing.length} ช่องทาง` : `ยอดจริง ${baht(otherActual)}`}
          v={ov}
          onPress={() => setTab('other')}
        />
      </View>
      <View style={tab === 'cash' ? null : { display: 'none' }}>{cashPanel}</View>
      <View style={tab === 'other' ? null : { display: 'none' }}>{otherPanel}</View>

      <FieldLabel required={mismatch}>หมายเหตุ</FieldLabel>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={mismatch ? 'ยอดไม่ตรง: ระบุสาเหตุ เช่น ทอนเงินผิด / สลิป EDC ไม่ครบ' : 'ไม่บังคับ'}
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
        <Pressable
          style={[s.btn, { backgroundColor: colors.primary }, !ready && { opacity: 0.45 }]}
          disabled={busy}
          onPress={() => {
            // ยังไม่ครบ → พาไปช่องที่ต้องกรอก
            if (counted == null) return setTab('cash');
            if (missing.length) return setTab('other');
            if (ready) setStep('confirm');
          }}
        >
          <Text style={s.btnText}>
            {counted == null
              ? 'แจงเงินสดในลิ้นชักก่อน'
              : missing.length
                ? 'กรอกยอดบัตร / QR / โอน ก่อน'
                : mismatch && !note.trim()
                  ? 'ยอดไม่ตรง — ระบุหมายเหตุก่อน'
                  : `ถัดไป · เงินสด ${baht(counted)} · บัตร/QR/โอน ${baht(otherActual)}`}
          </Text>
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

type V = (typeof VERDICT)[string];

/** ปุ่มแท็บ (ช่อง 1 / ช่อง 2) พร้อมสถานะของช่องนั้น */
function TabCard({ on, icon, title, sub, v, onPress }: { on: boolean; icon: IconName; title: string; sub: string; v: V | null; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.tab, on && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={17} color={on ? colors.primary : colors.text} />
        <Text style={[s.tabTitle, on && { color: colors.primary }]} numberOfLines={1}>{title}</Text>
        <View style={{ flex: 1 }} />
        {v ? <Icon name={v.icon} size={16} color={v.fg} /> : <View style={s.tabDot} />}
      </View>
      <Text style={[s.tabSub, v && { color: v.fg }]} numberOfLines={1}>{sub}</Text>
    </Pressable>
  );
}

/** สรุปผลของแต่ละช่อง (หน้ายืนยัน / ผลการปิดกะ) */
function Tile({ icon, title, v, d, sub }: { icon: IconName; title: string; v: V; d: number; sub: string }) {
  return (
    <View style={[s.tile, { backgroundColor: v.bg }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={16} color={colors.sub} />
        <Text style={s.tileTitle}>{title}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Icon name={v.icon} size={22} color={v.fg} />
        <Text style={[s.tileVerdict, { color: v.fg }]}>{d === 0 ? 'ตรงกัน' : `${v.label.replace('เงิน', '')} ${signed(d)}`}</Text>
      </View>
      <Text style={s.tileSub}>{sub}</Text>
    </View>
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
  tab: { flex: 1, minWidth: 0, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, gap: 3, backgroundColor: '#fff' },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tabTitle: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.text, flexShrink: 1 },
  tabSub: { fontFamily: font, fontSize: 12, color: colors.sub },
  tabDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  hintBox: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  hintText: { flex: 1, fontFamily: font, fontSize: 12, color: colors.text, lineHeight: 18 },
  fillAll: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.primary },
  fillAllText: { fontFamily: font, fontSize: 13, color: colors.primary, fontWeight: '600' },
  tRow: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, gap: 8 },
  tHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tLabel: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  tSys: { fontFamily: font, fontSize: 12, color: colors.sub },
  tInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 },
  tBaht: { fontFamily: font, fontSize: 15, color: colors.sub, marginRight: 4 },
  tInput: { flex: 1, fontFamily: font, fontSize: 16, fontWeight: '600', color: colors.text, height: 42, minWidth: 0 },
  tSame: { height: 42, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  tSameText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '600' },
  tDiff: { fontFamily: font, fontSize: 12, fontWeight: '600' },
  tile: { flex: 1, minWidth: 0, borderRadius: radius.md, padding: 12 },
  tileTitle: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub },
  tileVerdict: { fontFamily: font, fontSize: 16, fontWeight: '700' },
  tileSub: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 4 },
});
