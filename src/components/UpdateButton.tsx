// ปุ่ม "อัปเดต vX.Y.Z" ของแอปเดสก์ท็อป + ป้ายเวอร์ชันท้ายเมนู
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { desktop, useDesktopUpdate } from '../desktop';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';

/**
 * ปุ่ม "อัปเดตเวอร์ชันใหม่" ของแอปเดสก์ท็อป
 * - กำลังดาวน์โหลด: แสดง % (กดไม่ได้)
 * - พร้อมติดตั้ง: กดแล้วยืนยัน → ปิดโปรแกรม ติดตั้ง แล้วเปิดใหม่
 * ไม่แสดงอะไรเมื่อเปิดผ่านเบราว์เซอร์ หรือไม่มีอัปเดต
 */
export function UpdateButton({ compact, block }: { compact?: boolean; block?: boolean }) {
  const u = useDesktopUpdate();
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  if (!u || u.status === 'idle' || !u.version) return null;

  if (u.status === 'downloading') {
    return (
      <View style={[s.btn, s.dl, block && s.block]} accessibilityLabel={`กำลังดาวน์โหลดเวอร์ชัน ${u.version}`}>
        <Icon name="cloud-download-outline" size={16} color={colors.sub} />
        <Text style={[s.text, { color: colors.sub }]} numberOfLines={1}>
          {compact ? `${Math.floor(u.percent)}%` : `ดาวน์โหลด v${u.version} · ${Math.floor(u.percent)}%`}
        </Text>
      </View>
    );
  }

  if (u.status === 'installing') {
    return (
      <View style={[s.btn, s.dl, block && s.block]} accessibilityLabel="กำลังติดตั้งอัปเดต">
        <ActivityIndicator size="small" color={colors.sub} />
        <Text style={[s.text, { color: colors.sub }]} numberOfLines={1}>{compact ? 'ติดตั้ง…' : 'กำลังติดตั้ง — โปรแกรมจะปิดแล้วเปิดใหม่'}</Text>
      </View>
    );
  }

  const install = async () => {
    setInstalling(true);
    const ok = await desktop()?.update?.install().catch(() => false);
    if (!ok) setInstalling(false);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ hovered }: { hovered?: boolean }) => [s.btn, s.ready, block && s.block, hovered && { backgroundColor: '#178A55' }]}
        accessibilityLabel={`อัปเดตเป็นเวอร์ชัน ${u.version}`}
      >
        <Icon name="arrow-up-circle-outline" size={17} color="#fff" />
        <Text style={[s.text, { color: '#fff' }]} numberOfLines={1}>{compact ? 'อัปเดต' : `อัปเดต v${u.version}`}</Text>
        <View style={s.dot} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => !installing && setOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.card}>
            <View style={s.iconWrap}>
              <Icon name="arrow-up-circle-outline" size={30} color={colors.success} />
            </View>
            <Text style={s.title}>มีเวอร์ชันใหม่พร้อมติดตั้ง</Text>
            <View style={s.verRow}>
              <Text style={s.verOld}>v{u.current}</Text>
              <Icon name="arrow-forward" size={16} color={colors.sub} />
              <Text style={s.verNew}>v{u.version}</Text>
            </View>
            {/* รายละเอียดอัปเดตแบบสั้น ๆ เป็นข้อ ๆ (มาจากข้อความ commit ของเวอร์ชันนั้น) */}
            <View style={s.notes}>
              <Text style={s.notesTitle}>มีอะไรใหม่</Text>
              {(u.notes?.length ? u.notes : ['ปรับปรุงการทำงานและแก้ไขข้อผิดพลาด']).map((n, i) => (
                <View key={i} style={s.noteRow}>
                  <Text style={s.noteDot}>•</Text>
                  <Text style={s.noteText}>{n}</Text>
                </View>
              ))}
            </View>
            <Text style={s.hint}>โปรแกรมจะปิดแล้วเปิดใหม่เอง ควรอัปเดตตอนไม่มีลูกค้า</Text>
            <View style={s.actions}>
              {!u.forced ? (
                <Pressable style={[s.action, s.later]} onPress={() => setOpen(false)} disabled={installing}>
                  <Text style={[s.actionText, { color: colors.text }]}>ภายหลัง</Text>
                </Pressable>
              ) : null}
              <Pressable style={[s.action, s.now, installing && { opacity: 0.7 }]} onPress={install} disabled={installing}>
                {installing ? <ActivityIndicator color="#fff" size="small" /> : null}
                <Text style={[s.actionText, { color: '#fff' }]}>{installing ? 'กำลังติดตั้ง…' : 'อัปเดตตอนนี้'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** ป้ายเวอร์ชันแอปเดสก์ท็อป (ท้ายเมนู) */
export function AppVersionChip({ style }: { style: StyleProp<TextStyle> }) {
  const v = desktop()?.version;
  return v ? <Text style={style}>แอป {v}</Text> : null;
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 44, borderRadius: radius.pill },
  block: { justifyContent: 'center', height: 40 },
  dl: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  ready: { backgroundColor: colors.success },
  text: { fontFamily: font, fontSize: 13, fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFD15C', marginLeft: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.42)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: 420, maxWidth: '100%', backgroundColor: colors.panel, borderRadius: radius.xl, padding: 24, alignItems: 'center', gap: 10 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: font, fontSize: 18, fontWeight: '700', color: colors.text },
  verRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  verOld: { fontFamily: font, fontSize: 15, color: colors.sub },
  verNew: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.success },
  hint: { fontFamily: font, fontSize: 12, color: colors.sub, textAlign: 'center' },
  notes: { alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14, gap: 4, marginTop: 4 },
  notesTitle: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub, marginBottom: 2 },
  noteRow: { flexDirection: 'row', gap: 8 },
  noteDot: { fontFamily: font, fontSize: 13, color: colors.success, lineHeight: 20 },
  noteText: { flex: 1, fontFamily: font, fontSize: 13, color: colors.text, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8, alignSelf: 'stretch' },
  action: { flex: 1, height: 44, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  later: { backgroundColor: colors.surface },
  now: { backgroundColor: colors.success },
  actionText: { fontFamily: font, fontSize: 14, fontWeight: '600' },
});
