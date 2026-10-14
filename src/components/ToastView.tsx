import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';

export function ToastView({ toast, onDone }: { toast: Toast | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, toast.kind === 'error' ? 3500 : 2000);
    return () => clearTimeout(t);
  }, [toast, onDone]);

  if (!toast) return null;
  const tone =
    toast.kind === 'error'
      ? { bg: colors.danger, icon: 'alert-circle' as const }
      : toast.kind === 'success'
        ? { bg: colors.success, icon: 'checkmark-circle' as const }
        : { bg: colors.text, icon: 'information-circle' as const };
  return (
    <View pointerEvents="none" style={s.wrap}>
      <View style={[s.toast, { backgroundColor: tone.bg }]}>
        <Icon name={tone.icon} size={18} color="#fff" />
        <Text style={s.text}>{toast.text}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', top: 20, left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, maxWidth: 520 },
  text: { fontFamily: font, color: '#fff', fontSize: 13, fontWeight: '500' },
});
