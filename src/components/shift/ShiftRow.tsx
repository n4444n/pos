import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { baht, duration, signedBaht, VERDICT } from '../../format';
import { colors, font, radius } from '../../theme';
import type { Shift } from '../../types';
import { Icon } from '../Icon';

const thDate = (s: string) => {
  const [y, mo, d] = s.slice(0, 10).split('-');
  return `${d}/${mo}/${Number(y) + 543}`;
};
const hhmm = (s: string) => s.slice(11, 16);

interface Props {
  shift: Shift;
  /** 'wide' = 1 แถวแนวนอนตามแบบ, 'stack' = การ์ดซ้อนแนวตั้ง (มือถือ) */
  layout: 'wide' | 'stack';
  onPress: (s: Shift) => void;
}

/** 1 แถวของกะ: ช่วงเวลา | กะ/บิล | เข้า-ออกกะ-ส่วนต่าง | นำเข้า-ขาย-สรุป | ผล | ยอดขายรวม */
function ShiftRowImpl({ shift: s, layout, onPress }: Props) {
  const v = VERDICT[s.verdict];
  const open = s.status === 'open';
  const stack = layout === 'stack';
  const diffColor = s.diff == null ? colors.faint : s.diff === 0 ? '#E0457B' : s.diff > 0 ? '#B26A00' : colors.danger;

  const time = (
    <View style={[s_.block, stack ? s_.blockStack : { flex: 1.5 }]}>
      <KV k="ตั้งแต่" v={thDate(s.openedAt)} k2="เวลา" v2={hhmm(s.openedAt)} />
      <KV k="ถึง" v={s.closedAt ? thDate(s.closedAt) : '—'} k2="เวลา" v2={s.closedAt ? hhmm(s.closedAt) : 'ยังไม่ปิด'} />
      <View style={s_.kv}>
        <Text style={s_.k}>รวมเวลา</Text>
        <Text style={[s_.v, { color: '#1E9BD7' }]}>{duration(s.minutes)}</Text>
      </View>
    </View>
  );

  const shiftNo = (
    <View style={[s_.block, s_.center, stack ? s_.blockStack : { flex: 0.8 }]}>
      <Text style={s_.no}># {s.shiftNo}</Text>
      <Text style={s_.bills}>{s.billCount} รายการ</Text>
      <Text style={s_.by} numberOfLines={1}>{s.openedBy.replace('พนักงาน: ', '')}</Text>
    </View>
  );

  const drawer = (
    <View style={[s_.block, stack ? s_.blockStack : { flex: 1.3 }]}>
      <Money k="เข้ากะ" v={baht(s.openingCash)} />
      <Money k="ออกกะ" v={s.countedCash != null ? baht(s.countedCash) : open ? `(ควรมี ${baht(s.expectedCash)})` : '—'} dim={open} />
      <Money k="ส่วนต่าง" v={s.diff != null ? signedBaht(s.diff) : '—'} kColor="#E0457B" vColor={diffColor} />
    </View>
  );

  const flow = (
    <View style={[s_.block, stack ? s_.blockStack : { flex: 1.3 }]}>
      <Money k="นำเข้า/นำออก" v={signedBaht(s.cashIn - s.cashOut)} />
      <Money k="เงินสด (ขาย)" v={baht(s.cashSales)} />
      <Money k="สรุปยอด" v={baht(s.netCash)} kColor="#139A8C" vColor="#139A8C" />
    </View>
  );

  const status = (
    <View style={[s_.status, { backgroundColor: v.bg }, stack ? s_.statusStack : { width: 170 }]}>
      <Icon name={v.icon} size={stack ? 22 : 28} color={v.fg} />
      <Text style={[s_.statusText, { color: v.fg }]}>{v.label}</Text>
      {s.diff ? <Text style={[s_.statusSub, { color: v.fg }]}>{s.diff > 0 ? '+' : '−'}{baht(Math.abs(s.diff))}</Text> : null}
      {s.tenderDiff ? (
        <Text style={[s_.statusSub, { color: s.tenderDiff > 0 ? '#B26A00' : colors.danger }]}>
          บัตร/สแกนจ่าย {s.tenderDiff > 0 ? '+' : '−'}{baht(Math.abs(s.tenderDiff))}
        </Text>
      ) : null}
    </View>
  );

  const total = (
    <View style={[s_.totalCell, stack ? s_.totalStack : { width: 120 }]}>
      <Text style={s_.totalLabel}>ยอดขายรวม</Text>
      <Text style={s_.total}>{baht(s.totalSales)}</Text>
    </View>
  );

  return (
    <Pressable
      onPress={() => onPress(s)}
      style={({ hovered }: { hovered?: boolean }) => [s_.row, stack && s_.rowStack, open && s_.rowOpen, hovered && s_.hover]}
      accessibilityLabel={`กะที่ ${s.shiftNo} ${v.label}`}
    >
      {stack ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
            {shiftNo}
            {status}
          </View>
          {time}
          {drawer}
          {flow}
          {total}
        </>
      ) : (
        <>
          {time}
          {shiftNo}
          {drawer}
          {flow}
          {status}
          {total}
        </>
      )}
    </Pressable>
  );
}

export const ShiftRow = memo(ShiftRowImpl);

function KV({ k, v, k2, v2 }: { k: string; v: string; k2: string; v2: string }) {
  return (
    <View style={s_.kv}>
      <Text style={s_.k}>{k}</Text>
      <Text style={s_.v}>{v}</Text>
      <Text style={[s_.k, { marginLeft: 10 }]}>{k2}</Text>
      <Text style={s_.v}>{v2}</Text>
    </View>
  );
}

function Money({ k, v, kColor, vColor, dim }: { k: string; v: string; kColor?: string; vColor?: string; dim?: boolean }) {
  return (
    <View style={s_.kv}>
      <Text style={[s_.k, kColor ? { color: kColor, fontWeight: '600' } : null]}>{k}</Text>
      <Text style={[s_.v, vColor ? { color: vColor } : null, dim && { color: colors.sub, fontWeight: '400', fontSize: 12 }]} numberOfLines={1}>{v}</Text>
    </View>
  );
}

const s_ = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#F7F8FC', borderRadius: radius.md, marginBottom: 8, overflow: 'hidden', minHeight: 92 },
  rowStack: { flexDirection: 'column' },
  rowOpen: { borderWidth: 1.5, borderColor: '#BBD0FF' },
  hover: { backgroundColor: '#F0F4FF' },
  block: { paddingVertical: 10, paddingHorizontal: 14, gap: 4, justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#ECEEF3' },
  blockStack: { borderRightWidth: 0, borderTopWidth: 1, borderTopColor: '#ECEEF3' },
  center: { alignItems: 'center' },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  k: { fontFamily: font, fontSize: 13, color: colors.text },
  v: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.text, textAlign: 'right', flexShrink: 1 },
  no: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  bills: { fontFamily: font, fontSize: 13, color: colors.text },
  by: { fontFamily: font, fontSize: 11, color: colors.sub },
  status: { alignItems: 'center', justifyContent: 'center', gap: 4, padding: 10 },
  statusStack: { flex: 1.4, flexDirection: 'row', gap: 8 },
  statusText: { fontFamily: font, fontSize: 13, fontWeight: '700' },
  statusSub: { fontFamily: font, fontSize: 12, fontWeight: '600' },
  totalCell: { alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 14, gap: 2 },
  totalStack: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#ECEEF3' },
  totalLabel: { fontFamily: font, fontSize: 11, color: colors.sub },
  total: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text },
});
