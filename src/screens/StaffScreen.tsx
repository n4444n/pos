// หน้า พนักงาน (ผู้จัดการ): เพิ่ม/แก้ไข · PIN · สิทธิ์ · สาขา
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { api, type Branch, type StaffMember } from '../api';
import { Chips, FieldLabel } from '../components/history/Chips';
import { Icon } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { PermissionsSheet } from '../components/PermissionsSheet';
import { Sheet } from '../components/Sheet';
import { ToastView } from '../components/ToastView';
import { thaiDate, thaiDateTime } from '../format';
import { ROLE_LABEL, useSession, type Role } from '../session';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';

/** บทบาทที่เข้าได้ทุกสาขา (ไม่ต้องเลือกสาขา) */
const ALL_BRANCH: Role[] = ['admin', 'manager'];
const allBranch = (r: Role) => ALL_BRANCH.includes(r);
const ROLE_OPTIONS = (Object.keys(ROLE_LABEL) as Role[]).map((value) => ({ value, label: ROLE_LABEL[value] }));

/** หน้าจัดการพนักงาน (ผู้จัดการเท่านั้น) — layout เดียวกับหน้าประวัติ/กะการขาย */
export function StaffScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { width } = useWindowDimensions();
  const { me } = useSession();
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const table = width >= 820;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [perms, setPerms] = useState(false);
  const [rows, setRows] = useState<StaffMember[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  const clearToast = useCallback(() => setToast(null), []);

  const load = useCallback(() => {
    setError(null);
    api.staffList().then(setRows).catch((e: Error) => setError(e.message));
    api.branchManage().then((r) => setBranches(r.list), () => {});
  }, []);
  const branchNames = (r: StaffMember) =>
    allBranch(r.role) ? 'ทุกสาขา' : r.branchIds.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean).join(', ') || '— ยังไม่กำหนด';
  useEffect(load, [load]);

  const active = rows?.filter((r) => r.active).length ?? 0;

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="staff" onNavigate={onNavigate} /> : null}

      <View style={[s.main, mobile && { padding: 10 }]}>
        <View style={s.header}>
          <View style={s.row}>
            <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <Text style={s.title}>
              ตั้งค่า<Text style={s.titleSub}> / พนักงาน</Text>
            </Text>
          </View>
          <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
            {!mobile ? (
              <View style={s.pillBtn}>
                <Text style={s.pillText}>{thaiDate(new Date())}</Text>
                <Icon name="calendar-outline" size={16} color={colors.primary} />
              </View>
            ) : null}
            <Pressable style={s.pillBtn} onPress={() => setPerms(true)} accessibilityLabel="การจัดการสิทธิ์">
              <Icon name="shield-checkmark-outline" size={16} color={colors.primary} />
              <Text style={s.pillText}>การจัดการสิทธิ์</Text>
            </Pressable>
            <Pressable style={[s.pillBtn, s.addBtn]} onPress={() => setEditing('new')} accessibilityLabel="เพิ่มพนักงาน">
              <Icon name="person-add-outline" size={16} color="#fff" />
              <Text style={[s.pillText, { color: '#fff' }]}>เพิ่มพนักงาน</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.info}>
          <Icon name="key-outline" size={18} color={colors.primary} />
          <Text style={s.infoText}>
            PIN 6 หลัก คือรหัสประจำตัว (UID) ของพนักงานแต่ละคน ใช้สำหรับ <Text style={{ fontWeight: '700' }}>เข้าสู่ระบบ</Text> และ{' '}
            <Text style={{ fontWeight: '700' }}>อนุมัติการยกเลิกบิล</Text> · ระบบเก็บ PIN แบบเข้ารหัส ดู PIN เดิมไม่ได้ ตั้งใหม่ได้เท่านั้น
          </Text>
        </View>

        <View style={[s.row, { flexWrap: 'wrap' }]}>
          <Stat label="พนักงานทั้งหมด" value={String(rows?.length ?? '–')} />
          <Stat label="ใช้งานอยู่" value={String(active)} tone={colors.success} />
          <Stat label="ผู้ดูแล / ผู้จัดการ" value={String(rows?.filter((r) => allBranch(r.role) && r.active).length ?? '–')} tone={colors.primary} />
          <Stat label="มีสิทธิ์ยกเลิกบิล" value={String(rows?.filter((r) => r.canVoid && r.active).length ?? '–')} />
        </View>

        {table ? (
          <View style={s.thead}>
            <Th flex={2} label="ชื่อพนักงาน" />
            <Th flex={1.1} label="บทบาท" />
            <Th flex={1.6} label="สาขาที่ดูแล" />
            <Th flex={1.1} label="ยกเลิกบิล" />
            <Th flex={1} label="สถานะ" />
            <Th flex={1.5} label="เข้าใช้ล่าสุด" />
            <Th flex={0.9} label="จัดการ" />
          </View>
        ) : null}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {error ? <Text style={s.error}>{error}</Text> : null}
          {!rows && !error ? <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} /> : null}
          {rows?.map((r) =>
            table ? (
              <Pressable
                key={r.id}
                onPress={() => setEditing(r)}
                style={({ hovered }: { hovered?: boolean }) => [s.tr, !r.active && { opacity: 0.55 }, hovered && { backgroundColor: '#F8FAFF' }]}
              >
                <View style={[s.td, { flex: 2, flexDirection: 'row', justifyContent: 'flex-start', gap: 10 }]}>
                  <Avatar name={r.name} manager={allBranch(r.role)} />
                  <Text style={s.name} numberOfLines={1}>
                    {r.name}
                    {r.id === me.id ? <Text style={s.you}>  (คุณ)</Text> : null}
                  </Text>
                </View>
                <View style={[s.td, { flex: 1.1 }]}>
                  <RoleBadge role={r.role} />
                </View>
                <View style={[s.td, { flex: 1.6 }]}>
                  <Text style={[s.cell, !allBranch(r.role) && !r.branchIds.length && { color: colors.danger }]} numberOfLines={2}>{branchNames(r)}</Text>
                </View>
                <View style={[s.td, { flex: 1.1 }]}>
                  <Icon name={r.canVoid ? 'checkmark-circle' : 'remove-circle-outline'} size={20} color={r.canVoid ? colors.success : colors.faint} />
                </View>
                <View style={[s.td, { flex: 1 }]}>
                  <Text style={[s.status, { color: r.active ? colors.success : colors.faint }]}>{r.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</Text>
                </View>
                <View style={[s.td, { flex: 1.5 }]}>
                  <Text style={s.cell}>{r.lastLogin ? thaiDateTime(r.lastLogin) : '—'}</Text>
                </View>
                <View style={[s.td, { flex: 0.9 }]}>
                  <Text style={s.link}>แก้ไข</Text>
                </View>
              </Pressable>
            ) : (
              <Pressable key={r.id} onPress={() => setEditing(r)} style={[s.card, !r.active && { opacity: 0.55 }]}>
                <Avatar name={r.name} manager={allBranch(r.role)} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.name}>
                    {r.name}
                    {r.id === me.id ? <Text style={s.you}>  (คุณ)</Text> : null}
                  </Text>
                  <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
                    <RoleBadge role={r.role} />
                    {r.canVoid ? <Text style={s.small}>ยกเลิกบิลได้</Text> : null}
                    <Text style={s.small}>· {branchNames(r)}</Text>
                    {!r.active ? <Text style={[s.small, { color: colors.danger }]}>ปิดใช้งาน</Text> : null}
                  </View>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            ),
          )}
        </ScrollView>
      </View>

      <PermissionsSheet visible={perms} onClose={() => setPerms(false)} />
      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="staff" onNavigate={onNavigate} />
      <StaffDialog
        branches={branches}
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={(msg) => {
          setEditing(null);
          notify('success', msg);
          load();
        }}
      />
      <ToastView toast={toast} onDone={clearToast} />
    </View>
  );
}

