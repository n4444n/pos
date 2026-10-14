// ป้ายบอก "ตอนนี้อยู่สาขาไหน" + หน้าต่างเลือกสาขา (ทุกสาขาอยู่ในเว็บเดียวกัน → กดเพื่อสลับสาขา)
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, imageSrc, type Branch } from '../api';
import { DEFAULT_SETTINGS, getAppSettings, setAppSettings, useAppSettings } from '../appSettings';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';

type Item = Branch & { current: boolean };

let shopFetched = false;
let viewPref: 'list' | 'grid' = 'list';
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem('pos.branchView') === 'grid') viewPref = 'grid';
} catch {
  /* ไม่มี storage ก็ใช้ค่าเริ่มต้น */
}

/** สลับสาขา แล้วโหลดหน้าใหม่ (สินค้า สต็อก ราคา บิล กะ เปลี่ยนเป็นของสาขานั้นทั้งหมด) */
export async function switchToBranch(id: number) {
  await api.switchBranch(id);
  if (Platform.OS === 'web') window.location.reload();
}

/** ป้ายสาขาปัจจุบัน — กดเพื่อเปิดหน้าต่างเลือกสาขา */
export function BranchChip({ compact, block }: { compact?: boolean; block?: boolean }) {
  const { shop } = useAppSettings();
  const [open, setOpen] = useState(false);
  const label = shop.branchName || shop.name;
  useEffect(() => {
    // เปิดหน้าอื่นก่อนหน้าขาย (ยังไม่ได้โหลดการตั้งค่า) → ถามสาขาปัจจุบันจาก server
    if (shopFetched || getAppSettings() !== DEFAULT_SETTINGS) return;
    shopFetched = true;
    api.branches().then(
      ({ current: c }) => {
        if (!c || getAppSettings() !== DEFAULT_SETTINGS) return;
        setAppSettings({
          shop: { ...DEFAULT_SETTINGS.shop, branchName: c.name, branchCode: c.code, address: c.address, photoUrl: c.photo },
          branch: { id: c.id, name: c.name, code: c.code, isMain: c.isMain },
        });
      },
      () => {
        shopFetched = false;
      },
    );
  }, []);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ hovered }: { hovered?: boolean }) => [s.chip, block && s.chipBlock, hovered && { backgroundColor: '#E0E9FF' }]}
        accessibilityLabel={`สาขาปัจจุบัน ${label}${shop.branchCode ? ` รหัส ${shop.branchCode}` : ''} — กดเพื่อเลือกสาขา`}
      >
        <View style={s.chipIcon}>
          <Icon name="location" size={14} color="#fff" />
        </View>
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          {block ? <Text style={s.chipCaption}>{`สาขาปัจจุบัน${shop.branchCode ? ` · ${shop.branchCode}` : ''}`}</Text> : null}
          <Text style={s.chipText} numberOfLines={1}>
            {label}
            {!compact && !block && shop.branchCode ? <Text style={s.chipCode}>{`  ${shop.branchCode}`}</Text> : null}
          </Text>
        </View>
        <Icon name="chevron-down" size={14} color={colors.primary} />
      </Pressable>
      <BranchPicker visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function BranchPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [data, setData] = useState<{ current: Branch | null; list: Item[] } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState(viewPref);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    setNote('');
    setQ('');
    setError('');
    api.branches().then(setData, (e) => setError((e as Error).message));
  }, [visible]);

  const changeView = (v: 'list' | 'grid') => {
    setView(v);
    viewPref = v;
    try {
      localStorage.setItem('pos.branchView', v);
    } catch {
      /* ignore */
    }
  };

  const list = useMemo(() => {
    const all = (data?.list ?? []).map((b, i) => ({ ...b, no: i + 1 }));
    const k = q.trim().toLowerCase();
    if (!k) return all;
    return all.filter((b) => [b.name, b.code, b.address].some((x) => (x ?? '').toLowerCase().includes(k)));
  }, [data, q]);

  const choose = async (b: Item) => {
    if (b.current) return onClose();
    setBusy(b.id);
    setNote('');
    try {
      await switchToBranch(b.id);
    } catch (e) {
      setNote((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="ปิด" />
        <View style={s.card}>
          <View style={s.header}>
            <Text style={s.title}>เลือกสาขา</Text>
            <View style={s.toggle}>
              {(['list', 'grid'] as const).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => changeView(v)}
                  style={[s.toggleBtn, view === v && s.toggleOn]}
                  accessibilityLabel={v === 'list' ? 'แสดงแบบรายการ' : 'แสดงแบบตาราง'}
                  accessibilityState={{ selected: view === v }}
                >
                  <Icon name={v === 'list' ? 'list' : 'grid'} size={17} color={view === v ? '#fff' : colors.sub} />
                </Pressable>
              ))}
            </View>
            <Pressable onPress={onClose} style={s.close} hitSlop={8} accessibilityLabel="ปิด">
              <Icon name="close" size={20} color={colors.sub} />
            </Pressable>
          </View>

          <View style={s.toolbar}>
            <Text style={s.count}>
              ทั้งหมด <Text style={{ fontWeight: '700', color: colors.text }}>{data?.list.length ?? '–'}</Text> สาขา
            </Text>
            <View style={s.search}>
              <Icon name="search" size={16} color={colors.faint} />
              <TextInput value={q} onChangeText={setQ} placeholder="ค้นหาสาขา" placeholderTextColor={colors.faint} style={s.searchInput} />
              {q ? (
                <Pressable onPress={() => setQ('')} accessibilityLabel="ล้างคำค้น">
                  <Icon name="close-circle" size={16} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {note ? (
            <View style={s.note}>
              <Icon name="information-circle-outline" size={16} color="#8A6100" />
              <Text style={s.noteText}>{note}</Text>
            </View>
          ) : null}

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={[s.body, view === 'grid' && s.grid]}>
            {error ? <Text style={s.empty}>{error}</Text> : null}
            {!data && !error ? <ActivityIndicator color={colors.primary} style={{ margin: 30 }} /> : null}
            {data && !list.length ? <Text style={s.empty}>ไม่พบสาขาที่ค้นหา</Text> : null}
            {list.map((b) => (
              <BranchCard key={b.id} b={b} no={b.no} grid={view === 'grid'} busy={busy === b.id} onPress={() => choose(b)} />
            ))}
            {data && data.list.length === 1 ? (
              <Text style={s.hint}>{data.list[0].isMain ? 'ยังมีสาขาเดียว — เพิ่มสาขาได้ที่เมนู “สาขา”' : 'คุณดูแลสาขานี้สาขาเดียว'}</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BranchCard({ b, no, grid, busy, onPress }: { b: Item; no: number; grid: boolean; busy: boolean; onPress: () => void }) {
  const [broken, setBroken] = useState(false);
  const on = b.current;
  const meta = [`สาขา ${b.code}`, b.isMain ? 'สาขาหลัก' : null, b.vatRegistered ? 'จด VAT' : null].filter(Boolean).join('  |  ');
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ hovered }: { hovered?: boolean }) => [s.item, grid && s.itemGrid, on && s.itemOn, hovered && !on && s.itemHover]}
      accessibilityLabel={`${no}. ${b.name}${on ? ' (สาขาปัจจุบัน)' : ''}`}
      accessibilityState={{ selected: on }}
    >
      <View style={[s.photo, grid && s.photoGrid]}>
        {b.photo && !broken ? (
          <Image source={{ uri: imageSrc(b.photo) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" onError={() => setBroken(true)} />
        ) : (
          <Icon name="storefront-outline" size={grid ? 34 : 26} color={on ? colors.primary : colors.faint} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={[s.name, on && { color: colors.primary }]} numberOfLines={1}>
          {no}. {b.name}
        </Text>
        <Text style={s.sub} numberOfLines={2}>
          {meta}
          {on ? <Text style={s.currentText}>{'  |  สาขาปัจจุบัน'}</Text> : null}
        </Text>
        {b.address ? (
          <Text style={s.addr} numberOfLines={1}>
            {b.address}
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={s.check}>
          <Icon name="checkmark" size={14} color="#fff" />
        </View>
      ) : busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Icon name="swap-horizontal" size={16} color={colors.faint} />
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingLeft: 5, paddingRight: 12, borderRadius: radius.pill,
    backgroundColor: colors.primarySoft, maxWidth: 260, minWidth: 0,
  },
  chipBlock: { maxWidth: '100%', height: 50, borderRadius: radius.md, paddingLeft: 8, marginBottom: 12 },
  chipIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  chipCaption: { fontFamily: font, fontSize: 10, color: colors.sub },
  chipText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.primary },
  chipCode: { fontWeight: '400', color: colors.sub, fontSize: 12 },

  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.42)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.panel, borderRadius: radius.xl, width: 620, maxWidth: '94%', maxHeight: '88%', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  title: { flex: 1, fontFamily: font, fontSize: 19, fontWeight: '700', color: colors.text },
  toggle: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.sm, padding: 3, gap: 2 },
  toggleBtn: { width: 32, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.primary },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8, flexWrap: 'wrap' },
  count: { fontFamily: font, fontSize: 13, color: colors.sub },
  search: {
    flex: 1, minWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  searchInput: { flex: 1, fontFamily: font, fontSize: 14, color: colors.text, outlineStyle: 'none' } as object,
  note: { flexDirection: 'row', gap: 6, marginHorizontal: 20, marginBottom: 4, padding: 10, borderRadius: radius.sm, backgroundColor: '#FFF6DB' },
  noteText: { flex: 1, fontFamily: font, fontSize: 12, color: '#8A6100' },
  body: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  empty: { fontFamily: font, fontSize: 13, color: colors.sub, textAlign: 'center', padding: 24 },
  hint: { fontFamily: font, fontSize: 12, color: colors.faint, textAlign: 'center', paddingTop: 6, width: '100%' },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line,
    backgroundColor: colors.panel,
  },
  itemGrid: { flexBasis: 170, flexGrow: 1, flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  itemOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  itemHover: { borderColor: '#C9D6F5', backgroundColor: '#FAFBFF' },
  photo: { width: 112, height: 72, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoGrid: { width: '100%', height: 100 },
  name: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  sub: { fontFamily: font, fontSize: 12, color: colors.sub },
  currentText: { color: colors.primary, fontWeight: '700' },
  addr: { fontFamily: font, fontSize: 11, color: colors.faint },
  check: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
