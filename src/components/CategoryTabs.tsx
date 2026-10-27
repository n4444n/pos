// หน้าขาย: แถบหมวดหมู่สินค้า
import { memo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDragScroll } from '../dragScroll';
import { colors, font, radius } from '../theme';
import type { Category } from '../types';
import { GarmentArt } from './GarmentArt';
import { Icon } from './Icon';

interface Props {
  categories: Category[];
  counts: Map<string, number>;
  total: number;
  active: string;
  onChange: (id: string) => void;
  compact?: boolean;
}

function Tab({ label, count, active, onPress, icon, compact }: { label: string; count: number; active: boolean; onPress: () => void; icon: ReactNode; compact?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [s.tab, compact && s.tabCompact, active && s.tabActive, hovered && !active && s.tabHover, pressed && { opacity: 0.85 }]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <View style={[s.iconWrap, active && s.iconWrapActive]}>{icon}</View>
      <View>
        <Text style={s.label} numberOfLines={1}>{label}</Text>
        <Text style={s.count}>{count} รายการ</Text>
      </View>
    </Pressable>
  );
}

function CategoryTabsImpl({ categories, counts, total, active, onChange: change, compact }: Props) {
  // กดเมาส์ซ้ายค้างแล้วลากซ้าย-ขวาเพื่อเลื่อนแถบหมวดหมู่ · ถ้าเพิ่งลากจะไม่นับเป็นการเลือกหมวด
  const { ref, wasDragged } = useDragScroll();
  const onChange = (id: string) => {
    if (!wasDragged()) change(id);
  };
  return (
    // flexGrow: 0 สำคัญ — ScrollView บนเว็บมี flexGrow: 1 เป็นค่าเริ่มต้น ทำให้ยืดกินพื้นที่แนวตั้ง (เกิดช่องว่าง)
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} style={s.scroller} contentContainerStyle={s.row}>
      <Tab
        label="ทั้งหมด"
        count={total}
        active={active === 'all'}
        compact={compact}
        onPress={() => onChange('all')}
        icon={<Icon name="grid-outline" size={18} color={active === 'all' ? '#fff' : colors.sub} />}
      />
      {categories.map((c) => (
        <Tab
          key={c.id}
          label={c.name}
          count={counts.get(c.id) ?? 0}
          active={active === c.id}
          compact={compact}
          onPress={() => onChange(c.id)}
          icon={<GarmentArt art={c.icon} color={active === c.id ? '#ffffff' : colors.sub} size={20} outline />}
        />
      ))}
    </ScrollView>
  );
}

export const CategoryTabs = memo(CategoryTabsImpl);

const s = StyleSheet.create({
  scroller: { flexGrow: 0, flexShrink: 0 },
  row: { gap: 10, paddingVertical: 2 },
  tab: {
    width: 128, height: 92, padding: 12, borderRadius: radius.md, backgroundColor: colors.panel,
    justifyContent: 'space-between', borderWidth: 1.5, borderColor: 'transparent',
  },
  tabCompact: { width: 108, height: 80, padding: 10 },
  tabHover: { borderColor: colors.line },
  tabActive: { borderColor: colors.primary, backgroundColor: '#F7F9FF' },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  iconWrapActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { fontFamily: font, fontSize: 13, fontWeight: '500', color: colors.text },
  count: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 1 },
});