// ---------------- เพิ่ม / แก้ไขพนักงาน ----------------
function randomPin() {
  let p = '';
  do {
    p = String(Math.floor(100000 + Math.random() * 900000));
  } while (/^(\d)\1{5}$/.test(p));
  return p;
}

function StaffDialog({ target, branches, onClose, onSaved }: { target: StaffMember | 'new' | null; branches: Branch[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const { me } = useSession();
  const isNew = target === 'new';
  const cur = target && target !== 'new' ? target : null;
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [role, setRole] = useState<Role>('sales');
  const [canVoid, setCanVoid] = useState(false);
  const [active, setActive] = useState(true);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setName(cur?.name ?? '');
    setPin('');
    setShowPin(isNew);
    setRole(cur?.role ?? 'sales');
    setCanVoid(cur?.canVoid ?? false);
    setActive(cur?.active ?? true);
    setBranchIds(cur?.branchIds ?? [me.branchId]);
    setError(null);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinOk = /^\d{6}$/.test(pin);
  const ready = name.trim().length > 0 && (isNew ? pinOk : pin === '' || pinOk) && (allBranch(role) || branchIds.length > 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        await api.createStaff({ name: name.trim(), pin, role, canVoid: allBranch(role) || canVoid, branchIds });
        onSaved(`เพิ่ม ${name.trim()} แล้ว · PIN ${pin}`);
      } else if (cur) {
        await api.updateStaff(cur.id, { name: name.trim(), role, canVoid, active, branchIds, ...(pin ? { pin } : {}) });
        onSaved(pin ? `บันทึกแล้ว · PIN ใหม่ของ ${name.trim()} คือ ${pin}` : `บันทึกข้อมูล ${name.trim()} แล้ว`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={!!target}
      onClose={onClose}
      title={isNew ? 'เพิ่มพนักงาน' : `แก้ไข ${cur?.name ?? ''}`}
      width={460}
      footer={
        <Pressable style={[s.saveBtn, !ready && { opacity: 0.45 }]} disabled={!ready || busy} onPress={save}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>{isNew ? 'เพิ่มพนักงาน' : 'บันทึก'}</Text>}
        </Pressable>
      }
    >
      <ScrollView style={{ maxHeight: 560 }}>
        <FieldLabel required>ชื่อพนักงาน</FieldLabel>
        <TextInput value={name} onChangeText={setName} placeholder="เช่น มายด์" placeholderTextColor={colors.faint} style={s.input} maxLength={60} />

        <FieldLabel required={isNew}>{isNew ? 'PIN 6 หลัก (UID)' : 'ตั้ง PIN ใหม่ (เว้นว่าง = ใช้ PIN เดิม)'}</FieldLabel>
        <View style={s.pinRow}>
          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="••••••"
            placeholderTextColor={colors.faint}
            secureTextEntry={!showPin}
            keyboardType="number-pad"
            maxLength={6}
            style={[s.input, s.pinInput]}
            accessibilityLabel="PIN 6 หลัก"
          />
          <Pressable style={s.pinBtn} onPress={() => setShowPin((v) => !v)} accessibilityLabel={showPin ? 'ซ่อน PIN' : 'แสดง PIN'}>
            <Icon name={showPin ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.text} />
          </Pressable>
          <Pressable style={[s.pinBtn, { paddingHorizontal: 12 }]} onPress={() => { setPin(randomPin()); setShowPin(true); }}>
            <Icon name="shuffle" size={16} color={colors.primary} />
            <Text style={s.randomText}>สุ่ม</Text>
          </Pressable>
        </View>
        <Text style={[s.small, { marginTop: 4 }, pin && !pinOk ? { color: colors.danger } : null]}>
          {pin && !pinOk ? `กรอกแล้ว ${pin.length}/6 หลัก` : 'ตัวเลข 6 หลัก ห้ามซ้ำกับพนักงานคนอื่น · เปลี่ยน PIN แล้วพนักงานจะถูกออกจากระบบทุกเครื่อง'}
        </Text>

        <FieldLabel>บทบาท</FieldLabel>
        <Chips
          options={ROLE_OPTIONS}
          value={role}
          onChange={(v) => { setRole(v as Role); if (allBranch(v as Role)) setCanVoid(true); }}
        />
        <Text style={[s.small, { marginTop: 4 }]}>ผู้จัดการเข้าหน้า "พนักงาน" ได้ จัดการ PIN ของทุกคน และสลับได้ทุกสาขา</Text>

        <FieldLabel required={!allBranch(role)}>สาขาที่ดูแล</FieldLabel>
        {allBranch(role) ? (
          <Text style={s.small}>ผู้จัดการเข้าได้ทุกสาขา</Text>
        ) : (
          <>
            <View style={s.branchWrap}>
              {branches.map((b) => {
                const on = branchIds.includes(b.id);
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setBranchIds((p) => (on ? p.filter((x) => x !== b.id) : [...p, b.id]))}
                    style={[s.branchChip, on && s.branchChipOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`ดูแล ${b.name}`}
                  >
                    <Icon name={on ? 'checkbox' : 'square-outline'} size={16} color={on ? '#fff' : colors.sub} />
                    <Text style={[s.branchChipText, on && { color: '#fff' }]}>{b.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[s.small, { marginTop: 4 }, !branchIds.length && { color: colors.danger }]}>
              {branchIds.length ? 'เข้าสู่ระบบแล้วเห็นเฉพาะสาขาที่เลือก · เลือกหลายสาขาได้ (สลับสาขาได้ที่ป้ายสาขาบนเมนู)' : 'เลือกอย่างน้อย 1 สาขา'}
            </Text>
          </>
        )}

        <Toggle label="อนุญาตให้ใช้ PIN นี้ยกเลิกบิล" value={canVoid} onChange={setCanVoid} />
        {!isNew ? <Toggle label="เปิดใช้งานบัญชี" value={active} onChange={setActive} disabled={cur?.id === me.id} /> : null}

        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable style={[s.toggleRow, disabled && { opacity: 0.45 }]} disabled={disabled} onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <Text style={s.toggleText}>{label}</Text>
      <View style={[s.track, value && s.trackOn]}>
        <View style={[s.knob, value && { transform: [{ translateX: 18 }] }]} />
      </View>
    </Pressable>
  );
}

function Avatar({ name, manager }: { name: string; manager: boolean }) {
  return (
    <View style={[s.avatar, manager && { backgroundColor: colors.primary }]}>
      <Text style={[s.avatarText, manager && { color: '#fff' }]}>{name.slice(0, 1)}</Text>
    </View>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <View style={[s.badge, { backgroundColor: allBranch(role) ? colors.primarySoft : colors.surface }]}>
      <Text style={[s.badgeText, { color: allBranch(role) ? colors.primary : colors.sub }]} numberOfLines={1}>{ROLE_LABEL[role]}</Text>
    </View>
  );
}

function Th({ label, flex }: { label: string; flex: number }) {
  return (
    <View style={[s.th, { flex }]}>
      <Text style={s.thText}>{label}</Text>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  titleSub: { fontSize: 13, fontWeight: '400', color: colors.sub },
  pillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  addBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  info: { flexDirection: 'row', gap: 10, backgroundColor: colors.primarySoft, padding: 12, borderRadius: radius.md },
  infoText: { fontFamily: font, fontSize: 12, color: colors.text, flex: 1, lineHeight: 19 },
  stat: { flexGrow: 1, flexBasis: 130, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14 },
  statLabel: { fontFamily: font, fontSize: 11, color: colors.sub },
  statValue: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2 },
  thead: { flexDirection: 'row', gap: 6 },
  th: { height: 34, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  thText: { fontFamily: font, fontSize: 12, color: colors.sub },
  tr: { flexDirection: 'row', gap: 6, minHeight: 58, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  td: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  name: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  you: { fontWeight: '400', color: colors.sub, fontSize: 12 },
  cell: { fontFamily: font, fontSize: 12, color: colors.sub },
  status: { fontFamily: font, fontSize: 12, fontWeight: '600' },
  link: { fontFamily: font, fontSize: 13, color: colors.primary, fontWeight: '500' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  small: { fontFamily: font, fontSize: 11, color: colors.sub },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontFamily: font, fontSize: 11, fontWeight: '600' },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 12, textAlign: 'center' },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 44, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 },
  pinRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  pinInput: { flex: 1, fontSize: 22, letterSpacing: 8, textAlign: 'center' },
  pinBtn: { height: 44, minWidth: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  randomText: { fontFamily: font, fontSize: 13, color: colors.primary, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F0F2F5', marginTop: 10 },
  toggleText: { fontFamily: font, fontSize: 13, color: colors.text },
  track: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.line, padding: 3 },
  trackOn: { backgroundColor: colors.success },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  branchWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  branchChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  branchChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  branchChipText: { fontFamily: font, fontSize: 13, color: colors.text },
  saveBtn: { height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
