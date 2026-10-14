import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { thaiDate, thaiTime } from '../format';
import { colors, font, radius } from '../theme';
import { BranchChip } from './BranchPicker';
import { Icon } from './Icon';

interface Props {
  onMenu: () => void;
  onCloseOrder: () => void;
  onRefresh: () => void;
  canClose: boolean;
  /** จอแคบ: ซ่อนวันที่ แสดงแต่ปุ่มไอคอน */
  compact?: boolean;
  /** สถานะกะ: true = เปิดอยู่ (แสดง "ปิดกะทำงาน"), false = ยังไม่เปิด (แสดง "เปิดกะ") */
  shiftOpen: boolean;
  onShift: () => void;
  /** พักบิล: จำนวนบิลที่พักไว้ · เปิดหน้าต่างพัก/เรียกคืน · มีสินค้าในตะกร้า */
  heldCount?: number;
  onHeld?: () => void;
  canHold?: boolean;
}

function Clock({ compact }: { compact?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={s.row}>
      {!compact ? (
        <>
          <View style={s.pill}>
            <View style={s.iconDot}>
              <Icon name="calendar-outline" size={15} color={colors.primary} />
            </View>
            <Text style={s.pillText}>{thaiDate(now)}</Text>
          </View>
          <Text style={s.dash}>–</Text>
        </>
      ) : null}
      <View style={s.pill}>
        <View style={s.iconDot}>
          <Icon name="time-outline" size={15} color={colors.primary} />
        </View>
        <Text style={s.pillText}>{thaiTime(now)} น.</Text>
      </View>
    </View>
  );
}

function TopBarImpl({ onMenu, onCloseOrder, onRefresh, canClose, compact, shiftOpen, onShift, heldCount = 0, onHeld, canHold }: Props) {
  return (
    <View style={s.bar}>
      <View style={s.row}>
        <Pressable style={s.menu} onPress={onMenu} accessibilityLabel="เมนู">
          <Icon name="menu-outline" size={24} color={colors.primary} />
        </Pressable>
        <BranchChip compact={compact} />
        <Clock compact={compact} />
      </View>
      <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }]}>
        {onHeld ? (
          <Pressable
            style={({ hovered }: { hovered?: boolean }) => [s.closeBtn, hovered && { backgroundColor: '#FFF7E8' }, !canHold && !heldCount && { opacity: 0.45 }]}
            onPress={onHeld}
            disabled={!canHold && !heldCount}
            accessibilityLabel={`พักบิล (${heldCount} บิลที่พักไว้)`}
          >
            <Icon name="pause-circle-outline" size={16} color="#B26A00" />
            <Text style={[s.closeText, { color: '#B26A00' }]}>{compact ? 'พัก' : canHold ? 'พักบิล' : 'บิลที่พักไว้'}</Text>
            {heldCount ? (
              <View style={s.badge}><Text style={s.badgeText}>{heldCount}</Text></View>
            ) : null}
          </Pressable>
        ) : null}
        <Pressable
          style={[s.closeBtn, !canClose && { opacity: 0.45 }]}
          onPress={onCloseOrder}
          disabled={!canClose}
          accessibilityLabel="ยกเลิกรายการ"
        >
          <View style={s.redDot} />
          <Text style={s.closeText}>{compact ? 'ยกเลิก' : 'ยกเลิกรายการ'}</Text>
        </Pressable>
        <Pressable
          style={({ hovered }: { hovered?: boolean }) => [s.closeBtn, hovered && { backgroundColor: shiftOpen ? '#EEF3FF' : '#E9F8F0' }]}
          onPress={onShift}
          accessibilityLabel={shiftOpen ? 'ปิดกะทำงาน' : 'เปิดกะ'}
        >
          <Icon name={shiftOpen ? 'lock-closed-outline' : 'lock-open-outline'} size={15} color={shiftOpen ? colors.primary : colors.success} />
          <Text style={[s.closeText, { color: shiftOpen ? colors.primary : colors.success }]}>
            {shiftOpen ? (compact ? 'ปิดกะ' : 'ปิดกะทำงาน') : 'เปิดกะ'}
          </Text>
        </Pressable>
        <Pressable style={s.round} onPress={onRefresh} accessibilityLabel="โหลดข้อมูลใหม่">
          <Icon name="refresh" size={18} color={colors.danger} />
        </Pressable>
      </View>
    </View>
  );
}

export const TopBar = memo(TopBarImpl);

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', rowGap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menu: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.panel,
    paddingLeft: 6, paddingRight: 14, height: 44, borderRadius: radius.pill,
  },
  iconDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  pillText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  dash: { color: colors.sub },
  closeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.panel,
    paddingHorizontal: 16, height: 44, borderRadius: radius.pill,
  },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: '#F5A524', alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: font, fontSize: 11, fontWeight: '700', color: '#fff' },
  redDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  closeText: { fontFamily: font, color: colors.danger, fontSize: 13, fontWeight: '500' },
  round: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel,
  },
});
