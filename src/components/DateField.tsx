// ช่องเลือกวันที่ (input type=date บนเว็บ)
import { createElement } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';

interface Props {
  type: 'date' | 'time';
  value: string;
  onChange: (v: string) => void;
  label: string;
  width?: number;
  /** ยืดเต็มพื้นที่ (ใช้บนมือถือ) */
  grow?: boolean;
}

/**
 * ช่องเลือกวันที่/เวลา
 * - เว็บ: ใช้ <input type="date|time"> ของเบราว์เซอร์ (มีปฏิทินให้เลือก)
 * - native: ช่องพิมพ์ YYYY-MM-DD / HH:MM
 */
export function DateField({ type, value, onChange, label, width, grow }: Props) {
  return (
    <View style={[s.wrap, grow ? { flex: 1, minWidth: 0 } : width ? { width } : null]}>
      {Platform.OS === 'web' ? (
        createElement('input', {
          type,
          value,
          'aria-label': label,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          style: {
            border: 0, outline: 'none', background: 'transparent', fontFamily: font, fontSize: 13,
            color: value ? colors.text : colors.faint, flex: 1, minWidth: 0, width: '100%', height: '100%', padding: 0, cursor: 'pointer',
          },
        })
      ) : (
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={type === 'date' ? 'YYYY-MM-DD' : 'HH:MM'}
          style={s.input}
          accessibilityLabel={label}
        />
      )}
      {Platform.OS !== 'web' ? <Icon name={type === 'date' ? 'calendar-outline' : 'time-outline'} size={16} color={colors.primary} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  input: { flex: 1, fontFamily: font, fontSize: 13, color: colors.text },
});
