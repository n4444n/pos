// หน้าขาย: รับเงินผ่านเครื่องรับบัตร Beam Bolt
//
// ลำดับ  ยืนยันด้วย PIN ผู้จัดการ (ถ้าตั้งไว้) → ส่งยอดไปขึ้นบนเครื่อง → รอลูกค้าจ่าย (ถามผลทุก 2 วินาที)
//        → จ่ายสำเร็จ → ออกบิลและตัดสต็อก
//
// กติกาสำคัญ: ตัดสต็อกหลังได้เงินเท่านั้น และถ้าจ่ายสำเร็จแล้วออกบิลไม่ผ่าน ห้ามปิดหน้าต่างทิ้งเฉย ๆ
// เพราะเงินลูกค้าออกไปแล้ว — ต้องค้างปุ่ม "ลองออกบิลอีกครั้ง" ไว้ให้กดซ้ำได้
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type BeamCharge, type BeamCheckoutInfo, type BeamMethod } from '../../shared/api';
import { baht } from '../../shared/lib/format';
import type { Pos } from '../../shared/store/usePos';
import { colors, font, radius } from '../../shared/lib/theme';
import type { Order } from '../../shared/types';
import { Icon } from '../../shared/ui/Icon';
import { Sheet } from '../../shared/ui/Sheet';

const METHOD_LABEL: Record<string, string> = {
  CARD: 'บัตรเครดิต/เดบิต', CARD_INSTALLMENTS: 'ผ่อนชำระผ่านบัตร', QR_PROMPT_PAY: 'พร้อมเพย์ QR',
  TRUE_MONEY: 'TrueMoney', LINE_PAY: 'LINE Pay', SHOPEE_PAY: 'ShopeePay',
  ALIPAY: 'Alipay', ALIPAY_PLUS: 'Alipay+', WECHAT_PAY: 'WeChat Pay', SPAY_LATER: 'SPayLater',
};

type Phase = 'ask' | 'sending' | 'waiting' | 'canceling' | 'billing' | 'failed' | 'paidNotBilled';
/** ถามผลทุก 2 วินาที · ถ้าเพิ่งถามไม่สำเร็จ (เน็ตสะดุด / Beam ขอให้ช้าลง) เว้นนานขึ้น */
const POLL_MS = 2000;
const POLL_SLOW_MS = 6000;

interface Props {
  visible: boolean;
  total: number;
  pos: Pos;
  onClose: () => void;
  onDone: (o: Order) => void;
}

