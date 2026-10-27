// หน้าเข้าสู่ระบบด้วย PIN 6 หลัก
import { Credit } from '../components/Credit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { thaiDate, thaiTime } from '../format';
import { auth, type Me } from '../session';
import { colors, font } from '../theme';

export const PIN_LENGTH = 6;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

/** หน้าเข้าสู่ระบบด้วย PIN 6 หลัก (กดครบ 6 หลักแล้วเข้าสู่ระบบอัตโนมัติ) */
export function LoginScreen({ onLogin }: { onLogin: (me: Me) => void }) {
  const { width, height } = useWindowDimensions();
  const compact = height < 700 || width < 400;
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const busyRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const submit = useCallback(
    async (p: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const r = await api.login(p);
        auth.set(r.token);
        onLogin(r.staff);
      } catch (e) {
        setError((e as Error).message);
        setPin('');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onLogin],
  );

  const press = useCallback(
    (k: (typeof KEYS)[number]) => {
      if (busyRef.current) return;
      setError(null);
      if (k === 'clear') return setPin('');
      if (k === 'back') return setPin((p) => p.slice(0, -1));
      setPin((p) => {
        if (p.length >= PIN_LENGTH) return p;
        const next = p + k;
        if (next.length === PIN_LENGTH) setTimeout(() => submit(next), 80);
        return next;
      });
    },
    [submit],
  );

  // คีย์บอร์ด (เว็บ): ตัวเลข / Backspace / Esc
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key as (typeof KEYS)[number]);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Escape') press('clear');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const keySize = compact ? 58 : 68;

  return (
    <View style={s.root}>
      <View style={[s.card, compact && { paddingVertical: 20 }]}>
        <View style={s.brandRow}>
          <View style={s.logo}>
            <Icon name="shirt-outline" size={22} color="#fff" />
          </View>
          <View>
            <Text style={s.brand}>Clothing POS</Text>
            <Text style={s.brandSub}>
              {thaiDate(now)} · {thaiTime(now)} น.
            </Text>
          </View>
        </View>

        <Text style={s.title}>เข้าสู่ระบบ</Text>
        <Text style={s.sub}>กรอก PIN พนักงาน {PIN_LENGTH} หลัก</Text>

        <View style={s.dots} accessibilityLabel={`กรอกแล้ว ${pin.length} จาก ${PIN_LENGTH} หลัก`}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View key={i} style={[s.dot, i < pin.length && s.dotOn, error && s.dotErr]} />
          ))}
        </View>
        <View style={s.msg}>
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : error ? (
            <Text style={s.error}>{error}</Text>
          ) : (
            <Text style={s.hint}>ใช้แป้นตัวเลขด้านล่าง หรือคีย์บอร์ด</Text>
          )}
        </View>

        <View style={[s.pad, { width: keySize * 3 + 28 }]}>
          {KEYS.map((k) => (
            <Pressable
              key={k}
              onPress={() => press(k)}
              disabled={busy}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                s.key,
                { width: keySize, height: keySize, borderRadius: keySize / 2 },
                (k === 'clear' || k === 'back') && s.keyAlt,
                hovered && s.keyHover,
                pressed && s.keyPressed,
              ]}
              accessibilityLabel={k === 'clear' ? 'ล้าง' : k === 'back' ? 'ลบ' : k}
            >
              {k === 'back' ? (
                <Icon name="backspace-outline" size={22} color={colors.text} />
              ) : k === 'clear' ? (
                <Text style={s.keyAltText}>ล้าง</Text>
              ) : (
                <Text style={s.keyText}>{k}</Text>
              )}
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={s.footer}>ลืม PIN? ติดต่อผู้จัดการร้านเพื่อตั้ง PIN ใหม่</Text>
      <Credit center />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 14 },
  card: { width: 380, maxWidth: '100%', backgroundColor: colors.panel, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 28, alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  logo: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: font, fontSize: 16, fontWeight: '700', color: colors.primary, fontStyle: 'italic' },
  brandSub: { fontFamily: font, fontSize: 11, color: colors.sub },
  title: { fontFamily: font, fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 22 },
  sub: { fontFamily: font, fontSize: 13, color: colors.sub, marginTop: 2 },
  dots: { flexDirection: 'row', gap: 14, marginTop: 20 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.line, backgroundColor: '#fff' },
  dotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dotErr: { borderColor: colors.danger },
  msg: { height: 36, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, textAlign: 'center' },
  hint: { fontFamily: font, fontSize: 11, color: colors.faint },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginTop: 6 },
  key: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  keyAlt: { backgroundColor: 'transparent' },
  keyHover: { backgroundColor: '#E9EDF5' },
  keyPressed: { backgroundColor: colors.primarySoft, transform: [{ scale: 0.95 }] },
  keyText: { fontFamily: font, fontSize: 24, fontWeight: '500', color: colors.text },
  keyAltText: { fontFamily: font, fontSize: 14, color: colors.sub },
  footer: { fontFamily: font, fontSize: 12, color: colors.sub },
});
