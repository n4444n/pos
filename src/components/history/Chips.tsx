// ปุ่มเลือกแบบชิป + หัวข้อช่องกรอก (ใช้ในหน้าต่างของบิล)
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../../theme';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  tone?: string;
}

/** กลุ่มปุ่มเลือก (single select) */
export function Chips<T extends string>({ options, value, onChange, tone = colors.primary }: Props<T>) {
  return (
    <View style={s.wrap}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[s.chip, on && { backgroundColor: tone, borderColor: tone }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.text, on && s.textOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={s.label}>
      {children}
      {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
    </Text>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, minHeight: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  text: { fontFamily: font, fontSize: 12, color: colors.text },
  textOn: { color: '#fff', fontWeight: '600' },
  label: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text, marginTop: 12, marginBottom: 6 },
});