export function BeamPayDialog({ visible, total, pos, onClose, onDone }: Props) {
  const [cfg, setCfg] = useState<BeamCheckoutInfo | null>(null);
  const [method, setMethod] = useState<BeamMethod | null>(null);
  const [pin, setPin] = useState('');
  const [phase, setPhase] = useState<Phase>('ask');
  const [charge, setCharge] = useState<BeamCharge | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    if (!visible) return;
    stop.current = false;
    setPhase('ask');
    setPin('');
    setCharge(null);
    setError(null);
    api.beamCheckout().then((s) => {
      setCfg(s);
      setMethod((m) => (m && s.methods.includes(m) ? m : s.methods[0] ?? null));
      if (!s.ready) setError('เครื่องรับบัตรยังไม่พร้อม — ตรวจที่ ตั้งค่า → Beam Checkout ว่าผูกเครื่องไว้แล้วและอยู่โหมดเดียวกัน');
    }).catch((e) => setError((e as Error).message));
    return () => {
      stop.current = true;
    };
  }, [visible]);

  // นับเวลาถอยหลังระหว่างรอลูกค้าจ่าย
  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  /** ออกบิล — แยกออกมาเพราะต้องกดซ้ำได้ถ้าครั้งแรกไม่ผ่าน */
  const bill = useCallback(async (intentId: string) => {
    setPhase('billing');
    setError(null);
    try {
      const order = await pos.beamBill(intentId);
      if (order) return onDone(order);
      setError('บิลนี้ออกไปแล้ว — ดูได้ที่ประวัติการขาย');
      setPhase('paidNotBilled');
    } catch (e) {
      setError(`รับเงินสำเร็จแล้ว แต่ออกบิลไม่สำเร็จ: ${(e as Error).message}`);
      setPhase('paidNotBilled');
    }
  }, [pos, onDone]);

  /** ถามผลจาก Beam ทุก 2 วินาที จนกว่าจะรู้ผล */
  const watch = useCallback(async (intentId: string) => {
    let wait = POLL_MS;
    for (;;) {
      await new Promise((r) => setTimeout(r, wait));
      if (stop.current) return;
      let r;
      try {
        r = await api.beamPoll(intentId);
        wait = POLL_MS;
      } catch {
        wait = POLL_SLOW_MS; // เน็ตสะดุด / Beam ขอให้ถามช้าลง → เว้นนานขึ้น ไม่ยกเลิกรายการ
        continue;
      }
      if (stop.current) return;
      if (r.status === 'PAID' || r.status === 'BILLED') return bill(intentId);
      if (r.status === 'CANCELED' || r.status === 'EXPIRED' || r.status === 'FAILED') {
        setError(
          r.status === 'EXPIRED' ? 'หมดเวลารอชำระเงิน — ลูกค้ายังไม่ได้จ่าย'
            : r.status === 'CANCELED' ? 'รายการถูกยกเลิก'
              : `ชำระเงินไม่สำเร็จ (${r.result ?? 'ไม่ทราบสาเหตุ'})`,
        );
        setPhase('failed');
        return;
      }
    }
  }, [bill]);

  const send = async () => {
    if (!method) return;
    setPhase('sending');
    setError(null);
    try {
      const r = await pos.beamCharge(method, pin);
      setCharge(r);
      setLeft(r.expirySec);
      setPhase('waiting');
      void watch(r.intentId);
    } catch (e) {
      setError((e as Error).message);
      setPhase('ask');
    }
  };

  /**
   * ยกเลิกรายการบนเครื่อง — จุดเสี่ยงที่สุดของทั้งหน้านี้
   * ถ้าลูกค้าแตะบัตรพอดีตอนพนักงานกดยกเลิก เงินออกไปแล้วแต่ยกเลิกไม่ทัน
   * ห้ามปิดหน้าต่างทิ้ง ต้องพาไปออกบิล (ถามผลซ้ำอีกครั้งเสมอ แม้คำสั่งยกเลิกจะ error)
   */
  const cancel = async () => {
    stop.current = true;
    if (!charge) return onClose();
    setPhase('canceling');
    const paid = (st: string) => st === 'PAID' || st === 'BILLED';
    try {
      const r = await api.beamCancel(charge.intentId);
      if (paid(r.status)) return bill(charge.intentId);
    } catch {
      // ยกเลิกไม่สำเร็จ (เช่นเงินเข้าไปแล้ว) → ถามผลอีกครั้งก่อนปิด
      try {
        const p = await api.beamPoll(charge.intentId);
        if (paid(p.status)) return bill(charge.intentId);
      } catch {
        // ติดต่อไม่ได้เลย — รายการจะไปขึ้นเตือนให้ออกบิลตอนเปิดหน้าขายครั้งหน้า
      }
    }
    onClose();
  };

  const needPin = !!cfg?.requireManager;
  // ส่งยอดได้เมื่อเครื่องพร้อม เลือกวิธีรับเงินแล้ว และใส่ PIN ครบ (ถ้าตั้งให้ต้องยืนยัน)
  const ready = !!cfg?.ready && !!method && (!needPin || /^\d{6}$/.test(pin));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <Sheet
      visible={visible}
      onClose={phase === 'waiting' || phase === 'canceling' || phase === 'billing' ? () => {} : onClose}
      title="รับเงินผ่านเครื่องรับบัตร"
      width={460}
      footer={
        phase === 'ask' || phase === 'sending' ? (
          <Pressable style={[s.btn, !ready && { opacity: 0.45 }]} disabled={!ready || phase === 'sending'} onPress={send}>
            {phase === 'sending' ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>ส่งยอด {baht(total)} ไปที่เครื่อง</Text>}
          </Pressable>
        ) : phase === 'waiting' ? (
          <Pressable style={s.ghost} onPress={cancel}>
            <Text style={s.ghostText}>ยกเลิกรายการบนเครื่อง</Text>
          </Pressable>
        ) : phase === 'paidNotBilled' ? (
          <Pressable style={s.btn} onPress={() => charge && bill(charge.intentId)}>
            <Text style={s.btnText}>ลองออกบิลอีกครั้ง</Text>
          </Pressable>
        ) : phase === 'failed' ? (
          <Pressable style={s.btn} onPress={() => { setPhase('ask'); setError(null); setCharge(null); }}>
            <Text style={s.btnText}>ลองใหม่</Text>
          </Pressable>
        ) : null
      }
    >
      <View style={s.amountBox}>
        <Text style={s.amountLabel}>ยอดที่ต้องชำระ</Text>
        <Text style={s.amount}>{baht(total)}</Text>
      </View>

      {phase === 'ask' || phase === 'sending' ? (
        <>
          <Text style={s.label}>วิธีรับเงิน</Text>
          <View style={s.chips}>
            {(cfg?.methods ?? []).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMethod(m)}
                accessibilityRole="radio"
                accessibilityState={{ selected: method === m }}
                style={[s.chip, method === m && s.chipOn]}
              >
                <Text style={[s.chipText, method === m && s.chipTextOn]}>{METHOD_LABEL[m] ?? m}</Text>
              </Pressable>
            ))}
          </View>

          {needPin ? (
            <>
              <Text style={s.label}>ยืนยันด้วย PIN ผู้จัดการ</Text>
              <TextInput
                value={pin}
                onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="••••••"
                placeholderTextColor={colors.faint}
                secureTextEntry
                keyboardType="number-pad"
                maxLength={6}
                style={s.pin}
                accessibilityLabel="PIN ผู้จัดการยืนยันการรับเงิน"
                onSubmitEditing={() => ready && send()}
              />
              <Text style={s.hint}>ยืนยันก่อนส่งยอดไปเครื่อง — เงินยังไม่ออกจากลูกค้าจนกว่าจะแตะบัตรหรือสแกน</Text>
            </>
          ) : null}
        </>
      ) : null}

      {phase === 'waiting' ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.big}>ให้ลูกค้าจ่ายที่เครื่อง</Text>
          <Text style={s.sub}>
            {charge?.device ? `${charge.device} · ` : ''}{METHOD_LABEL[charge?.method ?? ''] ?? charge?.method}
          </Text>
          <Text style={s.timer}>เหลือเวลา {mm}:{ss}</Text>
          <Text style={s.hint}>ยังไม่ออกบิลและยังไม่ตัดสต็อก จนกว่าเครื่องจะแจ้งว่าได้รับเงินแล้ว</Text>
        </View>
      ) : null}

      {phase === 'canceling' ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.sub} />
          <Text style={s.big}>กำลังยกเลิกรายการบนเครื่อง</Text>
          <Text style={s.hint}>ถ้าลูกค้าจ่ายไปแล้วพอดี ระบบจะออกบิลให้แทนการยกเลิก</Text>
        </View>
      ) : null}

      {phase === 'billing' ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.success} />
          <Text style={s.big}>ได้รับเงินแล้ว — กำลังออกบิล</Text>
        </View>
      ) : null}

      {phase === 'paidNotBilled' ? (
        <View style={s.warn}>
          <Icon name="warning-outline" size={18} color={colors.danger} />
          <Text style={s.warnText}>
            ลูกค้าจ่ายเงินเรียบร้อยแล้ว อย่าเพิ่งปิดหน้าต่างนี้ — กด "ลองออกบิลอีกครั้ง"
            {'\n'}ถ้ายังไม่ได้ ปิดไปก่อนได้ ระบบจะเตือนให้ออกบิลย้อนหลังตอนเปิดโปรแกรมครั้งหน้า
          </Text>
        </View>
      ) : null}

      {error ? <Text style={phase === 'paidNotBilled' ? s.errorStrong : s.error}>{error}</Text> : null}
    </Sheet>
  );
}

