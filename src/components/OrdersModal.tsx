// หน้าขาย: บิลล่าสุดของเครื่องนี้ (ดู/พิมพ์ซ้ำ)
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { baht, PAYMENT_LABEL } from '../format';
import { colors, font, radius } from '../theme';
import type { Order } from '../types';
import { Icon } from './Icon';
import { ReceiptView } from './ReceiptView';
import { Sheet } from './Sheet';

/** ประวัติการขายล่าสุด (Track Order) */
export function OrdersModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    setOrders(null);
    setError(null);
    api.orders(30).then(setOrders).catch((e: Error) => setError(e.message));
  }, [visible]);

  const today = orders?.reduce((s, o) => s + o.total, 0) ?? 0;

  return (
    <Sheet visible={visible} onClose={onClose} title="รายการขายล่าสุด" width={560}>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!orders && !error ? <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} /> : null}
      {orders && orders.length === 0 ? <Text style={s.empty}>ยังไม่มีการขาย</Text> : null}
      {orders && orders.length > 0 ? (
        <>
          <View style={s.summary}>
            <Text style={s.summaryText}>{orders.length} บิลล่าสุด</Text>
            <Text style={s.summaryVal}>{baht(today)}</Text>
          </View>
          <ScrollView style={{ maxHeight: 460 }}>
            {orders.map((o) => {
              const expanded = open === o.id;
              return (
                <View key={o.id} style={s.card}>
                  <Pressable style={s.row} onPress={() => setOpen(expanded ? null : o.id)}>
                    <View style={s.okDot}>
                      <Icon name="checkmark" size={14} color={colors.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.no}>{o.orderNo}</Text>
                      <Text style={s.sub}>
                        {o.createdAt?.slice(11, 16)} น. · {o.items.reduce((s2, i) => s2 + i.qty, 0)} ชิ้น · {PAYMENT_LABEL[o.paymentMethod]}
                        {o.customerName ? ` · ${o.customerName}` : ''}
                      </Text>
                    </View>
                    <Text style={s.total}>{baht(o.total)}</Text>
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.sub} />
                  </Pressable>
                  {expanded ? (
                    <View style={s.detail}>
                      <ReceiptView order={o} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  error: { fontFamily: font, color: colors.danger, textAlign: 'center', marginVertical: 20 },
  empty: { fontFamily: font, color: colors.sub, textAlign: 'center', marginVertical: 30 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.primarySoft, padding: 12, borderRadius: radius.md, marginBottom: 10 },
  summaryText: { fontFamily: font, color: colors.primary, fontSize: 13 },
  summaryVal: { fontFamily: font, color: colors.primary, fontSize: 15, fontWeight: '700' },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  okDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' },
  no: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  sub: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 1 },
  total: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  detail: { paddingHorizontal: 14, paddingBottom: 12 },
});
