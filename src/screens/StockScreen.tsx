// หน้า สต็อกสินค้า: รายการสินค้า · เพิ่ม/แก้ไข · นำเข้า/ส่งออก Excel
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api, imageSrc } from '../api';
import { GarmentArt } from '../components/GarmentArt';
import { Icon, type IconName } from '../components/Icon';
import { NavDrawer, refreshStockBadge, Sidebar, type Route } from '../components/NavMenu';
import { ImportProductsSheet } from '../components/stock/ImportProductsSheet';
import { ProductEditor } from '../components/stock/ProductEditor';
import { Sheet } from '../components/Sheet';
import { ToastView } from '../components/ToastView';
import { baht, n0, priceRange, thaiDate } from '../format';
import { can, useSession } from '../session';
import { useAppSettings } from '../appSettings';
import type { Toast } from '../store/usePos';
import { categoryChip, colors, font, radius } from '../theme';
import type { StockRow, StockSummary } from '../types';

type Status = '' | 'active' | 'low' | 'out' | 'inactive';
const STATUS: { id: Status; label: string }[] = [
  { id: '', label: 'ทั้งหมด' },
  { id: 'active', label: 'แสดงขาย' },
  { id: 'low', label: 'เหลือน้อย' },
  { id: 'out', label: 'มี SKU หมด' },
  { id: 'inactive', label: 'ปิดขาย' },
];

interface Props {
  onNavigate: (r: Route) => void;
  /** มีการแก้ไขสินค้า → หน้าขายโหลดสินค้าใหม่ */
  onStockChanged: () => void;
}