/**
 * บิลค้าง: ลูกค้าจ่ายผ่านเครื่องแล้วแต่ยังไม่ได้ออกบิล (ไฟดับ / ปิดโปรแกรมกลางคัน)
 * เช็คตอนเปิดหน้าขาย — ถ้ามีต้องออกบิลให้ครบ ไม่งั้นเงินเข้าแต่สต็อกไม่ถูกตัดและไม่มียอดขาย
 */
export function BeamPendingDialog({ pos, onDone }: { pos: Pos; onDone: (o: Order) => void }) {
  const [rows, setRows] = useState<{ intentId: string; amount: number; staff: string; createdAt: string }[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // เงียบ ๆ ถ้าไม่ได้เปิดใช้งาน Beam หรือไม่มีสิทธิ์ — ไม่ต้องรบกวนพนักงาน
    api.beamPending().then((r) => setRows(r.rows)).catch(() => {});
  }, []);

  const bill = async (intentId: string) => {
    setBusy(intentId);
    setErr(null);
    try {
      const order = await pos.beamBill(intentId);
      setRows((list) => list.filter((x) => x.intentId !== intentId));
      if (order) onDone(order);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (!rows.length) return null;
  return (
    <Sheet visible onClose={() => setRows([])} title="มีรายการที่รับเงินแล้วแต่ยังไม่ได้ออกบิล" width={520}>
      <View style={s.warn}>
        <Icon name="warning-outline" size={18} color={colors.danger} />
        <Text style={s.warnText}>ลูกค้าจ่ายผ่านเครื่องรับบัตรไปแล้ว แต่บิลยังไม่ออกและสต็อกยังไม่ถูกตัด — กดออกบิลให้ครบทุกรายการ</Text>
      </View>
      {rows.map((r) => (
        <View key={r.intentId} style={s.pendRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.pendAmount}>{baht(r.amount)}</Text>
            <Text style={s.sub}>{r.createdAt} · {r.staff}</Text>
          </View>
          <Pressable style={s.smallBtn} disabled={!!busy} onPress={() => bill(r.intentId)}>
            {busy === r.intentId ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>ออกบิล</Text>}
          </Pressable>
        </View>
      ))}
      {err ? <Text style={s.error}>{err}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  pendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  pendAmount: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  smallBtn: { height: 38, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  amountBox: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 14, marginBottom: 14 },
  amountLabel: { fontFamily: font, fontSize: 12, color: colors.sub },
  amount: { fontFamily: font, fontSize: 30, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  label: { fontFamily: font, fontSize: 12, fontWeight: '700', color: colors.sub, marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, height: 36, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontFamily: font, fontSize: 13, color: colors.text },
  chipTextOn: { color: colors.primary, fontWeight: '700' },
  pin: { fontFamily: font, fontSize: 26, letterSpacing: 10, textAlign: 'center', color: colors.text, height: 56, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  hint: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 8, lineHeight: 16, textAlign: 'center' },
  center: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  big: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 6 },
  sub: { fontFamily: font, fontSize: 13, color: colors.sub },
  timer: { fontFamily: font, fontSize: 22, fontWeight: '700', color: colors.primary, fontVariant: ['tabular-nums'], marginTop: 4 },
  warn: { flexDirection: 'row', gap: 8, backgroundColor: colors.dangerSoft, padding: 12, borderRadius: radius.md },
  warnText: { fontFamily: font, fontSize: 13, color: colors.danger, flex: 1, lineHeight: 20 },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 12, textAlign: 'center' },
  errorStrong: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.danger, marginTop: 12 },
  btn: { height: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: font, fontSize: 15, fontWeight: '700', color: '#fff' },
  ghost: { height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: font, fontSize: 15, fontWeight: '600', color: colors.sub },
});
