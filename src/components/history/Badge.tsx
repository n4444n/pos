import { StyleSheet, Text, View } from 'react-native';
import { STATUS_LABEL, STATUS_TONE } from '../../format';
import { font, radius } from '../../theme';
import type { OrderStatus } from '../../types';

/** ป้ายสถานะบิล: ชำระแล้ว / แก้ไขแล้ว (×n) / ยกเลิก */
export function Badge({ status, edits }: { status: OrderStatus; edits?: number }) {
  const tone = STATUS_TONE[status];
  return (
    <View style={[s.badge, { backgroundColor: tone.bg }]}>
      <Text style={[s.text, { color: tone.fg }]} numberOfLines={1}>
        {STATUS_LABEL[status]}
        {status === 'edited' && edits && edits > 1 ? ` ×${edits}` : ''}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  text: { fontFamily: font, fontSize: 11, fontWeight: '600' },
});