/** หน้าสต็อกสินค้า: รายการ + แจ้งเตือนเหลือน้อย + เพิ่ม/แก้ไขสินค้า (layout เดียวกับหน้าอื่น) */
export function StockScreen({ onNavigate, onStockChanged }: Props) {
  const { width } = useWindowDimensions();
  const { me } = useSession();
  const manager = can(me, 'stock', 'edit'); // สิทธิ์แก้ไขตามบทบาท (ตั้งที่ พนักงาน → การจัดการสิทธิ์)
  // สาขาย่อย: รายการสินค้ามาจากสาขาหลัก (แก้ได้เฉพาะสต็อก/ราคาของสาขา)
  const isMain = useAppSettings().branch.isMain;
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const table = width >= 820;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string; icon: string }[]>([]);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<Status>('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  // เลือกหลายรายการ
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<'zero' | 'delete' | 'category' | null>(null);
  const [bulkCat, setBulkCat] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const t = setTimeout(() => setQ(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.products({ q, category, status });
      setRows(r.rows);
      setSummary(r.summary);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, category, status]);

  const loadCategories = useCallback(() => {
    api.categories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(loadCategories, [loadCategories]);

  const toggleActive = async (r: StockRow) => {
    setRows((list) => list?.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)) ?? null);
    try {
      await api.setProductActive(r.id, !r.active);
      notify('success', `${r.name}: ${r.active ? 'ปิดแสดงขายแล้ว' : 'เปิดแสดงขายแล้ว'}`);
      onStockChanged();
      refreshStockBadge();
    } catch (e) {
      notify('error', (e as Error).message);
      load();
    }
  };

  // ตัดรายการที่เลือกซึ่งไม่อยู่ในรายการปัจจุบันออก (เช่น หลังกรอง/ลบ)
  useEffect(() => {
    if (!rows) return;
    setSelected((cur) => {
      const ids = new Set(rows.map((r) => r.id));
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [rows]);

  const toggleSel = (id: number) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSel = !!rows?.length && rows.every((r) => selected.has(r.id));
  const someSel = selected.size > 0 && !allSel;
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(rows?.map((r) => r.id) ?? []));
  const selectedRows = rows?.filter((r) => selected.has(r.id)) ?? [];

  const runBulk = async (action: 'activate' | 'deactivate' | 'category' | 'zero' | 'delete' | 'vat' | 'exempt', categoryId?: string) => {
    if (!selected.size) return;
    setBulkBusy(true);
    try {
      const r = await api.bulkProducts([...selected], action, categoryId);
      const label = { activate: 'เปิดแสดงขาย', deactivate: 'ปิดแสดงขาย', category: 'ย้ายหมวดหมู่', zero: 'ล้างสต็อกเป็น 0', delete: 'ลบ', vat: 'ตั้งเป็นเสีย VAT', exempt: 'ตั้งเป็นยกเว้น VAT' }[action];
      notify('success', `${label} ${r.done} สินค้าแล้ว${r.archived ? ` (${r.archived} รายการเคยขายแล้ว — เก็บไว้ในประวัติการขาย)` : ''}`);
      setSelected(new Set());
      setConfirm(null);
      load();
      onStockChanged();
      refreshStockBadge();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const catCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1);
    return m;
  }, [rows]);

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="stock" onNavigate={onNavigate} /> : null}

      <View style={[s.main, mobile && { padding: 10 }]}>
        {editing != null ? (
          <ProductEditor
            key={String(editing)}
            productId={editing}
            categories={categories}
            onCategoriesChanged={loadCategories}
            notify={notify}
            onClose={() => {
              setEditing(null);
              load();
            }}
            onSaved={(p, isNew) => {
              notify('success', isNew ? `เพิ่มสินค้า "${p.name}" แล้ว (${p.variants.length} SKU)` : `บันทึก "${p.name}" แล้ว`);
              if (isNew) setEditing(p.id);
              onStockChanged();
              refreshStockBadge();
            }}
          />
        ) : (
          <>
            {/* ---------- header ---------- */}
            <View style={s.header}>
              <View style={s.row}>
                <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
                  <Icon name="menu-outline" size={24} color={colors.primary} />
                </Pressable>
                <Text style={s.title}>สต็อกสินค้า</Text>
              </View>
              <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
                {!mobile ? (
                  <View style={s.pillBtn}>
                    <Text style={s.pillText}>{thaiDate(new Date())}</Text>
                    <Icon name="calendar-outline" size={16} color={colors.primary} />
                  </View>
                ) : null}
                {manager && isMain ? (
                  <Pressable style={s.pillBtn} onPress={() => setImporting(true)} accessibilityLabel="นำเข้าสินค้าจากที่อื่น">
                    <Icon name="cloud-upload-outline" size={18} color={colors.primary} />
                    <Text style={[s.pillText, { color: colors.primary, fontWeight: '600' }]}>นำเข้าสินค้าจากที่อื่น</Text>
                  </Pressable>
                ) : null}
                {manager && isMain ? (
                  <Pressable style={[s.pillBtn, s.addBtn]} onPress={() => setEditing('new')} accessibilityLabel="เพิ่มสินค้า">
                    <Icon name="add" size={18} color="#fff" />
                    <Text style={[s.pillText, { color: '#fff' }]}>เพิ่มสินค้า</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {!isMain ? (
              <View style={[s.alert, { backgroundColor: colors.primarySoft }]}>
                <Icon name="information-circle-outline" size={18} color={colors.primary} />
                <Text style={[s.alertText, { color: colors.text }]}>
                  รายการสินค้าใช้ร่วมกับทุกสาขา — <Text style={{ fontWeight: '700' }}>เพิ่ม/แก้ไขสินค้าทำที่สาขาหลัก</Text> · สาขานี้รับสินค้าเข้า ปรับสต็อก และตั้งราคาขายของสาขาเองได้ที่{' '}
                  <Text style={{ color: colors.primary, fontWeight: '700' }} onPress={() => onNavigate('skus')}>สต็อกสินค้า (คุณสมบัติ)</Text>
                </Text>
              </View>
            ) : null}
            {/* ---------- แจ้งเตือนสินค้าเหลือน้อย ---------- */}
            {summary && (summary.low > 0 || summary.out > 0) ? (
              <View style={s.alert}>
                <Icon name="notifications" size={18} color="#B26A00" />
                <Text style={s.alertText}>
                  แจ้งเตือนสต็อก: <Text style={{ fontWeight: '700' }}>เหลือน้อย {summary.low} SKU</Text> · <Text style={{ fontWeight: '700', color: colors.danger }}>หมด {summary.out} SKU</Text>
                </Text>
                <Pressable style={s.alertBtn} onPress={() => setStatus('low')}>
                  <Text style={s.alertBtnText}>ดูที่เหลือน้อย</Text>
                </Pressable>
                <Pressable style={s.alertBtn} onPress={() => setStatus('out')}>
                  <Text style={s.alertBtnText}>ดูที่หมด</Text>
                </Pressable>
              </View>
            ) : null}

            {/* ---------- สรุป ---------- */}
            {summary ? (
              <View style={[s.row, { flexWrap: 'wrap', gap: 10 }]}>
                <Stat label="สินค้า" value={n0(summary.products)} />
                <Stat label="SKU (สี/ไซซ์)" value={n0(summary.skus)} />
                <Stat label="จำนวนคงเหลือ" value={`${n0(summary.units)} ชิ้น`} />
                {summary.value != null ? <Stat label="มูลค่าสต็อก (ราคาทุน)" value={baht(summary.value)} tone={colors.primary} /> : null}
              </View>
            ) : null}

            {/* ---------- ค้นหา + ตัวกรอง ---------- */}
            <View style={s.searchBox}>
              <Icon name="barcode-outline" size={18} color={colors.text} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="ค้นหาชื่อสินค้า / สแกนบาร์โค้ด / รหัส SKU…"
                placeholderTextColor={colors.faint}
                style={s.searchInput}
                accessibilityLabel="ค้นหาสินค้า"
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="ล้างคำค้นหา">
                  <Icon name="close-circle" size={16} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
            <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
              {STATUS.map((st) => (
                <Pressable key={st.id || 'all'} style={[s.chip, status === st.id && s.chipOn]} onPress={() => setStatus(st.id)}>
                  <Text style={[s.chipText, status === st.id && s.chipTextOn]}>{st.label}</Text>
                </Pressable>
              ))}
              <View style={s.sep} />
              <Pressable style={[s.chip, !category && s.chipOn]} onPress={() => setCategory('')}>
                <Text style={[s.chipText, !category && s.chipTextOn]}>ทุกหมวด</Text>
              </Pressable>
              {categories.map((c) => (
                <Pressable key={c.id} style={[s.chip, category === c.id && s.chipOn]} onPress={() => setCategory(category === c.id ? '' : c.id)}>
                  <Text style={[s.chipText, category === c.id && s.chipTextOn]}>
                    {c.name}
                    {!category && catCount.get(c.id) ? ` ${catCount.get(c.id)}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* ---------- แถบจัดการหลายรายการ ---------- */}
            {manager && selected.size ? (
              <View style={s.bulkBar}>
                <Text style={s.bulkCount}>เลือกแล้ว {selected.size} สินค้า</Text>
                {isMain ? <BulkBtn icon="eye-outline" label="เปิดขาย" onPress={() => runBulk('activate')} disabled={bulkBusy} /> : null}
                {isMain ? <BulkBtn icon="eye-off-outline" label="ปิดขาย" onPress={() => runBulk('deactivate')} disabled={bulkBusy} /> : null}
                {isMain ? <BulkBtn icon="folder-open-outline" label="ย้ายหมวดหมู่" onPress={() => { setBulkCat(''); setConfirm('category'); }} disabled={bulkBusy} /> : null}
                {isMain ? <BulkBtn icon="receipt-outline" label="เสีย VAT" onPress={() => runBulk('vat')} disabled={bulkBusy} /> : null}
                {isMain ? <BulkBtn icon="remove-circle-outline" label="ยกเว้น VAT" onPress={() => runBulk('exempt')} disabled={bulkBusy} /> : null}
                <BulkBtn icon="refresh-outline" label="ล้างสต็อกเป็น 0" onPress={() => setConfirm('zero')} disabled={bulkBusy} />
                {isMain ? <BulkBtn icon="trash-outline" label="ลบ" danger onPress={() => setConfirm('delete')} disabled={bulkBusy} /> : null}
                <View style={{ flex: 1 }} />
                {bulkBusy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                <Pressable onPress={() => setSelected(new Set())} style={s.bulkClear} accessibilityLabel="ยกเลิกการเลือก">
                  <Text style={s.bulkClearText}>ยกเลิกการเลือก</Text>
                </Pressable>
              </View>
            ) : null}

            {/* ---------- ตาราง ---------- */}
            {table ? (
              <View style={s.thead}>
                {manager ? (
                  <View style={[s.th, { width: 44 }]}>
                    <Check on={allSel} mixed={someSel} onPress={toggleAll} label="เลือกทั้งหมด" />
                  </View>
                ) : null}
                <Th flex={2.6} label="สินค้า" left />
                <Th flex={0.8} label="SKU" />
                <Th flex={1.2} label="ราคาขาย" />
                <Th flex={1.4} label="คงเหลือ" />
                {manager ? <Th flex={1.1} label="มูลค่าทุน" /> : null}
                <Th flex={0.9} label="แสดงขาย" />
                {manager ? <Th flex={0.7} label="" /> : null}
              </View>
            ) : null}
            {!table && manager && rows?.length ? (
              <View style={[s.row, { gap: 8 }]}>
                <Check on={allSel} mixed={someSel} onPress={toggleAll} label="เลือกทั้งหมด" />
                <Text style={s.code}>เลือกทั้งหมด ({rows.length})</Text>
              </View>
            ) : null}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
              {error ? <Text style={s.error}>{error}</Text> : null}
              {!rows && !error ? <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} /> : null}
              {rows && rows.length === 0 ? (
                <View style={s.empty}>
                  <Icon name="shirt-outline" size={34} color={colors.faint} />
                  <Text style={s.emptyText}>{q || category || status ? 'ไม่พบสินค้าตามเงื่อนไข' : 'ยังไม่มีสินค้า — กด "เพิ่มสินค้า"'}</Text>
                </View>
              ) : null}
              {rows?.map((r) => {
                const chip = categoryChip[r.categoryId] ?? categoryChip.acc;
                const open = () => (manager ? setEditing(r.id) : notify('info', 'บทบาทของคุณดูได้อย่างเดียว — แก้ไขสินค้าไม่ได้'));
                const thumb = (
                  <View style={s.thumb}>
                    {r.imageUrl ? <Image source={{ uri: imageSrc(r.imageUrl, 'low') }} style={s.thumbImg} /> : <GarmentArt art={r.art} color={r.tint} size={34} />}
                  </View>
                );
                const stockCell = (
                  <View style={{ alignItems: table ? 'center' : 'flex-start', gap: 3 }}>
                    <Text style={s.stockNum}>{n0(r.stock)} ชิ้น</Text>
                    <View style={[s.row, { gap: 4, flexWrap: 'wrap' }]}>
                      {r.outCount ? <Badge text={`หมด ${r.outCount}`} bg={colors.dangerSoft} fg={colors.danger} /> : null}
                      {r.lowCount ? <Badge text={`เหลือน้อย ${r.lowCount}`} bg="#FFF4E0" fg="#B26A00" /> : null}
                    </View>
                  </View>
                );
                const toggle = (
                  <Pressable
                    onPress={() => (manager ? toggleActive(r) : notify('info', 'บทบาทของคุณดูได้อย่างเดียว'))}
                    style={[s.track, r.active && s.trackOn]}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: r.active }}
                    accessibilityLabel={`แสดงขาย ${r.name}`}
                  >
                    <View style={[s.knob, r.active && { transform: [{ translateX: 18 }] }]} />
                  </Pressable>
                );
                return table ? (
                  <Pressable
                    key={r.id}
                    onPress={open}
                    style={({ hovered }: { hovered?: boolean }) => [s.tr, !r.active && { opacity: 0.6 }, hovered && { backgroundColor: '#F8FAFF' }, selected.has(r.id) && s.trSel]}
                  >
                    {manager ? (
                      <View style={[s.td, { width: 44 }]}>
                        <Check on={selected.has(r.id)} onPress={() => toggleSel(r.id)} label={`เลือก ${r.name}`} />
                      </View>
                    ) : null}
                    <View style={[s.td, { flex: 2.6, flexDirection: 'row', justifyContent: 'flex-start', gap: 10 }]}>
                      {thumb}
                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                        <Text style={s.name} numberOfLines={1}>{r.name}</Text>
                        <View style={[s.row, { gap: 6 }]}>
                          <View style={[s.cat, { backgroundColor: chip.bg }]}>
                            <Text style={[s.catText, { color: chip.fg }]} numberOfLines={1}>{r.category}</Text>
                          </View>
                          <Text style={s.code} numberOfLines={1}>{r.sku}</Text>
                          {r.vatExempt ? <Text style={s.exempt}>ยกเว้น VAT</Text> : null}
                        </View>
                      </View>
                    </View>
                    <View style={[s.td, { flex: 0.8 }]}>
                      <Text style={s.cell}>{r.skuActive}/{r.skuCount}</Text>
                    </View>
                    <View style={[s.td, { flex: 1.2 }]}>
                      <Text style={s.cellBold}>{priceRange(r.minPrice, r.maxPrice)}</Text>
                    </View>
                    <View style={[s.td, { flex: 1.4 }]}>{stockCell}</View>
                    {manager ? (
                      <View style={[s.td, { flex: 1.1 }]}>
                        <Text style={s.cell}>{baht(r.stockValue ?? 0).replace('.00', '')}</Text>
                      </View>
                    ) : null}
                    <View style={[s.td, { flex: 0.9 }]}>{toggle}</View>
                    {manager ? (
                      <View style={[s.td, { flex: 0.7 }]}>
                        <Text style={s.link}>แก้ไข</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ) : (
                  <Pressable key={r.id} onPress={open} style={[s.card, !r.active && { opacity: 0.6 }, selected.has(r.id) && s.trSel]}>
                    {manager ? <Check on={selected.has(r.id)} onPress={() => toggleSel(r.id)} label={`เลือก ${r.name}`} /> : null}
                    {thumb}
                    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                      <Text style={s.name} numberOfLines={1}>{r.name}</Text>
                      <Text style={s.code}>
                        {r.category} · {r.skuCount} SKU · {priceRange(r.minPrice, r.maxPrice)}{r.vatExempt ? ' · ยกเว้น VAT' : ''}
                      </Text>
                      {stockCell}
                    </View>
                    {toggle}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>

      {/* ยืนยันคำสั่งหลายรายการ */}
      <Sheet
        visible={confirm != null}
        onClose={() => setConfirm(null)}
        title={confirm === 'delete' ? `ลบ ${selected.size} สินค้า?` : confirm === 'zero' ? `ล้างสต็อกเป็น 0 (${selected.size} สินค้า)?` : `ย้ายหมวดหมู่ ${selected.size} สินค้า`}
        width={440}
        footer={
          <View style={[s.row, { flex: 1, justifyContent: 'flex-end' }]}>
            <Pressable style={s.ghostBtn} onPress={() => setConfirm(null)}>
              <Text style={s.pillText}>ยกเลิก</Text>
            </Pressable>
            <Pressable
              style={[s.confirmBtn, confirm === 'delete' && { backgroundColor: colors.danger }, (bulkBusy || (confirm === 'category' && !bulkCat)) && { opacity: 0.45 }]}
              disabled={bulkBusy || (confirm === 'category' && !bulkCat)}
              onPress={() => confirm && runBulk(confirm, confirm === 'category' ? bulkCat : undefined)}
            >
              {bulkBusy ? <ActivityIndicator color="#fff" /> : (
                <Text style={[s.pillText, { color: '#fff', fontWeight: '700' }]}>
                  {confirm === 'delete' ? 'ลบสินค้า' : confirm === 'zero' ? 'ล้างสต็อก' : 'ย้ายหมวดหมู่'}
                </Text>
              )}
            </Pressable>
          </View>
        }
      >
        <View style={{ gap: 10 }}>
          <View style={s.selList}>
            {selectedRows.slice(0, 6).map((r) => (
              <Text key={r.id} style={s.selItem} numberOfLines={1}>• {r.name} <Text style={s.code}>#{r.sku} · {n0(r.stock)} ชิ้น</Text></Text>
            ))}
            {selectedRows.length > 6 ? <Text style={s.code}>และอีก {selectedRows.length - 6} สินค้า</Text> : null}
          </View>
          {confirm === 'delete' ? (
            <Text style={s.warn}>
              สินค้าที่ยังไม่เคยขายจะถูกลบถาวร · สินค้าที่เคยขายแล้วจะถูกซ่อนจากทุกหน้า (บิลเก่ายังเปิดดู/แก้ไขได้) และปล่อยรหัสสินค้า/บาร์โค้ดให้นำไปใช้ใหม่ได้ · ย้อนกลับไม่ได้
            </Text>
          ) : null}
          {confirm === 'zero' ? (
            <Text style={s.warn}>จำนวนคงเหลือของทุก SKU ในสินค้าที่เลือกจะเป็น 0 (บันทึกประวัติการปรับสต็อก)</Text>
          ) : null}
          {confirm === 'category' ? (
            <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
              {categories.map((c) => (
                <Pressable key={c.id} style={[s.chip, bulkCat === c.id && s.chipOn]} onPress={() => setBulkCat(c.id)}>
                  <Text style={[s.chipText, bulkCat === c.id && s.chipTextOn]}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </Sheet>

      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="stock" onNavigate={onNavigate} />
      <ImportProductsSheet
        visible={importing}
        onClose={() => setImporting(false)}
        onDone={(r) => {
          setImporting(false);
          const m = r.summary;
          notify(
            r.failed.length ? 'info' : 'success',
            `นำเข้าแล้ว: สินค้าใหม่ ${m.newProducts} · ปรับสินค้าเดิม ${m.updatedProducts} · ${m.units.toLocaleString()} ตัว${r.failed.length ? ` · ไม่สำเร็จ ${r.failed.length} สินค้า` : ''}`,
          );
          load();
          loadCategories();
          onStockChanged();
          refreshStockBadge();
        }}
      />
      <ToastView toast={toast} onDone={clearToast} />
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

function Th({ label, flex, left }: { label: string; flex: number; left?: boolean }) {
  return (
    <View style={[s.th, { flex }, left && { alignItems: 'flex-start', paddingLeft: 14 }]}>
      <Text style={s.thText}>{label}</Text>
    </View>
  );
}

/** ช่องติ๊กเลือก (mixed = เลือกบางส่วน) */
function Check({ on, mixed, onPress, label }: { on: boolean; mixed?: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[s.check, (on || mixed) && s.checkOn]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: mixed ? 'mixed' : on }}
      accessibilityLabel={label}
    >
      {on ? <Icon name="checkmark" size={15} color="#fff" /> : mixed ? <Icon name="remove" size={15} color="#fff" /> : null}
    </Pressable>
  );
}

function BulkBtn({ icon, label, onPress, danger, disabled }: { icon: IconName; label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={[s.bulkBtn, danger && s.bulkBtnDanger, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled} accessibilityLabel={label}>
      <Icon name={icon} size={15} color={danger ? colors.danger : colors.text} />
      <Text style={[s.bulkBtnText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

function Badge({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill }}>
      <Text style={{ fontFamily: font, fontSize: 10, fontWeight: '700', color: fg }}>{text}</Text>
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
  pillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  addBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', backgroundColor: '#FFF8EA', borderWidth: 1, borderColor: '#F5DEB0', borderRadius: radius.md, padding: 10 },
  alertText: { fontFamily: font, fontSize: 13, color: '#7A5300', flex: 1, minWidth: 200 },
  alertBtn: { paddingHorizontal: 12, height: 30, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: '#F5DEB0', justifyContent: 'center' },
  alertBtnText: { fontFamily: font, fontSize: 12, color: '#7A5300', fontWeight: '600' },
  stat: { flexGrow: 1, flexBasis: 140, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14 },
  statLabel: { fontFamily: font, fontSize: 11, color: colors.sub },
  statValue: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontFamily: font, fontSize: 14, color: colors.text, outlineStyle: 'none', minWidth: 0 } as object,
  chip: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: font, fontSize: 12, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  sep: { width: 1, height: 20, backgroundColor: colors.line, marginHorizontal: 4 },
  thead: { flexDirection: 'row', gap: 6 },
  th: { height: 34, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  thText: { fontFamily: font, fontSize: 12, color: colors.sub },
  tr: { flexDirection: 'row', gap: 6, minHeight: 64, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  td: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  name: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  cat: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: radius.pill },
  catText: { fontFamily: font, fontSize: 10, fontWeight: '500' },
  code: { fontFamily: font, fontSize: 11, color: colors.sub, flexShrink: 1 },
  cell: { fontFamily: font, fontSize: 13, color: colors.text },
  cellBold: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  stockNum: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  link: { fontFamily: font, fontSize: 13, color: colors.primary, fontWeight: '500' },
  track: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.line, padding: 3 },
  trackOn: { backgroundColor: colors.success },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#C3C9D4', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  trSel: { backgroundColor: '#EEF3FF' },
  exempt: { fontFamily: font, fontSize: 10.5, fontWeight: '700', color: '#B26A00', backgroundColor: '#FFF4E0', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  bulkBar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: 8, borderRadius: radius.md, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#C9D8FF' },
  bulkCount: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.primary, marginHorizontal: 6 },
  bulkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  bulkBtnDanger: { borderColor: '#F3C4C6', backgroundColor: '#FFF6F6' },
  bulkBtnText: { fontFamily: font, fontSize: 12, color: colors.text, fontWeight: '500' },
  bulkClear: { height: 34, paddingHorizontal: 10, justifyContent: 'center' },
  bulkClearText: { fontFamily: font, fontSize: 12, color: colors.sub, textDecorationLine: 'underline' },
  selList: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 10, gap: 4 },
  selItem: { fontFamily: font, fontSize: 13, color: colors.text },
  warn: { fontFamily: font, fontSize: 12, color: '#8A5300', backgroundColor: '#FFF8EA', borderRadius: radius.sm, padding: 10, lineHeight: 18 },
  ghostBtn: { height: 44, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  confirmBtn: { height: 44, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', minWidth: 120 },
  error: { fontFamily: font, color: colors.danger, textAlign: 'center', marginVertical: 20 },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 6 },
  emptyText: { fontFamily: font, fontSize: 14, color: colors.sub },
});
