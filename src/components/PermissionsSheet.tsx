// การจัดการสิทธิ์ — เลือกว่าแต่ละบทบาทเห็น/แก้ไข/ใช้งานเมนูไหนได้บ้าง
// เปิดจากปุ่มในหน้า พนักงาน · ผู้ดูแลระบบได้ทุกสิทธิ์เสมอ (แก้ไม่ได้ กันล็อกตัวเองออกจากระบบ)
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, type PermCatalog } from '../api';
import { useSession, type Feature, type PermLevel, type Role } from '../session';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const LEVELS: { id: PermLevel; label: string; short: string; color: string; bg: string }[] = [
  { id: 'none', label: 'ไม่เห็นเมนู', short: 'ไม่เห็น', color: colors.sub, bg: colors.surface },
  { id: 'view', label: 'ดูอย่างเดียว', short: 'ดูได้', color: '#B26A00', bg: '#FFF4E0' },
  { id: 'edit', label: 'แก้ไขได้', short: 'แก้ไขได้', color: colors.success, bg: colors.successSoft },
];

export function PermissionsSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved?: () => void }) {
  const { me } = useSession();
  const readOnly = me.perms?.staff !== 'edit';
  const [data, setData] = useState<PermCatalog | null>(null);
  const [role, setRole] = useState<Role>('manager');
  const [draft, setDraft] = useState<Record<Feature, PermLevel> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.perms();
      setData(d);
      setDraft(d.perms[role]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [role]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const pickRole = (r: Role) => {
    setRole(r);
    setSaved(false);
    if (data) setDraft(data.perms[r]);
  };
  const fixed = data?.roles.find((r) => r.id === role)?.fixed ?? false;
  const locked = fixed || readOnly;
  const dirty = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.perms[role]);

  const set = (f: Feature, lv: PermLevel) => {
    if (locked) return;
    setSaved(false);
    setDraft((d) => (d ? { ...d, [f]: lv } : d));
  };

  const run = async (fn: () => Promise<PermCatalog['perms']>) => {
    setBusy(true);
    setError(null);
    try {
      const perms = await fn();
      setData((d) => (d ? { ...d, perms } : d));
      setDraft(perms[role]);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // จัดเมนูเป็นกลุ่มตามที่เซิร์ฟเวอร์ส่งมา
  const groups: { name: string; items: PermCatalog['features'] }[] = [];
  for (const f of data?.features ?? []) {
    const g = groups.find((x) => x.name === f.group);
    if (g) g.items.push(f);
    else groups.push({ name: f.group, items: [f] });
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="การจัดการสิทธิ์"
      width={620}
      footer={
        locked ? (
          <Text style={[s.hint, { textAlign: 'center' }]}>
            {fixed ? 'ผู้ดูแลระบบได้ทุกสิทธิ์เสมอ — แก้ไขไม่ได้' : 'บทบาทของคุณดูสิทธิ์ได้อย่างเดียว'}
          </Text>
        ) : (
          <View style={s.footRow}>
            <Pressable style={s.ghostBtn} disabled={busy} onPress={() => run(() => api.resetPerms(role))}>
              <Text style={s.ghostText}>คืนค่าเริ่มต้น</Text>
            </Pressable>
            <Text style={[s.hint, { flex: 1 }]}>{saved && !dirty ? 'บันทึกแล้ว' : dirty ? 'ยังไม่ได้บันทึก' : ' '}</Text>
            <Pressable
              style={[s.saveBtn, (!dirty || busy) && { opacity: 0.45 }]}
              disabled={!dirty || busy}
              onPress={() => run(() => api.savePerms(role, draft as Record<string, PermLevel>))}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>บันทึกสิทธิ์</Text>}
            </Pressable>
          </View>
        )
      }
    >
      {!data || !draft ? (
        <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} />
      ) : (
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 10, paddingBottom: 6 }}>
          <Text style={s.hint}>เลือกบทบาท แล้วกำหนดว่าแต่ละเมนูให้ทำอะไรได้ — มีผลกับพนักงานทุกคนที่อยู่ในบทบาทนั้น</Text>

          <View style={s.roleRow}>
            {data.roles.map((r) => {
              const on = r.id === role;
              return (
                <Pressable key={r.id} onPress={() => pickRole(r.id)} style={[s.roleChip, on && s.roleChipOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                  <Icon name={r.fixed ? 'shield-checkmark-outline' : 'person-outline'} size={15} color={on ? '#fff' : colors.sub} />
                  <Text style={[s.roleText, on && { color: '#fff', fontWeight: '700' }]}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.roleDesc}>{data.roles.find((r) => r.id === role)?.desc}</Text>

          {groups.map((g) => (
            <View key={g.name} style={{ gap: 8 }}>
              <Text style={s.group}>{g.name}</Text>
              {g.items.map((f) => (
                <View key={f.id} style={s.row}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.label}>{f.label}</Text>
                    <Text style={s.hint}>{f.hint}</Text>
                  </View>
                  <View style={s.seg}>
                    {LEVELS.map((lv) => {
                      const on = (draft[f.id] ?? 'none') === lv.id;
                      return (
                        <Pressable
                          key={lv.id}
                          disabled={locked}
                          onPress={() => set(f.id, lv.id)}
                          style={[s.segItem, on && { backgroundColor: lv.bg, borderColor: lv.color }, locked && { opacity: 0.6 }]}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on, disabled: locked }}
                          accessibilityLabel={`${f.label} — ${lv.label}`}
                        >
                          <Text style={[s.segText, on && { color: lv.color, fontWeight: '700' }]}>{lv.short}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ))}

          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  hint: { fontFamily: font, fontSize: 12, color: colors.sub, lineHeight: 18 },
  roleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingVertical: 2 },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  roleChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleText: { fontFamily: font, fontSize: 13, color: colors.text },
  roleDesc: { fontFamily: font, fontSize: 12, color: colors.sub, marginTop: -4 },
  group: { fontFamily: font, fontSize: 12, fontWeight: '700', color: colors.faint, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  label: { fontFamily: font, fontSize: 14, color: colors.text, fontWeight: '600' },
  seg: { flexDirection: 'row', gap: 4 },
  segItem: { paddingHorizontal: 10, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  segText: { fontFamily: font, fontSize: 12, color: colors.sub },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ghostBtn: { height: 44, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  ghostText: { fontFamily: font, fontSize: 13, color: colors.text },
  saveBtn: { height: 44, paddingHorizontal: 20, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 8 },
});
