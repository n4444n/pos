import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

interface Props {
  placeholder: string;
  value: string | null;
  options: string[];
  icon: IconName;
  onChange: (v: string | null) => void;
}

export function Select({ placeholder, value, options, icon, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={s.select} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={placeholder}>
        <Text style={[s.text, !value && { color: colors.sub }]} numberOfLines={1}>{value ?? placeholder}</Text>
        <Icon name="caret-down" size={12} color={colors.text} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={placeholder} width={360}>
        <View style={{ gap: 6, paddingBottom: 8 }}>
          {options.map((o) => {
            const on = o === value;
            return (
              <Pressable key={o} style={[s.opt, on && s.optOn]} onPress={() => { onChange(o); setOpen(false); }}>
                <Icon name={icon} size={18} color={on ? colors.primary : colors.sub} />
                <Text style={[s.optText, on && { color: colors.primary, fontWeight: '600' }]}>{o}</Text>
                {on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
          {value ? (
            <Pressable style={s.clear} onPress={() => { onChange(null); setOpen(false); }}>
              <Text style={s.clearText}>ล้างค่า</Text>
            </Pressable>
          ) : null}
        </View>
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  select: {
    flex: 1, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  },
  text: { fontFamily: font, fontSize: 13, color: colors.text, flexShrink: 1 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 46, borderRadius: radius.md, backgroundColor: colors.surface },
  optOn: { backgroundColor: colors.primarySoft },
  optText: { fontFamily: font, fontSize: 14, color: colors.text, flex: 1 },
  clear: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  clearText: { fontFamily: font, fontSize: 13, color: colors.sub },
});
