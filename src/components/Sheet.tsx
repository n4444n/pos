// กล่อง dialog กลางจอ — ใช้ร่วมกันทุกหน้าต่าง
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}

/** กล่อง dialog กลางจอ ใช้ร่วมกันทุก modal */
export function Sheet({ visible, onClose, title, width = 460, children, footer }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="ปิด" />
        <View style={[s.card, { width, maxWidth: '94%' }]}>
          {title ? (
            <View style={s.header}>
              <Text style={s.title}>{title}</Text>
              <Pressable onPress={onClose} style={s.close} hitSlop={8} accessibilityLabel="ปิด">
                <Icon name="close" size={20} color={colors.sub} />
              </Pressable>
            </View>
          ) : null}
          <View style={s.body}>{children}</View>
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.42)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.panel, borderRadius: radius.xl, maxHeight: '92%', overflow: 'hidden' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 22, paddingTop: 18, paddingBottom: 6,
  },
  title: { fontFamily: font, fontSize: 18, fontWeight: '600', color: colors.text },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  body: { paddingHorizontal: 22, paddingVertical: 12, flexShrink: 1 },
  footer: { paddingHorizontal: 22, paddingBottom: 20, paddingTop: 8 },
});
