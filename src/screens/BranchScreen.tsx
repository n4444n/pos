// หน้า "สาขา" — ทุกสาขาอยู่ในเว็บเดียว ฐานข้อมูลเดียว
// รายชื่อสาขา + สร้าง/แก้ไข/ทำสำเนา/ลบ (แผงด้านขวา) + สลับไปสาขาอื่น
// สินค้าเพิ่มที่สาขาหลักแล้วทุกสาขาเห็นทันที · สต็อก ราคา บิล กะ แยกตามสาขา
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { api, imageSrc, type Branch, type BranchInput, type BranchManage } from '../api';
import { switchToBranch } from '../components/BranchPicker';
import { Icon, type IconName } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { Sheet } from '../components/Sheet';
import { resizeToDataUrl } from '../components/stock/ImagePicker';
import { ToastView } from '../components/ToastView';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';

type Draft = BranchInput & { id: number | null };
type Panel = { mode: 'new' | 'edit'; draft: Draft; rec: Branch | null } | null;

const EMPTY: BranchInput = { name: '', code: '', address: '', vatRegistered: false, phone: '', photo: '' };
const toInput = (r: Branch): BranchInput => ({ name: r.name, code: r.code, address: r.address, vatRegistered: r.vatRegistered, phone: r.phone, photo: r.photo });

