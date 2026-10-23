import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import { baht, duration, PAYMENT_LABEL, thaiDateTime, VERDICT } from '../../format';
import { printShiftReport } from '../../print';
import { colors, font, radius } from '../../theme';
import type { PaymentMethod } from '../../types';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';

type Detail = Awaited<ReturnType<typeof api.shiftDetail>>;

export function ShiftDetailModal({ shiftId, onClose }: { shiftId: number | null; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    setError(null);
    if (shiftId != null) api.shiftDetail(shiftId).then(setD).catch((e: Error) => setError(e.message));
  }, [shiftId]);

  const s = d?.shift;
  const v = s ? VERDICT[s.verdict] : null;

  return (
    <Sheet
      visible={shiftId != null}
      onClose={onClose}
      title={s ? `กะ #${s.shiftNo} · ${thaiDateTime(s.openedAt).split(' · ')[0]}` : 'รายละเอียดกะ'}
      width={620}
      footer={
        s ? (
          <Pressable style={s_.btn} onPress={() => printShiftReport(s)}>
            <Icon name="print-outline" size={17} color={colors.text} />
            <Text style={s_.btnText}>พิมพ์รายงานกะ</Text>
          </Pressable>
        ) : null
      }
    >
      {error ? <Text style={s_.error}>{error}</Text> : null}
      {!d && !error ? <ActivityIndicator style={{ marginVertical: 40 }} color={colors.primary} /> : null}
      {s && v && d ? (
        <ScrollView style={{ maxHeight: 580 }}>
          <View style={[s_.verdict, { backgroundColor: v.bg }]}>
            <Icon name={v.icon} size={30} color={v.fg} />
            <View style={{ flex: 1 }}>
              <Text style={[s_.vTitle, { color: v.fg }]}>{v.label}</Text>
              <Text style={s_.vSub}>
                {s.openedAt.slice(11, 16)} – {s.closedAt ? s.closedAt.slice(11, 16) : 'ยังไม่ปิด'} · {duration(s.minutes)} · เปิดโดย{' '}
                {s.openedBy.replace('พนักงาน: ', '')}
                {s.closedBy ? ` · ปิดโดย ${s.closedBy.replace('พนักงาน: ', '')}` : ''}
              </Text>
            </View>
            {s.diff ? <Text style={[s_.vDiff, { color: v.fg }]}>{s.diff > 0 ? '+' : '−'}{baht(Math.abs(s.diff))}</Text> : null}
          </View>

          <View style={s_.grid}>
            <View style={s_.card}>
              <Text style={s_.cardTitle}>ลิ้นชักเงินสด</Text>
              <Line l="เงินตั้งต้น" r={baht(s.openingCash)} />
              <Line l="+ เงินสด (ขาย)" r={baht(s.cashSales)} />
              <Line l="+ นำเงินเข้า" r={baht(s.cashIn)} />
              <Line l="− นำเงินออก" r={baht(s.cashOut)} />
              <View style={s_.sep} />
              <Line l="ควรมี" r={baht(s.expectedCash)} bold />
              <Line l="นับได้จริง" r={s.countedCash != null ? baht(s.countedCash) : '—'} bold />
            </View>
            <View style={s_.card}>
              <Text style={s_.cardTitle}>ยอดขายตามช่องทาง</Text>
              {(['cash', 'promptpay', 'card', 'transfer'] as PaymentMethod[]).map((m) => {
                const t = s.tenders?.[m];
                return (
                  <View key={m}>
                    <Line l={PAYMENT_LABEL[m]} r={baht(s.byMethod[m] ?? 0)} />
                    {t ? (
                      <Text style={[s_.small, { textAlign: 'right', marginTop: 0, color: t.diff === 0 ? colors.success : t.diff > 0 ? '#B26A00' : colors.danger }]}>
                        ยอดจริง {baht(t.actual)}{t.diff === 0 ? ' ✓ ตรง' : ` (${t.diff > 0 ? '+' : '−'}${baht(Math.abs(t.diff))})`}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
              <View style={s_.sep} />
              <Line l={`รวม (${s.billCount} บิล)`} r={baht(s.totalSales)} bold />
              <Text style={s_.small}>แก้ไขบิล {s.editCount} ครั้ง · ยกเลิกบิล {s.voidCount} ครั้ง</Text>
              {s.tenders ? (
                <Text style={s_.small}>
                  ตรวจยอดบัตร / QR / โอน ตอนปิดกะ: {s.tenderDiff ? `ส่วนต่าง ${s.tenderDiff > 0 ? '+' : '−'}${baht(Math.abs(s.tenderDiff))}` : 'ตรงกับระบบ'}
                </Text>
              ) : null}
            </View>
          </View>

          {s.closeNote || s.openingNote ? (
            <View style={s_.note}>
              {s.openingNote ? <Text style={s_.noteText}>หมายเหตุเปิดกะ: {s.openingNote}</Text> : null}
              {s.closeNote ? <Text style={s_.noteText}>หมายเหตุปิดกะ: {s.closeNote}</Text> : null}
            </View>
          ) : null}

          {s.denominations ? (
            <>
              <Text style={s_.section}>การนับเงินตอนปิดกะ</Text>
              <View style={s_.denoms}>
                {Object.entries(s.denominations)
                  .sort((a, b) => Number(b[0]) - Number(a[0]))
                  .map(([den, n]) => (
                    <View key={den} style={s_.denom}>
                      <Text style={s_.denomText}>
                        {Number(den).toLocaleString()} × {n}
                      </Text>
                      <Text style={s_.denomSub}>{baht(Number(den) * n)}</Text>
                    </View>
                  ))}
              </View>
            </>
          ) : null}

          <Text style={s_.section}>นำเงินเข้า/ออก ({d.moves.length})</Text>
          {d.moves.length === 0 ? <Text style={s_.empty}>ไม่มีรายการ</Text> : null}
          {d.moves.map((mv) => (
            <View key={mv.id} style={s_.item}>
              <Icon name={mv.kind === 'in' ? 'arrow-down-circle' : 'arrow-up-circle'} size={20} color={mv.kind === 'in' ? colors.success : colors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={s_.itemText}>{mv.reason}</Text>
                <Text style={s_.itemSub}>{thaiDateTime(mv.createdAt)} · {mv.staff.replace('พนักงาน: ', '')}</Text>
              </View>
              <Text style={[s_.itemAmt, { color: mv.kind === 'in' ? colors.success : colors.danger }]}>
                {mv.kind === 'in' ? '+' : '−'}{baht(mv.amount)}
              </Text>
            </View>
          ))}

          {d.adjustments.length > 0 ? (
            <>
              <Text style={s_.section}>เงินจากการแก้ไข/ยกเลิกบิล ({d.adjustments.length})</Text>
              {d.adjustments.map((a) => (
                <View key={a.id} style={s_.item}>
                  <Icon name={a.kind === 'void' ? 'close-circle' : 'swap-horizontal'} size={20} color={a.kind === 'void' ? colors.danger : '#B26A00'} />
                  <View style={{ flex: 1 }}>
                    <Text style={s_.itemText}>{a.kind === 'void' ? 'ยกเลิกบิล' : 'แก้ไขบิล'} {a.orderNo}</Text>
                    <Text style={s_.itemSub}>{thaiDateTime(a.createdAt)} · {PAYMENT_LABEL[a.method]}</Text>
                  </View>
                  <Text style={[s_.itemAmt, { color: a.amount >= 0 ? colors.primary : colors.danger }]}>
                    {a.amount >= 0 ? '+' : '−'}{baht(Math.abs(a.amount))}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          <Text style={s_.section}>บิลในกะนี้ ({d.orders.length})</Text>
          {d.orders.length === 0 ? <Text style={s_.empty}>ยังไม่มีบิล</Text> : null}
          {d.orders.slice(0, 50).map((o) => (
            <View key={o.id} style={s_.item}>
              <Text style={[s_.itemText, { flex: 1 }, o.status === 'void' && s_.strike]}>{o.orderNo}</Text>
              <Text style={s_.itemSub}>{o.createdAt.slice(11, 16)} · {PAYMENT_LABEL[o.paymentMethod]}</Text>
              <Text style={[s_.itemAmt, { minWidth: 90 }, o.status === 'void' && s_.strike]}>{baht(o.total)}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

function Line({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return (
    <View style={s_.line}>
      <Text style={[s_.lineText, bold && { fontWeight: '700' }]}>{l}</Text>
      <Text style={[s_.lineText, bold && { fontWeight: '700' }]}>{r}</Text>
    </View>
  );
}

const s_ = StyleSheet.create({
  error: { fontFamily: font, color: colors.danger, textAlign: 'center', marginVertical: 20 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md },
  vTitle: { fontFamily: font, fontSize: 16, fontWeight: '700' },
  vSub: { fontFamily: font, fontSize: 12, color: colors.sub, marginTop: 2 },
  vDiff: { fontFamily: font, fontSize: 18, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  card: { flexGrow: 1, flexBasis: 240, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 6 },
  cardTitle: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  lineText: { fontFamily: font, fontSize: 13, color: colors.text },
  sep: { borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginVertical: 2 },
  small: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 2 },
  note: { marginTop: 10, padding: 12, borderRadius: radius.md, backgroundColor: '#FFF8EA', gap: 4 },
  noteText: { fontFamily: font, fontSize: 12, color: '#7A5300' },
  section: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 16, marginBottom: 6 },
  denoms: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  denom: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line },
  denomText: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text },
  denomSub: { fontFamily: font, fontSize: 10, color: colors.sub },
  empty: { fontFamily: font, fontSize: 12, color: colors.faint },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  itemText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  itemSub: { fontFamily: font, fontSize: 11, color: colors.sub },
  itemAmt: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.text, textAlign: 'right' },
  strike: { textDecorationLine: 'line-through', color: colors.faint },
  btn: { height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnText: { fontFamily: font, fontSize: 14, color: colors.text, fontWeight: '500' },
});
