import { StyleSheet, Text, View } from 'react-native';
import { useAppSettings } from '../appSettings';
import { baht, variantLabel } from '../format';
import { parseLocal, receiptText } from '../receiptText';
import { colors, font } from '../theme';
import type { Order } from '../types';

/** ใบเสร็จแบบย่อ ใช้ทั้งหลังขายและในประวัติออเดอร์ */
export function ReceiptView({ order, compact }: { order: Order; compact?: boolean }) {
  const { t, pay, vat, date } = receiptText(useAppSettings().receipt); // ภาษาเดียวกับใบเสร็จที่พิมพ์
  return (
    <View>
      {!compact ? (
        <View style={s.meta}>
          <Row l={t('orderNo')} r={order.orderNo} />
          {order.createdAt ? <Row l={t('date')} r={date(parseLocal(order.createdAt))} /> : null}
          {order.customerName ? <Row l={t('customer')} r={order.customerName} /> : null}
          {order.salesperson ? <Row l={t('staff')} r={order.salesperson} /> : null}
          <Row l={t('orderType')} r={order.orderType} />
        </View>
      ) : null}
      <View style={s.items}>
        {order.items.map((it, i) => (
          <View key={i} style={s.item}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{it.name}</Text>
              <Text style={s.sub}>{variantLabel(it)} · {it.qty} × {baht(it.unitPrice)}</Text>
            </View>
            <Text style={s.amount}>{baht(it.lineTotal)}</Text>
          </View>
        ))}
      </View>
      <View style={s.sum}>
        <Row l={t('subtotal')} r={baht(order.subtotal)} />
        {order.discount > 0 ? <Row l={`${t('discount')} (${order.promoCode})`} r={`−${baht(order.discount)}`} accent /> : null}
        {order.fee && order.feePayer === 'customer' ? <Row l={`${t('fee')} ${pay(order.paymentMethod)}`} r={`+${baht(order.fee)}`} /> : null}
        {order.vat > 0 ? <Row l={vat(order)} r={baht(order.vat)} small /> : null}
        <View style={s.totalRow}>
          <Text style={s.totalL}>{t('total')}</Text>
          <Text style={s.totalR}>{baht(order.total)}</Text>
        </View>
        <Row l={`${t('paidBy')} ${pay(order.paymentMethod)}`} r={order.cashReceived != null ? baht(order.cashReceived) : ''} />
        {order.changeDue != null ? <Row l={t('change')} r={baht(order.changeDue)} accent /> : null}
      </View>
    </View>
  );
}

function Row({ l, r, small, accent }: { l: string; r: string; small?: boolean; accent?: boolean }) {
  const st = [small ? s.small : s.row, accent && { color: colors.success }];
  return (
    <View style={s.rowWrap}>
      <Text style={st}>{l}</Text>
      <Text style={st}>{r}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  meta: { gap: 3, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line, borderStyle: 'dashed' },
  items: { paddingVertical: 8, gap: 8 },
  item: { flexDirection: 'row', gap: 10 },
  name: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  sub: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 1 },
  amount: { fontFamily: font, fontSize: 13, color: colors.text },
  sum: { borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', paddingTop: 10, gap: 4 },
  rowWrap: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  row: { fontFamily: font, fontSize: 13, color: colors.text },
  small: { fontFamily: font, fontSize: 11, color: colors.faint },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  totalL: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  totalR: { fontFamily: font, fontSize: 18, fontWeight: '700', color: colors.text },
});