export function BranchScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const table = width >= 820;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [data, setData] = useState<BranchManage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [switching, setSwitching] = useState<Branch | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  const load = useCallback(() => {
    setError(null);
    api.branchManage().then(setData, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const openNew = useCallback((from?: Branch) => {
    const base = from ? { ...toInput(from), name: `${from.name} (สำเนา)`, code: '', photo: '' } : EMPTY;
    setPanel({ mode: 'new', draft: { ...base, id: null }, rec: null });
    setMenu(false);
  }, []);

  // F9 = เพิ่มสาขา
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9' && !panel) {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openNew, panel]);

  const list = useMemo(() => {
    const all = data?.list ?? [];
    const k = q.trim().toLowerCase();
    if (!k) return all;
    return all.filter((b) => [b.name, b.code, b.address].some((x) => x.toLowerCase().includes(k)));
  }, [data, q]);
  const deletable = list.filter((b) => !b.isMain && b.id !== data?.currentId).map((b) => b.id);
  const allOn = deletable.length > 0 && deletable.every((id) => sel.has(id));
  const toggle = (id: number) =>
    setSel((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const doDelete = async () => {
    setBusy(true);
    try {
      const r = await api.deleteBranches([...sel]);
      notify('success', `ลบ ${r.done} สาขาแล้ว (บิลและข้อมูลเดิมยังเก็บไว้)`);
      setSel(new Set());
      setConfirmDel(false);
      load();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doSwitch = async (b: Branch) => {
    setBusy(true);
    try {
      await switchToBranch(b.id);
    } catch (e) {
      notify('error', (e as Error).message);
      setBusy(false);
    }
  };

  const onSaved = (rec: Branch, isNew: boolean) => {
    notify('success', isNew ? `เพิ่ม “${rec.name}” (${rec.code}) แล้ว` : `บันทึก “${rec.name}” แล้ว`);
    load();
    setPanel(null);
    // แก้สาขาที่กำลังใช้งาน → โหลดใหม่ให้ป้าย/ใบเสร็จ/VAT เปลี่ยนตาม
    if (!isNew && rec.id === data?.currentId && Platform.OS === 'web') setTimeout(() => window.location.reload(), 600);
    if (isNew) setSwitching(rec);
  };

  const cur = data?.list.find((b) => b.id === data.currentId);

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="branches" onNavigate={onNavigate} /> : null}

      <View style={[s.main, mobile && { padding: 10 }]}>
        <View style={s.header}>
          <View style={s.row}>
            <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <View style={s.titleIcon}>
              <Icon name="business" size={18} color="#fff" />
            </View>
            <Text style={s.title}>สาขา</Text>
          </View>
          <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
            {sel.size ? (
              <Pressable style={[s.pill, s.dangerPill]} onPress={() => setConfirmDel(true)} accessibilityLabel={`ลบ ${sel.size} สาขาที่เลือก`}>
                <Icon name="trash-outline" size={16} color={colors.danger} />
                <Text style={[s.pillText, { color: colors.danger }]}>ลบที่เลือก ({sel.size})</Text>
              </Pressable>
            ) : null}
            {!mobile ? (
              <View style={s.search}>
                <Icon name="search" size={16} color={colors.faint} />
                <TextInput value={q} onChangeText={setQ} placeholder="ค้นหาสาขา" placeholderTextColor={colors.faint} style={s.searchInput} />
              </View>
            ) : null}
            <View style={s.split}>
              <Pressable style={s.splitMain} onPress={() => openNew()} accessibilityLabel="เพิ่มสาขา (F9)">
                <Icon name="add" size={18} color="#fff" />
                <Text style={s.splitText}>สาขา</Text>
                {!mobile ? <Text style={s.kbd}>F9</Text> : null}
              </Pressable>
              <Pressable style={s.splitArrow} onPress={() => setMenu((m) => !m)} accessibilityLabel="ตัวเลือกเพิ่มเติม">
                <Icon name="caret-down" size={12} color="#fff" />
              </Pressable>
              {menu ? (
                <View style={s.menu}>
                  <MenuItem icon="add-circle-outline" label="สร้างสาขาใหม่" onPress={() => openNew()} />
                  {cur ? <MenuItem icon="copy-outline" label="ทำสำเนาสาขาปัจจุบัน" onPress={() => openNew(cur)} /> : null}
                  <MenuItem icon="people-outline" label="กำหนดพนักงานประจำสาขา" onPress={() => { setMenu(false); onNavigate('staff'); }} />
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={s.info}>
          <Icon name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={s.infoText}>
            ทุกสาขาใช้เว็บเดียวกัน · <Text style={{ fontWeight: '700' }}>เพิ่ม/แก้สินค้าที่สาขาหลัก</Text> แล้วทุกสาขาเห็นทันที · สต็อก ราคาขาย บิล และกะ แยกแต่ละสาขา ·
            พนักงานเห็นเฉพาะสาขาที่กำหนดให้ (เมนู พนักงาน) · ผู้จัดการสลับได้ทุกสาขา
          </Text>
        </View>
        {mobile ? (
          <View style={[s.search, { flexShrink: 0 }]}>
            <Icon name="search" size={16} color={colors.faint} />
            <TextInput value={q} onChangeText={setQ} placeholder="ค้นหาสาขา" placeholderTextColor={colors.faint} style={s.searchInput} />
          </View>
        ) : null}

        {table ? (
          <View style={s.thead}>
            <View style={[s.th, { width: 52 }]}>
              {deletable.length ? <Check on={allOn} onPress={() => setSel(allOn ? new Set() : new Set(deletable))} label="เลือกทั้งหมด" /> : null}
            </View>
            <View style={[s.th, { width: 52 }]}><Text style={s.thText}>#</Text></View>
            <View style={[s.th, { flex: 3, alignItems: 'flex-start', paddingLeft: 12 }]}><Text style={s.thText}>ชื่อสาขา</Text></View>
            <View style={[s.th, { flex: 1 }]}><Text style={s.thText}>รหัสสาขา</Text></View>
            <View style={[s.th, { flex: 0.9 }]}><Text style={s.thText}>VAT</Text></View>
            <View style={[s.th, { flex: 1 }]}><Text style={s.thText}>พนักงาน</Text></View>
            <View style={[s.th, { width: 190 }]}><Text style={s.thText}>ทำสำเนา</Text></View>
          </View>
        ) : null}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {error ? <Text style={s.error}>{error}</Text> : null}
          {!data && !error ? <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} /> : null}
          {data && !list.length ? <Text style={s.empty}>ไม่พบสาขาที่ค้นหา</Text> : null}
          {list.map((b, i) => {
            const current = b.id === data?.currentId;
            const open = () => setPanel({ mode: 'edit', draft: { ...toInput(b), id: b.id }, rec: b });
            const checked = sel.has(b.id);
            const canSel = !b.isMain && !current;
            const actions = (
              <View style={[s.row, { gap: 6 }]}>
                {!current ? (
                  <Pressable onPress={() => doSwitch(b)} disabled={busy} style={({ hovered }: { hovered?: boolean }) => [s.switchBtn, hovered && { backgroundColor: '#DCE6FF' }]} accessibilityLabel={`สลับไป ${b.name}`}>
                    <Icon name="swap-horizontal" size={14} color={colors.primary} />
                    <Text style={s.switchText}>สลับไปสาขานี้</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => openNew(b)} style={({ hovered }: { hovered?: boolean }) => [s.copyBtn, hovered && { borderColor: colors.primary }]} accessibilityLabel={`ทำสำเนา ${b.name}`}>
                  <Icon name="copy-outline" size={16} color={colors.sub} />
                </Pressable>
              </View>
            );
            const badges = (
              <>
                {current ? <Text style={s.current}>  (สาขาปัจจุบัน)</Text> : null}
                {b.isMain ? <Text style={s.mainTag}>  ★ สาขาหลัก</Text> : null}
              </>
            );
            return table ? (
              <Pressable
                key={b.id}
                onPress={open}
                style={({ hovered }: { hovered?: boolean }) => [s.tr, current && s.trCurrent, checked && s.trChecked, hovered && !current && { backgroundColor: '#F8FAFF' }]}
                accessibilityLabel={`${i + 1}. ${b.name}${current ? ' (สาขาปัจจุบัน)' : ''}`}
              >
                <View style={[s.td, { width: 52 }]}>{canSel ? <Check on={checked} onPress={() => toggle(b.id)} label={`เลือก ${b.name}`} /> : null}</View>
                <View style={[s.td, { width: 52 }]}><Text style={s.cell}>{i + 1}</Text></View>
                <View style={[s.td, { flex: 3, alignItems: 'flex-start', paddingLeft: 12 }]}>
                  <Text style={s.name} numberOfLines={1}>{b.name}{badges}</Text>
                  {b.address ? <Text style={s.small} numberOfLines={1}>{b.address}</Text> : null}
                </View>
                <View style={[s.td, { flex: 1 }]}><Text style={s.code}>{b.code}</Text></View>
                <View style={[s.td, { flex: 0.9 }]}><Text style={[s.tag, b.vatRegistered ? s.tagOn : null]}>{b.vatRegistered ? 'จด VAT' : 'ไม่จด'}</Text></View>
                <View style={[s.td, { flex: 1 }]}><Text style={s.cell}>{b.staffCount ? `${b.staffCount} คน` : '—'}</Text></View>
                <View style={[s.td, { width: 190, alignItems: 'flex-end', paddingRight: 10 }]}>{actions}</View>
              </Pressable>
            ) : (
              <Pressable key={b.id} onPress={open} style={[s.card, current && s.trCurrent, checked && s.trChecked]}>
                {canSel ? <Check on={checked} onPress={() => toggle(b.id)} label={`เลือก ${b.name}`} /> : <View style={{ width: 20 }} />}
                <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={2}>{i + 1}. {b.name}{badges}</Text>
                  <Text style={s.small} numberOfLines={1}>{[b.code, b.vatRegistered ? 'จด VAT' : '', b.staffCount ? `พนักงาน ${b.staffCount} คน` : ''].filter(Boolean).join(' · ')}</Text>
                  {actions}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="branches" onNavigate={onNavigate} />
      <BranchPanel panel={panel} data={data} onClose={() => setPanel(null)} onSaved={onSaved} />
      <Sheet
        visible={confirmDel}
        onClose={() => setConfirmDel(false)}
        title={`ลบ ${sel.size} สาขา?`}
        width={440}
        footer={
          <View style={[s.row, { flex: 1, justifyContent: 'flex-end' }]}>
            <Pressable style={s.ghostBtn} onPress={() => setConfirmDel(false)}><Text style={s.ghostText}>ยกเลิก</Text></Pressable>
            <Pressable style={[s.saveBtn, { backgroundColor: colors.danger }]} onPress={doDelete} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>ลบสาขา</Text>}
            </Pressable>
          </View>
        }
      >
        <View style={{ gap: 8, paddingBottom: 6 }}>
          {data?.list.filter((b) => sel.has(b.id)).map((b) => <Text key={b.id} style={s.p}>• {b.name} ({b.code})</Text>)}
          <Text style={[s.small, { color: '#8A5300' }]}>สาขาที่ลบจะหายจากรายการและเข้าใช้งานไม่ได้ · บิล กะ และประวัติเดิมยังเก็บไว้ในระบบ · พนักงานที่ผูกไว้จะถูกถอดจากสาขานี้</Text>
        </View>
      </Sheet>
      <Sheet
        visible={!!switching}
        onClose={() => setSwitching(null)}
        title={`สลับไป “${switching?.name ?? ''}” เลยไหม?`}
        width={440}
        footer={
          <View style={[s.row, { flex: 1, justifyContent: 'flex-end' }]}>
            <Pressable style={s.ghostBtn} onPress={() => setSwitching(null)}><Text style={s.ghostText}>ไว้ทีหลัง</Text></Pressable>
            <Pressable style={s.saveBtn} onPress={() => switching && doSwitch(switching)} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Icon name="swap-horizontal" size={16} color="#fff" />}
              <Text style={s.saveText}>สลับไปสาขานี้</Text>
            </Pressable>
          </View>
        }
      >
        <Text style={s.p}>
          สาขาใหม่มีสินค้าครบทุกรายการแล้ว แต่สต็อกเริ่มที่ 0 — สลับไปสาขานี้เพื่อรับสินค้าเข้า (หน้า สต็อกสินค้า (คุณสมบัติ)) และกำหนดพนักงานที่เมนู พนักงาน
        </Text>
      </Sheet>
      <ToastView toast={toast} onDone={() => setToast(null)} />
    </View>
  );
}

function Check({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[s.check, on && s.checkOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      {on ? <Icon name="checkmark" size={14} color="#fff" /> : null}
    </Pressable>
  );
}

function MenuItem({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [s.menuItem, hovered && { backgroundColor: colors.surface }]}>
      <Icon name={icon} size={16} color={colors.primary} />
      <Text style={s.menuText}>{label}</Text>
    </Pressable>
  );
}

// ---------------- แผงด้านขวา: สร้าง / แก้ไข ----------------
function BranchPanel({ panel, data, onClose, onSaved }: {
  panel: Panel;
  data: BranchManage | null;
  onClose: () => void;
  onSaved: (rec: Branch, isNew: boolean) => void;
}) {
  const { width } = useWindowDimensions();
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (panel) {
      setD(panel.draft);
      setMore(!!(panel.draft.phone || panel.draft.photo));
    }
    setErr('');
  }, [panel]);

  const set = (x: Partial<Draft>) => setD((p) => (p ? { ...p, ...x } : p));
  const save = async () => {
    if (!d || !panel) return;
    setBusy(true);
    setErr('');
    try {
      const { id, ...body } = d;
      if (panel.mode === 'new') onSaved(await api.createBranch(body), true);
      else onSaved(await api.updateBranch(id!, body), false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isMain = !!panel?.rec?.isMain;
  const current = panel?.rec && panel.rec.id === data?.currentId;
  return (
    <Modal visible={!!panel} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.drawerBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="ปิด" />
        <View style={[s.drawer, { width: Math.min(560, width) }]}>
          <View style={s.drawerHead}>
            <Text style={s.drawerTitle}>สาขา</Text>
            <Pressable onPress={onClose} style={s.closeBtn} accessibilityLabel="ปิด">
              <Icon name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
            {d ? (
              <View style={s.formCard}>
                <Text style={s.formTitle}>
                  {panel?.mode === 'new' ? 'สร้างสาขาใหม่' : 'แก้ไขสาขา'}
                  {isMain ? <Text style={s.mainTag}>  ★ สาขาหลัก</Text> : null}
                  {current ? <Text style={s.current}>  (สาขาปัจจุบัน)</Text> : null}
                </Text>
                <F label="ชื่อสาขา" required>
                  <In value={d.name} onChange={(t) => set({ name: t })} max={60} placeholder="เช่น สาขาภูเก็ต" />
                </F>
                <F label="รหัสสาขา" hint={panel?.mode === 'new' ? `เว้นว่าง = ${data?.nextCode ?? 'อัตโนมัติ'} · ใช้ในเลขที่บิลของสาขา เช่น INV-${data?.nextCode ?? 'B02'}-…` : 'ใช้แยกสาขาในเลขที่บิล รายงาน และใบเสร็จ'}>
                  <In value={d.code} onChange={(t) => set({ code: t.toUpperCase().replace(/\s/g, '') })} max={20} placeholder={panel?.mode === 'new' ? data?.nextCode : ''} />
                </F>
                <F label="ที่อยู่" hint="แสดงบนใบเสร็จของสาขานี้">
                  <In value={d.address} onChange={(t) => set({ address: t })} max={300} multiline />
                </F>
                <F label="จดทะเบียนภาษีมูลค่าเพิ่มหรือไม่?" hint={d.vatRegistered ? 'ใช่ = บิลของสาขานี้แสดง VAT (อัตรา VAT ตั้งที่ ตั้งค่า → วิธีชำระเงิน)' : 'ไม่ = ไม่คิด/ไม่แสดง VAT ในบิลของสาขานี้'}>
                  <View style={[s.row, { gap: 18 }]}>
                    {([true, false] as const).map((v) => (
                      <Pressable key={String(v)} style={s.radioRow} onPress={() => set({ vatRegistered: v })} accessibilityRole="radio" accessibilityState={{ checked: d.vatRegistered === v }}>
                        <View style={[s.radio, d.vatRegistered === v && s.radioOn]}>{d.vatRegistered === v ? <View style={s.radioDot} /> : null}</View>
                        <Text style={s.p}>{v ? 'ใช่' : 'ไม่'}</Text>
                      </Pressable>
                    ))}
                  </View>
                </F>
                <Pressable style={s.moreBtn} onPress={() => setMore((m) => !m)}>
                  <Icon name={more ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
                  <Text style={s.moreText}>ข้อมูลเพิ่มเติม (เบอร์โทร รูปหน้าร้าน)</Text>
                </Pressable>
                {more ? (
                  <>
                    <F label="เบอร์โทร" hint="แสดงบนใบเสร็จ (เว้นว่าง = ใช้เบอร์ในข้อมูลร้าน)">
                      <In value={d.phone} onChange={(t) => set({ phone: t })} max={40} />
                    </F>
                    <F label="รูปหน้าร้าน" hint="แสดงในหน้าต่างเลือกสาขา">
                      <Photo url={d.photo} onChange={(u) => set({ photo: u })} />
                    </F>
                  </>
                ) : null}
                {err ? <Text style={s.errText}>{err}</Text> : null}
                <View style={[s.row, { justifyContent: 'flex-end', marginTop: 6 }]}>
                  <Pressable style={[s.saveBtn, (!d.name.trim() || busy) && { opacity: 0.45 }]} disabled={!d.name.trim() || busy} onPress={save} accessibilityLabel="บันทึก">
                    {busy ? <ActivityIndicator color="#fff" /> : <Icon name="save-outline" size={16} color="#fff" />}
                    <Text style={s.saveText}>บันทึก</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Photo({ url, onChange, disabled }: { url: string; onChange: (u: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const pick = () => {
    if (Platform.OS !== 'web' || disabled) return;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png,image/webp';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      setBusy(true);
      try {
        onChange((await api.upload(await resizeToDataUrl(f, 800))).url);
      } finally {
        setBusy(false);
      }
    };
    inp.click();
  };
  return (
    <View style={[s.row, { gap: 12 }]}>
      <View style={s.photo}>
        {url ? <Image source={{ uri: imageSrc(url) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name="storefront-outline" size={24} color={colors.faint} />}
      </View>
      {!disabled ? (
        <View style={{ gap: 6 }}>
          <Pressable style={s.outlineBtn} onPress={pick} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="cloud-upload-outline" size={15} color={colors.primary} />}
            <Text style={s.outlineText}>{url ? 'เปลี่ยนรูป' : 'เลือกรูป'}</Text>
          </Pressable>
          {url ? (
            <Pressable style={s.outlineBtn} onPress={() => onChange('')}>
              <Icon name="trash-outline" size={15} color={colors.danger} />
              <Text style={[s.outlineText, { color: colors.danger }]}>ลบรูป</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function F({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      {children}
      {hint ? <Text style={s.small}>{hint}</Text> : null}
    </View>
  );
}

function In({ value, onChange, max, placeholder, multiline, disabled }: { value: string; onChange: (t: string) => void; max?: number; placeholder?: string; multiline?: boolean; disabled?: boolean }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      maxLength={max}
      placeholder={placeholder}
      placeholderTextColor={colors.faint}
      editable={!disabled}
      multiline={multiline}
      style={[s.input, multiline && { height: 72, paddingTop: 10, textAlignVertical: 'top' }, disabled && { backgroundColor: colors.surface, color: colors.sub }]}
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', zIndex: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  titleIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  dangerPill: { borderColor: '#F5C2C4', backgroundColor: colors.dangerSoft },
  pillText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, minWidth: 200, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  searchInput: { flex: 1, fontFamily: font, fontSize: 14, color: colors.text, outlineStyle: 'none' } as object,
  split: { flexDirection: 'row', position: 'relative' },
  splitMain: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingLeft: 14, paddingRight: 12, backgroundColor: colors.primary, borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md },
  splitArrow: { width: 34, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2559D9', borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md },
  splitText: { fontFamily: font, fontSize: 14, fontWeight: '600', color: '#fff' },
  kbd: { fontFamily: font, fontSize: 9, color: 'rgba(255,255,255,0.8)', marginLeft: 2 },
  menu: {
    position: 'absolute', top: 46, right: 0, width: 230, backgroundColor: colors.panel, borderRadius: radius.md, padding: 6, gap: 2,
    borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, zIndex: 20,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 38, borderRadius: radius.sm },
  menuText: { fontFamily: font, fontSize: 13, color: colors.text },
  info: { flexDirection: 'row', gap: 10, backgroundColor: colors.primarySoft, padding: 12, borderRadius: radius.md },
  infoText: { fontFamily: font, fontSize: 12, color: colors.text, flex: 1, lineHeight: 19 },
  thead: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, height: 40, alignItems: 'center' },
  th: { height: 40, alignItems: 'center', justifyContent: 'center' },
  thText: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub },
  tr: { flexDirection: 'row', minHeight: 56, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F2F5', borderRadius: radius.sm },
  trCurrent: { backgroundColor: '#E3F4FF' },
  trChecked: { backgroundColor: '#FFF7E6' },
  td: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, minWidth: 0 },
  name: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  current: { fontWeight: '500', color: colors.primary, fontSize: 13 },
  code: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  cell: { fontFamily: font, fontSize: 13, color: colors.sub },
  small: { fontFamily: font, fontSize: 11, color: colors.sub, lineHeight: 16 },
  status: { fontFamily: font, fontSize: 12, fontWeight: '500' },
  mainTag: { fontWeight: '600', color: '#B26A00', fontSize: 12 },
  switchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  switchText: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.primary },
  tag: { fontFamily: font, fontSize: 11, color: colors.sub, backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  tagOn: { color: colors.success, backgroundColor: colors.successSoft },
  copyBtn: { width: 40, height: 30, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  check: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#B8BEC9', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  error: { fontFamily: font, fontSize: 13, color: colors.danger, marginTop: 12, textAlign: 'center' },
  empty: { fontFamily: font, fontSize: 13, color: colors.sub, marginTop: 24, textAlign: 'center' },
  p: { fontFamily: font, fontSize: 13, color: colors.text, lineHeight: 20 },

  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.35)', alignItems: 'flex-end' },
  drawer: { height: '100%', backgroundColor: '#EEF1F6', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24 },
  drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 60, backgroundColor: colors.panel },
  drawerTitle: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text },
  closeBtn: { width: 38, height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  formCard: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: 20, gap: 14 },
  formTitle: { fontFamily: font, fontSize: 17, color: colors.text, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  note: { fontFamily: font, fontSize: 12, color: '#8A5300', backgroundColor: '#FFF6DB', padding: 10, borderRadius: radius.sm },
  label: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff' },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  moreBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  moreText: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '500' },
  connBox: { gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  errText: { fontFamily: font, fontSize: 13, color: colors.danger },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: '#1AA3E8' },
  saveText: { fontFamily: font, fontSize: 14, fontWeight: '600', color: '#fff' },
  ghostBtn: { height: 40, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: font, fontSize: 13, color: colors.text },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 34, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  outlineText: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.primary },
  okBox: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: colors.successSoft },
  copyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  mono: { flex: 1, fontFamily: Platform.select({ web: 'ui-monospace, Menlo, Consolas, monospace', default: undefined }), fontSize: 12, color: colors.text },
  photo: { width: 96, height: 72, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
