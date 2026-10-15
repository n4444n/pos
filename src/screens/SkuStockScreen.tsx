import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api, imageSrc } from '../api';
import { GarmentArt } from '../components/GarmentArt';
import { Icon, type IconName } from '../components/Icon';
import { NavDrawer, refreshStockBadge, Sidebar, type Route } from '../components/NavMenu';
import { Sheet } from '../components/Sheet';
import { Barcode } from '../components/stock/Barcode';
import { BarcodeLabelSheet } from '../components/stock/BarcodeLabelSheet';
import type { LabelItem } from '../labels';
import { ImportProductsSheet } from '../components/stock/ImportProductsSheet';
import { ProductEditor } from '../components/stock/ProductEditor';
import { StockCommand } from '../components/stock/StockCommand';
import { ToastView } from '../components/ToastView';
import { moneyInput, n0, priceRange } from '../format';
import { useSession } from '../session';
import { useAppSettings } from '../appSettings';
import { randomBarcode } from '../stockDraft';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import type { SkuCell, SkuPage, SkuProduct } from '../types';

type Status = '' | 'active' | 'inactive' | 'low' | 'out' | 'nobarcode';
const STATUS: { id: Status; label: string }[] = [
  { id: '', label: 'ทุกสถานะ' },
  { id: 'active', label: 'แสดงขาย' },
  { id: 'inactive', label: 'มี SKU ปิดขาย' },
  { id: 'low', label: 'มี SKU เหลือน้อย' },
  { id: 'out', label: 'มี SKU หมด' },
  { id: 'nobarcode', label: 'ยังไม่มีบาร์โค้ดครบ' },
];
type SortKey = 'code' | 'name' | 'stock' | 'price';
const PAGE_SIZES = [10, 20, 50];
const CELL_W = 48;

// ---------------- จัดรูป ไซซ์ (คอลัมน์) × สี (แถว) ----------------
interface MRow { key: string; label: string; hex: string | null; cells: Map<string, SkuCell>; list: SkuCell[] }
interface Matrix { sizes: { value: string; label: string }[]; rows: MRow[] }

function matrixOf(p: SkuProduct): Matrix {
  const sizeAttr = p.attrs.find((a) => a.type === 'size');
  const colorAttr = p.attrs.find((a) => a.type === 'color');
  const extraAttr = p.attrs.find((a) => a.type === 'custom');
  const present = new Set(p.variants.map((v) => v.size));
  const sizes: string[] = (sizeAttr?.options.map((o) => o.value) ?? []).filter((v) => present.has(v));
  for (const v of p.variants) if (!sizes.includes(v.size)) sizes.push(v.size);

  const colorOrder = new Map((colorAttr?.options ?? []).map((o, i) => [o.value, i]));
  const extraOrder = new Map((extraAttr?.options ?? []).map((o, i) => [o.value, i]));
  const rows = new Map<string, MRow>();
  for (const v of p.variants) {
    const key = `${v.color}|${v.extra}`;
    let r = rows.get(key);
    if (!r) {
      const parts = [v.color !== '-' ? v.color : '', v.extra].filter(Boolean);
      r = { key, label: parts.join(' · ') || 'ทุกแบบ', hex: v.color !== '-' ? v.colorHex : null, cells: new Map(), list: [] };
      rows.set(key, r);
    }
    r.cells.set(v.size, v);
    r.list.push(v);
  }
  const ord = (r: MRow) => {
    const [c, e] = r.key.split('|');
    return (colorOrder.get(c) ?? 999) * 1000 + (extraOrder.get(e) ?? 999);
  };
  return {
    sizes: sizes.map((v) => ({ value: v, label: v === '-' ? 'ปกติ' : v })),
    rows: [...rows.values()].sort((a, b) => ord(a) - ord(b)),
  };
}

/** SKU ทุกรุ่นของสินค้า → ป้ายบาร์โค้ด (รหัส = บาร์โค้ดกำหนดเอง ถ้าไม่มีใช้รหัส SKU) */
function labelItemsOf(products: SkuProduct[]): LabelItem[] {
  return products.flatMap((p) =>
    p.variants.map((v) => ({
      key: String(v.id),
      name: p.name,
      variant: [v.color, v.extra, v.size].filter((x) => x && x !== '-').join(' / ') || 'ปกติ',
      code: v.barcode || v.sku,
      price: v.price,
      stock: v.stock,
    })),
  );
}

interface Props {
  onNavigate: (r: Route) => void;
  onStockChanged: () => void;
}

/**
 * สต็อกสินค้า (คุณสมบัติ): แถว = สินค้า → สี, คอลัมน์ = ไซซ์
 * รหัสสินค้า = บ่งบอกว่าสินค้าคืออะไร · บาร์โค้ด (กำหนดเอง) = รหัสบนป้าย label ของแต่ละ SKU ที่ใช้สแกนขาย
 */
export function SkuStockScreen({ onNavigate, onStockChanged }: Props) {
  const appBranch = useAppSettings().branch;
  const { width } = useWindowDimensions();
  const { me } = useSession();
  const manager = me.role === 'manager';
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const table = width >= 900;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [data, setData] = useState<SkuPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string; icon: string }[]>([]);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [showImg, setShowImg] = useState(true);
  // พิมพ์บาร์โค้ด: สินค้าเดียว (ทุกรุ่น) หรือทุกสินค้าในหน้านี้
  const [labelFor, setLabelFor] = useState<{ title: string; products: SkuProduct[] } | null>(null);
  const [showCmd, setShowCmd] = useState(false); // ปิดไว้ทุกครั้งที่เข้าหน้า — กดปุ่ม >_ เพื่อเปิด
  const [menu, setMenu] = useState<'status' | 'category' | 'limit' | null>(null);
  const [cellDlg, setCellDlg] = useState<{ p: SkuProduct; cell: SkuCell } | null>(null);
  const [rowDlg, setRowDlg] = useState<{ p: SkuProduct; row: MRow; sizes: Matrix['sizes'] } | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  /** โหมดแก้ไขในตาราง (ปุ่มดินสอ): ช่องจำนวนกลายเป็นช่องกรอก */
  const [inline, setInline] = useState<{ pid: number; qty: Record<number, string>; price: Record<string, string> } | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const inputRefs = useRef<Record<number, TextInput | null>>({});
  const inlinePid = inline?.pid ?? null;
  const [toast, setToast] = useState<Toast | null>(null);
  /** เมนู Excel: ส่งออก / นำเข้ากลับ */
  const [excelMenu, setExcelMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const canImport = manager && appBranch.isMain;
  const scrollRef = useRef<ScrollView>(null);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.skus({ q, status, category, sort: sort?.key, dir: sort?.dir, page, limit });
      setData(r);
      if (r.page !== page) setPage(r.page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, status, category, sort, page, limit]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [page]);

  const loadCategories = useCallback(() => {
    api.categories().then(setCategories).catch(() => {});
  }, []);
  useEffect(loadCategories, [loadCategories]);

  const matrices = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, matrixOf(p)])), [data]);

  const patchCells = (patches: { id: number; patch: Partial<SkuCell> }[]) => {
    const byId = new Map(patches.map((x) => [x.id, x.patch]));
    setData((d) =>
      d ? { ...d, products: d.products.map((p) => ({ ...p, variants: p.variants.map((v) => (byId.has(v.id) ? { ...v, ...byId.get(v.id) } : v)) })) } : d,
    );
  };

  /** เปิด/ปิดแสดงขายทั้งแถว (ทุกไซซ์ของสีนั้น) */
  const toggleRow = async (p: SkuProduct, row: MRow) => {
    if (!manager) return notify('info', 'เฉพาะผู้จัดการเท่านั้น');
    const next = !row.list.every((c) => c.active);
    const targets = row.list.filter((c) => c.active !== next);
    patchCells(targets.map((c) => ({ id: c.id, patch: { active: next } })));
    try {
      for (const c of targets) await api.patchVariant(c.id, { active: next });
      notify('success', `${p.name} · ${row.label}: ${next ? 'เปิดแสดงขายทุกไซซ์' : 'ปิดแสดงขายทุกไซซ์'}`);
      onStockChanged();
      refreshStockBadge();
    } catch (e) {
      notify('error', (e as Error).message);
      load();
    }
  };

  const copy = (text: string) => {
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        navigator.clipboard.writeText(text).then(
          () => notify('success', `คัดลอก ${text} แล้ว`),
          () => notify('error', 'คัดลอกไม่สำเร็จ'),
        );
      }
    } catch {
      notify('error', 'คัดลอกไม่สำเร็จ');
    }
  };

  const onSort = (key: SortKey) => {
    setPage(1);
    const first: 'asc' | 'desc' = key === 'stock' || key === 'price' ? 'desc' : 'asc';
    setSort((cur) => (cur?.key !== key ? { key, dir: first } : cur.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null));
  };

  const catName = categories.find((c) => c.id === category)?.name;
  const statusName = STATUS.find((x) => x.id === status)?.label ?? 'ทุกสถานะ';
  const openEditor = (pid: number) => (manager ? setEditing(pid) : notify('info', 'เฉพาะผู้จัดการเท่านั้นที่แก้ไขสินค้าได้'));
  /** ปุ่มดินสอ: เปิดช่องจำนวน (และราคา) ของทุกสี/ไซซ์ในสินค้านั้นให้แก้ไขในตารางทันที */
  const startInline = (p: SkuProduct) => {
    if (!manager) return notify('info', 'เฉพาะผู้จัดการเท่านั้นที่แก้ไขสินค้าได้');
    if (inline && inline.pid !== p.id) return notify('info', 'กรุณาบันทึกหรือยกเลิกสินค้าที่กำลังแก้ไขอยู่ก่อน');
    const m = matrices.get(p.id)!;
    const price: Record<string, string> = {};
    for (const r of m.rows) {
      const ps = new Set(r.list.map((c) => c.price));
      price[r.key] = ps.size === 1 ? String(r.list[0].price) : '';
    }
    setInline({ pid: p.id, qty: Object.fromEntries(p.variants.map((v) => [v.id, String(v.stock)])), price });
    // โฟกัสช่องแรก
    setTimeout(() => {
      const first = m.rows[0] && m.sizes.map((sz) => m.rows[0].cells.get(sz.value)).find(Boolean);
      if (first) inputRefs.current[first.id]?.focus();
    }, 50);
  };
  const cancelInline = () => setInline(null);

  /** รายการที่เปลี่ยน: จำนวน (ปรับจากยอดล่าสุด) และราคา (ทั้งสี) */
  const inlineChanges = (p: SkuProduct) => {
    if (!inline || inline.pid !== p.id) return [];
    const m = matrices.get(p.id)!;
    const out: { id: number; stock?: number; stockBase?: number; price?: number }[] = [];
    for (const r of m.rows) {
      const pr = inline.price[r.key]?.trim() ?? '';
      for (const c of r.list) {
        const q = inline.qty[c.id] ?? String(c.stock);
        const ch: { id: number; stock?: number; stockBase?: number; price?: number } = { id: c.id };
        if (q !== '' && Number(q) !== c.stock) Object.assign(ch, { stock: Number(q), stockBase: c.stock });
        if (pr !== '' && Number(pr) !== c.price) ch.price = Number(pr);
        if (ch.stock !== undefined || ch.price !== undefined) out.push(ch);
      }
    }
    return out;
  };

  const saveInline = async (p: SkuProduct) => {
    if (!inline) return;
    if (Object.values(inline.qty).some((v) => v === '')) return notify('error', 'กรุณากรอกจำนวนให้ครบทุกช่อง');
    const changes = inlineChanges(p);
    if (!changes.length) return setInline(null);
    setInlineSaving(true);
    try {
      const np = await api.bulkSkus(p.id, changes);
      setData((d) => (d ? { ...d, products: d.products.map((x) => (x.id === np.id ? np : x)) } : d));
      setInline(null);
      notify('success', `บันทึก ${np.name} แล้ว (${changes.length} SKU)`);
      load(); // อัปเดตยอดรวมด้านบน
      onStockChanged();
      refreshStockBadge();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setInlineSaving(false);
    }
  };

  /** ลำดับช่องกรอก (ซ้าย→ขวา บน→ล่าง) สำหรับ Enter ไปช่องถัดไป */
  const focusNext = (p: SkuProduct, id: number) => {
    const m = matrices.get(p.id)!;
    const order = m.rows.flatMap((r) => m.sizes.map((sz) => r.cells.get(sz.value)?.id).filter((x): x is number => x != null));
    const next = order[order.indexOf(id) + 1];
    if (next != null) inputRefs.current[next]?.focus();
    else saveInline(p);
  };

  const editActions = (p: SkuProduct, compact = false) => {
    const n = inlineChanges(p).length;
    return (
      <View style={[s.row, { gap: 6, flexWrap: compact ? 'wrap' : 'nowrap' }]}>
        <Pressable style={s.cancelBtn} onPress={cancelInline} disabled={inlineSaving} accessibilityLabel="ยกเลิกการแก้ไข">
          <Text style={s.cancelText}>ยกเลิก</Text>
        </Pressable>
        <Pressable style={[s.saveBtn, inlineSaving && { opacity: 0.6 }]} onPress={() => saveInline(p)} disabled={inlineSaving} accessibilityLabel="บันทึกการแก้ไข">
          {inlineSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveText}>บันทึก{n ? ` (${n})` : ''}</Text>}
        </Pressable>
      </View>
    );
  };

  const openCell = (p: SkuProduct, cell: SkuCell) => (inlinePid === p.id ? inputRefs.current[cell.id]?.focus() : manager ? setCellDlg({ p, cell }) : cell.barcode ? copy(cell.barcode) : null);

  // ---------------- ชิ้นส่วนในตาราง ----------------
  const thumb = (p: SkuProduct, size = 36) =>
    showImg ? (
      <View style={[s.thumb, { width: size, height: size }]}>
        {p.imageUrl ? <Image source={{ uri: imageSrc(p.imageUrl, 'low') }} style={{ width: '100%', height: '100%' }} /> : <GarmentArt art={p.art} color={p.tint} size={size - 10} />}
      </View>
    ) : null;

  const qtyCell = (p: SkuProduct, cell: SkuCell | undefined, key: string) => {
    if (!cell) return <View key={key} style={[s.qty, s.qtyNone]}><Text style={s.qtyNoneText}>–</Text></View>;
    if (inline && inline.pid === p.id) {
      const v = inline.qty[cell.id] ?? String(cell.stock);
      const dirty = v !== String(cell.stock);
      return (
        <TextInput
          key={key}
          ref={(r) => {
            inputRefs.current[cell.id] = r;
          }}
          value={v}
          onChangeText={(t) => setInline((cur) => (cur ? { ...cur, qty: { ...cur.qty, [cell.id]: t.replace(/[^0-9]/g, '').slice(0, 6) } } : cur))}
          onSubmitEditing={() => focusNext(p, cell.id)}
          blurOnSubmit={false}
          keyboardType="number-pad"
          selectTextOnFocus
          style={[s.qty, s.qtyInput, dirty && s.qtyDirty, v === '' && { borderColor: colors.danger }]}
          accessibilityLabel={`จำนวน ${cell.color} ${cell.size}`}
        />
      );
    }
    const tone = cell.stock === 0 ? s.qtyOut : cell.stock <= p.lowStock ? s.qtyLow : null;
    return (
      <Pressable
        key={key}
        onPress={() => openCell(p, cell)}
        style={({ hovered }: { hovered?: boolean }) => [s.qty, tone, !cell.active && s.qtyOff, hovered && manager && s.qtyHover]}
        accessibilityLabel={`${p.name} ${cell.color} ${cell.size} คงเหลือ ${cell.stock}`}
      >
        <Text style={[s.qtyText, cell.stock === 0 && { color: colors.danger }, cell.stock > 0 && cell.stock <= p.lowStock && { color: '#B26A00' }, !cell.active && s.strike]}>
          {n0(cell.stock)}
        </Text>
        {cell.barcode ? <View style={s.codeDot} /> : null}
      </Pressable>
    );
  };

  const barcodeSummary = (p: SkuProduct, row: MRow, m: Matrix) => {
    if (row.list.length === 1) {
      const c = row.list[0];
      return c.barcode ? (
        <View style={[s.row, { gap: 6 }]}>
          <Pressable onPress={() => openCell(p, c)}>
            <Text style={s.barcodeText} numberOfLines={1}>{c.barcode}</Text>
          </Pressable>
          <Pressable onPress={() => copy(c.barcode!)} hitSlop={6} accessibilityLabel={`คัดลอก ${c.barcode}`}>
            <Icon name="copy-outline" size={15} color={colors.primary} />
          </Pressable>
        </View>
      ) : manager ? (
        <Pressable onPress={() => openCell(p, c)} style={s.addCode} accessibilityLabel={`กำหนดบาร์โค้ด ${p.name} ${row.label}`}>
          <Icon name="add" size={13} color={colors.primary} />
          <Text style={s.addCodeText}>กำหนด</Text>
        </Pressable>
      ) : (
        <Text style={[s.cell, { color: colors.faint }]}>-</Text>
      );
    }
    const done = row.list.filter((c) => c.barcode).length;
    const all = done === row.list.length;
    return (
      <Pressable
        onPress={() => setRowDlg({ p, row, sizes: m.sizes })}
        style={[s.codeChip, all ? s.codeChipDone : done === 0 ? s.codeChipNone : null]}
        accessibilityLabel={`บาร์โค้ด ${p.name} ${row.label}`}
      >
        <Icon name={all ? 'checkmark-circle' : 'barcode-outline'} size={14} color={all ? colors.success : colors.primary} />
        <Text style={[s.codeChipText, all && { color: colors.success }]} numberOfLines={1}>
          {done === 0 ? (manager ? 'กำหนด' : 'ยังไม่มี') : `${done}/${row.list.length} ไซซ์`}
        </Text>
      </Pressable>
    );
  };

  const activeToggle = (p: SkuProduct, row: MRow) => {
    const on = row.list.filter((c) => c.active).length;
    const all = on === row.list.length;
    const none = on === 0;
    return (
      <Pressable
        onPress={() => toggleRow(p, row)}
        disabled={!manager}
        style={[s.okBtn, { backgroundColor: all ? colors.successSoft : none ? colors.dangerSoft : '#FFF4E0' }]}
        accessibilityRole="switch"
        accessibilityState={{ checked: all }}
        accessibilityLabel={`แสดงขาย ${p.name} ${row.label}`}
      >
        {all || none ? (
          <Icon name={all ? 'checkmark' : 'close'} size={16} color={all ? colors.success : colors.danger} />
        ) : (
          <Text style={{ fontFamily: font, fontSize: 10, fontWeight: '700', color: '#B26A00' }}>{on}/{row.list.length}</Text>
        )}
      </Pressable>
    );
  };

  const rowPrice = (row: MRow) => {
    const ps = row.list.map((c) => c.price);
    return priceRange(Math.min(...ps), Math.max(...ps));
  };
  const rowQty = (row: MRow) =>
    row.list.reduce((a, c) => a + (inline && inline.qty[c.id] != null ? Number(inline.qty[c.id] || 0) : c.stock), 0);
  const priceCell = (p: SkuProduct, row: MRow) =>
    inline && inline.pid === p.id ? (
      <TextInput
        value={inline.price[row.key] ?? ''}
        onChangeText={(t) => setInline((cur) => (cur ? { ...cur, price: { ...cur.price, [row.key]: moneyInput(t, cur.price[row.key] ?? '').slice(0, 9) } } : cur))}
        placeholder={rowPrice(row)}
        placeholderTextColor={colors.faint}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={[s.priceInput, (inline.price[row.key] ?? '') !== '' && Number(inline.price[row.key]) !== row.list[0].price && s.qtyDirty]}
        accessibilityLabel={`ราคา ${row.label}`}
      />
    ) : (
      <Text style={s.cell}>{rowPrice(row)}</Text>
    );

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="skus" onNavigate={onNavigate} /> : null}

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
              <View style={[s.row, { flexShrink: 1 }]}>
                <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
                  <Icon name="menu-outline" size={24} color={colors.primary} />
                </Pressable>
                <View style={{ flexShrink: 1 }}>
                  <Text style={s.title} numberOfLines={1}>สต็อกสินค้า (คุณสมบัติ)</Text>
                  <Text style={s.sub} numberOfLines={1}>จำนวนแยกตาม สี × ไซซ์ · กำหนดบาร์โค้ดสำหรับพิมพ์ป้าย</Text>
                </View>
              </View>
              <View style={[s.row, { gap: 8 }]}>
                <Pressable style={s.pillBtn} onPress={() => setExcelMenu(true)} accessibilityLabel="Excel: ส่งออก / นำเข้าสต็อก">
                  <Icon name="grid-outline" size={18} color={colors.success} />
                  {!mobile ? <Text style={s.pillText}>Excel</Text> : null}
                </Pressable>
                {manager ? (
                  <Pressable style={[s.pillBtn, s.addBtn]} onPress={() => setEditing('new')} accessibilityLabel="เพิ่มสินค้า">
                    <Icon name="add" size={18} color="#fff" />
                    {!mobile ? <Text style={[s.pillText, { color: '#fff' }]}>เพิ่มสินค้า</Text> : null}
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* ---------- ตัวกรอง ---------- */}
            <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
              <DropBtn label={statusName} active={!!status} onPress={() => setMenu('status')} />
              <DropBtn label={catName ?? 'หมวดหมู่'} active={!!category} onPress={() => setMenu('category')} />
              <View style={[s.searchBox, { flexBasis: mobile ? '100%' : 320 }]}>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="ค้นหาตามชื่อ, รหัสสินค้า, บาร์โค้ด, สี/ไซซ์"
                  placeholderTextColor={colors.faint}
                  style={s.searchInput}
                  accessibilityLabel="ค้นหา SKU"
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="ล้างคำค้นหา">
                    <Icon name="close-circle" size={16} color={colors.faint} />
                  </Pressable>
                ) : (
                  <Icon name="search" size={16} color={colors.text} />
                )}
              </View>
            </View>

            {!appBranch.isMain ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.primarySoft, padding: 10, borderRadius: radius.md }}>
                <Icon name="location-outline" size={16} color={colors.primary} />
                <Text style={{ flex: 1, fontFamily: font, fontSize: 12, color: colors.text }}>
                  กำลังดูสต็อกของ <Text style={{ fontWeight: '700' }}>{appBranch.name}</Text> — จำนวนและราคาขายที่แก้ตรงนี้ใช้เฉพาะสาขานี้ (ราคาที่ไม่ได้แก้ = ราคาเดียวกับสาขาหลัก)
                </Text>
              </View>
            ) : null}
            {showCmd ? (
              <StockCommand
                manager={manager}
                compact={mobile}
                notify={notify}
                onApplied={() => {
                  load();
                  onStockChanged();
                  refreshStockBadge();
                }}
              />
            ) : null}

            <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }]}>
              <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
                <Text style={s.count}>{data ? `${n0(data.total)} สินค้า · ${n0(data.skus)} SKU · ${n0(data.units)} ชิ้น` : '—'}</Text>
                {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                <ToolBtn icon={showImg ? 'image-outline' : 'image'} on={!showImg} label={showImg ? 'ซ่อนรูป' : 'แสดงรูป'} onPress={() => setShowImg((v) => !v)} />
                <ToolBtn
                  icon="print-outline"
                  label="พิมพ์บาร์โค้ดทุกสินค้าในหน้านี้"
                  onPress={() => data?.products.length && setLabelFor({ title: `พิมพ์บาร์โค้ด · ${data.products.length} สินค้าในหน้านี้`, products: data.products })}
                />
                <ToolBtn icon="terminal-outline" on={showCmd} label={showCmd ? 'ซ่อนคำสั่งพิเศษ' : 'แสดงคำสั่งพิเศษ'} onPress={() => setShowCmd((v) => !v)} />
                <ToolBtn
                  icon="barcode-outline"
                  on={status === 'nobarcode'}
                  label="สินค้าที่ยังกำหนดบาร์โค้ดไม่ครบ"
                  onPress={() => {
                    setStatus(status === 'nobarcode' ? '' : 'nobarcode');
                    setPage(1);
                  }}
                />
              </View>
              {data ? (
                <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
                  {!mobile ? <Text style={s.count}>แสดง</Text> : null}
                  <DropBtn label={`${limit} สินค้า`} onPress={() => setMenu('limit')} small />
                  <Pager page={data.page} pages={data.pages} compact={mobile} onPage={setPage} />
                </View>
              ) : null}
            </View>

            {/* ---------- หัวตาราง ---------- */}
            {table ? (
              <View style={s.thead}>
                <Th flex={0.9} label="รหัสสินค้า" sortKey="code" sort={sort} onSort={onSort} />
                <Th flex={1.6} label="ชื่อสินค้า / สี" sortKey="name" sort={sort} onSort={onSort} />
                <Th flex={3.2} label="ไซซ์ (จำนวนคงเหลือ)" />
                <Th flex={0.8} label="จำนวน" sortKey="stock" sort={sort} onSort={onSort} />
                <Th flex={0.9} label="ราคาขาย" sortKey="price" sort={sort} onSort={onSort} />
                <Th flex={1.2} label="บาร์โค้ด (กำหนดเอง)" />
                <Th width={70} label="แสดงขาย" center />
              </View>
            ) : null}

            <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
              {error ? <Text style={s.error}>{error}</Text> : null}
              {!data && !error ? <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} /> : null}
              {data && data.products.length === 0 ? (
                <View style={s.empty}>
                  <Icon name="barcode-outline" size={34} color={colors.faint} />
                  <Text style={s.emptyText}>{q || status || category ? 'ไม่พบสินค้าตามเงื่อนไข' : 'ยังไม่มีสินค้า — เพิ่มสินค้าที่หน้าสต็อกสินค้า'}</Text>
                </View>
              ) : null}

              {data?.products.map((p, gi) => {
                const m = matrices.get(p.id)!;
                const total = p.variants.reduce((a, c) => a + c.stock, 0);
                const ps = p.variants.map((c) => c.price);
                if (!table) {
                  return (
                    <View key={p.id} style={s.card}>
                      <Pressable style={s.cardHead} onPress={() => (inlinePid === p.id ? null : startInline(p))}>
                        {thumb(p, 40)}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.code}>#{p.code}</Text>
                          <Text style={s.name} numberOfLines={2}>{p.name}</Text>
                          <Text style={s.sub}>{n0(total)} ชิ้น · {priceRange(Math.min(...ps), Math.max(...ps))}</Text>
                        </View>
                        {inlinePid === p.id ? null : manager ? <Icon name="pencil" size={16} color={colors.primary} /> : null}
                      </Pressable>
                      <Pressable
                        style={[s.row, { gap: 6, paddingHorizontal: 10, paddingBottom: 8 }]}
                        onPress={() => setLabelFor({ title: `พิมพ์บาร์โค้ด · ${p.name}`, products: [p] })}
                        accessibilityLabel={`พิมพ์บาร์โค้ด ${p.name}`}
                      >
                        <Icon name="barcode-outline" size={15} color={colors.primary} />
                        <Text style={[s.sub, { color: colors.primary }]}>พิมพ์บาร์โค้ดทุกรุ่น</Text>
                      </Pressable>
                      {inlinePid === p.id ? <View style={{ padding: 10, paddingBottom: 0 }}>{editActions(p, true)}</View> : null}
                      {m.rows.map((row) => (
                        <View key={row.key} style={s.cardRow}>
                          <View style={[s.row, { justifyContent: 'space-between' }]}>
                            <View style={[s.row, { gap: 6, flexShrink: 1 }]}>
                              {row.hex ? <View style={[s.swatch, { backgroundColor: row.hex }]} /> : null}
                              <Text style={s.cellBold} numberOfLines={1}>{row.label}</Text>
                              <Text style={s.sub}>· {n0(rowQty(row))} ชิ้น</Text>
                            </View>
                            {activeToggle(p, row)}
                          </View>
                          <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                            {m.sizes.map((sz) => (
                              <View key={sz.value} style={{ alignItems: 'center', gap: 2 }}>
                                <Text style={s.sizeHead}>{sz.label}</Text>
                                {qtyCell(p, row.cells.get(sz.value), sz.value)}
                              </View>
                            ))}
                          </View>
                          <View style={[s.row, { justifyContent: 'space-between' }]}>
                            {priceCell(p, row)}
                            {barcodeSummary(p, row, m)}
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                }
                return (
                  <View key={p.id} style={[s.group, { backgroundColor: gi % 2 === 0 ? '#F7F8FA' : '#FFFFFF' }, inlinePid === p.id && s.groupEditing]}>
                    {/* แถวสินค้า: รหัส · ชื่อ · หัวไซซ์ */}
                    <View style={[s.tr, s.productRow]}>
                      <View style={[s.td, { flex: 0.9 }]}>
                        <Pressable onPress={() => openEditor(p.id)}>
                          <Text style={s.codeLink} numberOfLines={2}>#{p.code}</Text>
                        </Pressable>
                      </View>
                      <View style={[s.td, { flex: 1.6, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                        {thumb(p)}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.name} numberOfLines={2}>{p.name}</Text>
                          {!p.active ? <Text style={s.off}>ปิดขายทั้งสินค้า</Text> : p.category ? <Text style={s.sub}>{p.category}</Text> : null}
                        </View>
                        <Pressable
                          onPress={() => setLabelFor({ title: `พิมพ์บาร์โค้ด · ${p.name}`, products: [p] })}
                          hitSlop={6}
                          accessibilityLabel={`พิมพ์บาร์โค้ด ${p.name}`}
                          style={s.editBtn}
                        >
                          <Icon name="barcode-outline" size={14} color={colors.text} />
                        </Pressable>
                        {manager ? (
                          <Pressable
                            onPress={() => (inlinePid === p.id ? cancelInline() : startInline(p))}
                            hitSlop={6}
                            accessibilityLabel={`แก้ไข ${p.name}`}
                            style={[s.editBtn, inlinePid === p.id && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                          >
                            <Icon name="pencil" size={14} color={inlinePid === p.id ? '#fff' : colors.text} />
                          </Pressable>
                        ) : null}
                      </View>
                      <View style={[s.td, s.sizes, { flex: 3.2 }]}>
                        {m.sizes.map((sz) => (
                          <View key={sz.value} style={s.sizeHeadBox}>
                            <Text style={s.sizeHead} numberOfLines={1}>{sz.label}</Text>
                          </View>
                        ))}
                      </View>
                      <View style={[s.td, { flex: 0.8 }]}>
                        <Text style={[s.cellBold, total === 0 && { color: colors.danger }]}>
                          {n0(inlinePid === p.id ? m.rows.reduce((a, r) => a + rowQty(r), 0) : total)} ชิ้น
                        </Text>
                      </View>
                      <View style={[s.td, { flex: 0.9 }]}>
                        <Text style={s.cell}>{priceRange(Math.min(...ps), Math.max(...ps))}</Text>
                      </View>
                      <View style={[s.td, { flex: 1.2, overflow: 'visible' }]}>
                        {inlinePid === p.id ? editActions(p) : null}
                      </View>
                      <View style={{ width: 70 }} />
                    </View>

                    {/* แถวสี */}
                    {m.rows.map((row) => (
                      <View key={row.key} style={[s.tr, s.trLine]}>
                        <View style={[s.td, { flex: 0.9 }]} />
                        <View style={[s.td, s.rowCell, { flex: 1.6 }]}>
                          {showImg ? <View style={{ width: 44 }} /> : null}
                          {row.hex ? <View style={[s.swatch, { backgroundColor: row.hex }]} /> : <Text style={s.sub}>•</Text>}
                          <Text style={[s.cell, row.list.every((c) => !c.active) && { color: colors.faint }]} numberOfLines={1}>{row.label}</Text>
                        </View>
                        <View style={[s.td, s.sizes, { flex: 3.2 }]}>{m.sizes.map((sz) => qtyCell(p, row.cells.get(sz.value), sz.value))}</View>
                        <View style={[s.td, { flex: 0.8 }]}>
                          <Text style={[s.cell, rowQty(row) === 0 && { color: colors.danger }]}>{n0(rowQty(row))} ชิ้น</Text>
                        </View>
                        <View style={[s.td, { flex: 0.9 }]}>{priceCell(p, row)}</View>
                        <View style={[s.td, { flex: 1.2 }]}>{barcodeSummary(p, row, m)}</View>
                        <View style={[s.td, { width: 70, alignItems: 'center' }]}>{activeToggle(p, row)}</View>
                      </View>
                    ))}
                  </View>
                );
              })}

              {data && data.products.length ? (
                <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 12, gap: 8 }]}>
                  <View style={[s.row, { gap: 12, flexWrap: 'wrap' }]}>
                    <Legend box={s.qtyOut} text="หมด" />
                    <Legend box={s.qtyLow} text="เหลือน้อย" />
                    <Legend box={s.qtyOff} text="ปิดขาย" strike />
                    <View style={[s.row, { gap: 4 }]}>
                      <View style={[s.codeDot, { position: 'relative', top: 0, right: 0 }]} />
                      <Text style={s.sub}>มีบาร์โค้ดแล้ว</Text>
                    </View>
                    {manager ? <Text style={s.sub}>· กดดินสอเพื่อแก้จำนวน/ราคาในตาราง (Enter = ช่องถัดไป) · แตะตัวเลขเพื่อตั้งบาร์โค้ด/เปิด-ปิดขายทีละไซซ์</Text> : null}
                  </View>
                  <Pager page={data.page} pages={data.pages} compact={mobile} onPage={setPage} />
                </View>
              ) : null}
            </ScrollView>
          </>
        )}
      </View>

      {/* ---------- เมนูเลือก ---------- */}
      <Sheet visible={menu != null} onClose={() => setMenu(null)} title={menu === 'status' ? 'สถานะ' : menu === 'category' ? 'หมวดหมู่' : 'แสดงต่อหน้า'} width={340}>
        <View style={{ gap: 6, paddingBottom: 8 }}>
          {(menu === 'status'
            ? STATUS.map((x) => ({ id: x.id as string, label: x.label, on: status === x.id }))
            : menu === 'category'
              ? [{ id: '', label: 'ทุกหมวดหมู่', on: !category }, ...categories.map((c) => ({ id: c.id, label: c.name, on: category === c.id }))]
              : PAGE_SIZES.map((n) => ({ id: String(n), label: `${n} สินค้า`, on: limit === n }))
          ).map((o) => (
            <Pressable
              key={o.id || 'all'}
              style={[s.opt, o.on && s.optOn]}
              onPress={() => {
                if (menu === 'status') setStatus(o.id as Status);
                else if (menu === 'category') setCategory(o.id);
                else setLimit(Number(o.id));
                setPage(1);
                setMenu(null);
              }}
            >
              <Text style={[s.optText, o.on && { color: colors.primary, fontWeight: '600' }]}>{o.label}</Text>
              {o.on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </View>
      </Sheet>

      {cellDlg ? (
        <CellDialog
          product={cellDlg.p}
          cell={cellDlg.cell}
          onClose={() => setCellDlg(null)}
          onSaved={(patch, msg) => {
            patchCells([{ id: cellDlg.cell.id, patch }]);
            notify('success', msg);
            setCellDlg(null);
            onStockChanged();
            refreshStockBadge();
          }}
        />
      ) : null}
      {rowDlg ? (
        <RowBarcodeDialog
          product={rowDlg.p}
          row={rowDlg.row}
          sizes={rowDlg.sizes}
          onClose={() => setRowDlg(null)}
          onSaved={(patches, closeIt) => {
            patchCells(patches.map((x) => ({ id: x.id, patch: { barcode: x.barcode } })));
            if (closeIt) {
              notify('success', `บันทึกบาร์โค้ด ${rowDlg.p.name} · ${rowDlg.row.label} แล้ว`);
              setRowDlg(null);
            }
            onStockChanged();
          }}
        />
      ) : null}

      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="skus" onNavigate={onNavigate} />

      {/* ---------- Excel: ส่งออก / นำเข้ากลับ ---------- */}
      <Sheet visible={excelMenu} onClose={() => setExcelMenu(false)} title="Excel — สต็อกสินค้า" width={440}>
        <View style={{ gap: 8, paddingBottom: 8 }}>
          <Pressable
            style={s.xlOpt}
            onPress={() => {
              setExcelMenu(false);
              if (Platform.OS === 'web') window.open(api.stockXlsxUrl(), '_blank');
            }}
            accessibilityLabel="ส่งออกสต็อกเป็น Excel"
          >
            <Icon name="download-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.pillText, { fontWeight: '700' }]}>ส่งออกสต็อกทั้งหมด (.xlsx)</Text>
              <Text style={s.xlNote}>
                ทุกสินค้า × สี × ไซซ์ ของ{appBranch.isMain ? 'สาขาหลัก' : appBranch.name} · ชีตสินค้าหมด/ใกล้หมด · สรุปตามสินค้า{manager ? ' · สต็อกทุกสาขา' : ''} — ชีตแรกแก้ไขแล้วนำเข้ากลับได้
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={[s.xlOpt, !canImport && { opacity: 0.5 }]}
            disabled={!canImport}
            onPress={() => {
              setExcelMenu(false);
              setImporting(true);
            }}
            accessibilityLabel="นำเข้าไฟล์ Excel ที่แก้ไขแล้ว"
          >
            <Icon name="cloud-upload-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.pillText, { fontWeight: '700' }]}>นำเข้าไฟล์ที่แก้ไขแล้ว</Text>
              <Text style={s.xlNote}>
                {canImport
                  ? 'ตรวจผลก่อนบันทึกเสมอ · เลือก "ตั้งเป็นจำนวนในไฟล์" เมื่อแก้ยอดคงเหลือ · ติ๊ก "อัปเดตชื่อ / หมวดหมู่ / ราคา" เมื่อแก้ข้อมูลอื่น'
                  : manager
                    ? 'นำเข้าได้ที่สาขาหลักเท่านั้น'
                    : 'เฉพาะผู้จัดการ'}
              </Text>
            </View>
          </Pressable>
        </View>
      </Sheet>
      <ImportProductsSheet
        visible={importing}
        onClose={() => setImporting(false)}
        onDone={(r) => {
          setImporting(false);
          const m = r.summary;
          notify(
            r.failed.length ? 'info' : 'success',
            `นำเข้าแล้ว: สินค้าใหม่ ${m.newProducts} · ปรับสินค้าเดิม ${m.updatedProducts} · SKU ที่เปลี่ยน ${m.newSkus + m.updatedSkus}${r.failed.length ? ` · ไม่สำเร็จ ${r.failed.length} สินค้า` : ''}`,
          );
          load();
          loadCategories();
          onStockChanged();
          refreshStockBadge();
        }}
      />
      <BarcodeLabelSheet
        visible={!!labelFor}
        onClose={() => setLabelFor(null)}
        title={labelFor?.title}
        items={labelFor ? labelItemsOf(labelFor.products) : []}
      />
      <ToastView toast={toast} onDone={clearToast} />
    </View>
  );
}

const CODE_RE = /^[0-9A-Za-z\-_.]+$/;
const sizeName = (v: string) => (v === '-' ? 'ปกติ' : v);
const rowName = (c: SkuCell) => [c.color !== '-' ? c.color : '', c.extra, c.size !== '-' ? c.size : ''].filter(Boolean).join(' / ') || 'ปกติ';

// ---------------- SKU เดียว: บาร์โค้ด + แสดงขาย ----------------
function CellDialog({ product, cell, onClose, onSaved }: {
  product: SkuProduct; cell: SkuCell; onClose: () => void; onSaved: (patch: Partial<SkuCell>, msg: string) => void;
}) {
  const [value, setValue] = useState(cell.barcode ?? '');
  const [active, setActive] = useState(cell.active);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const code = value.trim();
  const invalid = code !== '' && !CODE_RE.test(code);
  const changed = code !== (cell.barcode ?? '') || active !== cell.active;

  const save = async () => {
    if (!changed || invalid) return;
    setSaving(true);
    setErr(null);
    try {
      const body: { barcode?: string | null; active?: boolean } = {};
      if (code !== (cell.barcode ?? '')) body.barcode = code || null;
      if (active !== cell.active) body.active = active;
      const r = await api.patchVariant(cell.id, body);
      onSaved({ barcode: r.barcode, active: r.active }, `บันทึก ${product.name} · ${rowName(cell)} แล้ว`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={rowName(cell)}
      width={420}
      footer={
        <Pressable style={[s.btn, s.primary, { flexGrow: 1 }, (saving || invalid || !changed) && { opacity: 0.45 }]} disabled={saving || invalid || !changed} onPress={save}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>บันทึก</Text>}
        </Pressable>
      }
    >
      <View style={{ gap: 10 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ flexShrink: 1 }}>
            <Text style={s.code}>#{product.code} · {product.name}</Text>
            <Text style={s.sub}>SKU {cell.sku} · คงเหลือ {n0(cell.stock)} ชิ้น · {n0(cell.price)} ฿</Text>
          </View>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Pressable onPress={() => setActive((a) => !a)} style={[s.track, active && s.trackOn]} accessibilityRole="switch" accessibilityState={{ checked: active }} accessibilityLabel="แสดงขาย">
              <View style={[s.knob, active && { transform: [{ translateX: 18 }] }]} />
            </Pressable>
            <Text style={s.sub}>{active ? 'แสดงขาย' : 'ปิดขาย'}</Text>
          </View>
        </View>
        <Text style={s.label}>บาร์โค้ด (กำหนดเอง)</Text>
        <View style={s.preview}>{code && !invalid ? <Barcode value={code} /> : <Text style={s.sub}>ตัวอย่างบาร์โค้ดจะแสดงที่นี่</Text>}</View>
        <TextInput
          value={value}
          onChangeText={(t) => setValue(t.replace(/\s/g, ''))}
          onSubmitEditing={save}
          placeholder="สแกนหรือพิมพ์รหัสที่จะพิมพ์บนป้าย"
          placeholderTextColor={colors.faint}
          style={[s.input, (invalid || err) && { borderColor: colors.danger }]}
          maxLength={40}
          autoFocus
          autoCapitalize="characters"
          accessibilityLabel="บาร์โค้ดของ SKU"
        />
        {invalid ? <Text style={s.errText}>ใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .</Text> : null}
        {err ? <Text style={s.errText}>{err}</Text> : null}
        <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
          <Pressable style={s.quick} onPress={() => setValue(cell.sku)}>
            <Text style={s.quickText}>ใช้รหัส SKU</Text>
          </Pressable>
          <Pressable style={s.quick} onPress={() => setValue(randomBarcode())}>
            <Icon name="shuffle" size={13} color={colors.primary} />
            <Text style={s.quickText}>สุ่ม EAN-13</Text>
          </Pressable>
          {cell.barcode ? (
            <Pressable style={[s.quick, { backgroundColor: colors.dangerSoft }]} onPress={() => setValue('')}>
              <Text style={[s.quickText, { color: colors.danger }]}>ลบบาร์โค้ด</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={s.sub}>สแกนบาร์โค้ดนี้ที่หน้าขาย → ใส่ตะกร้าทันที · ห้ามซ้ำกับสินค้าอื่น</Text>
      </View>
    </Sheet>
  );
}

// ---------------- ทั้งแถว (ทุกไซซ์ของสีนั้น): สแกนต่อเนื่องได้ ----------------
function RowBarcodeDialog({ product, row, sizes, onClose, onSaved }: {
  product: SkuProduct; row: MRow; sizes: Matrix['sizes']; onClose: () => void;
  onSaved: (patches: { id: number; barcode: string | null }[], close: boolean) => void;
}) {
  const cells = sizes.map((sz) => row.cells.get(sz.value)).filter((c): c is SkuCell => !!c);
  const [base, setBase] = useState<Record<number, string>>(() => Object.fromEntries(cells.map((c) => [c.id, c.barcode ?? ''])));
  const [vals, setVals] = useState<Record<number, string>>(base);
  const [errs, setErrs] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const refs = useRef<Record<number, TextInput | null>>({});

  const changed = cells.filter((c) => (vals[c.id] ?? '').trim() !== base[c.id]);
  const local: Record<number, string> = {};
  {
    const seen = new Map<string, number>();
    for (const c of cells) {
      const v = (vals[c.id] ?? '').trim();
      if (!v) continue;
      if (!CODE_RE.test(v)) local[c.id] = 'ใช้ได้เฉพาะ 0-9 A-Z - _ .';
      else if (seen.has(v)) local[c.id] = `ซ้ำกับไซซ์ ${sizeName(cells.find((x) => x.id === seen.get(v))!.size)}`;
      else seen.set(v, c.id);
    }
  }
  const hasLocalErr = Object.keys(local).length > 0;

  const save = async () => {
    if (hasLocalErr || changed.length === 0) return;
    setSaving(true);
    const done: { id: number; barcode: string | null }[] = [];
    const bad: Record<number, string> = {};
    // ล้างค่าเดิมของช่องที่จะเปลี่ยนก่อน → สลับบาร์โค้ดระหว่างไซซ์ได้
    for (const c of changed) {
      if (!base[c.id]) continue;
      try {
        await api.patchVariant(c.id, { barcode: null });
      } catch {
        /* แจ้งรายแถวด้านล่าง */
      }
    }
    for (const c of changed) {
      const v = (vals[c.id] ?? '').trim() || null;
      try {
        const r = await api.patchVariant(c.id, { barcode: v });
        done.push({ id: c.id, barcode: r.barcode });
      } catch (e) {
        bad[c.id] = (e as Error).message;
        // คืนค่าเดิมถ้าบันทึกไม่ผ่าน
        const old = base[c.id] || null;
        const back = old ? await api.patchVariant(c.id, { barcode: old }).then((r) => r.barcode).catch(() => null) : null;
        done.push({ id: c.id, barcode: back });
      }
    }
    setSaving(false);
    const ok = Object.keys(bad).length === 0;
    setErrs(bad);
    setBase((b) => ({ ...b, ...Object.fromEntries(done.map((d) => [d.id, d.barcode ?? ''])) }));
    onSaved(done, ok);
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="บาร์โค้ด (กำหนดเอง)"
      width={480}
      footer={
        <Pressable
          style={[s.btn, s.primary, { flexGrow: 1 }, (saving || hasLocalErr || changed.length === 0) && { opacity: 0.45 }]}
          disabled={saving || hasLocalErr || changed.length === 0}
          onPress={save}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>บันทึก{changed.length ? ` (${changed.length} ไซซ์)` : ''}</Text>}
        </Pressable>
      }
    >
      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 8 }]}>
          {row.hex ? <View style={[s.swatch, { backgroundColor: row.hex, width: 16, height: 16, borderRadius: 8 }]} /> : null}
          <View style={{ flexShrink: 1 }}>
            <Text style={s.code}>#{product.code} · {product.name}</Text>
            <Text style={s.cellBold}>{row.label}</Text>
          </View>
        </View>
        <Text style={s.sub}>สแกนป้ายทีละไซซ์ได้ต่อเนื่อง — กด Enter แล้วเคอร์เซอร์จะไปช่องถัดไป</Text>
        {cells.map((c, i) => {
          const e = local[c.id] ?? errs[c.id];
          return (
            <View key={c.id} style={{ gap: 2 }}>
              <View style={[s.row, { gap: 8 }]}>
                <View style={s.sizeTag}>
                  <Text style={s.sizeTagText}>{sizeName(c.size)}</Text>
                </View>
                <TextInput
                  ref={(r) => {
                    refs.current[c.id] = r;
                  }}
                  value={vals[c.id] ?? ''}
                  onChangeText={(t) => setVals((v) => ({ ...v, [c.id]: t.replace(/\s/g, '') }))}
                  onSubmitEditing={() => {
                    const next = cells[i + 1];
                    if (next) refs.current[next.id]?.focus();
                    else save();
                  }}
                  blurOnSubmit={false}
                  placeholder={`บาร์โค้ดไซซ์ ${sizeName(c.size)}`}
                  placeholderTextColor={colors.faint}
                  style={[s.input, { flex: 1, height: 42, fontSize: 14 }, !!e && { borderColor: colors.danger }]}
                  maxLength={40}
                  autoFocus={i === 0}
                  autoCapitalize="characters"
                  accessibilityLabel={`บาร์โค้ด ${row.label} ไซซ์ ${sizeName(c.size)}`}
                />
                <Pressable style={s.smallBtn} onPress={() => setVals((v) => ({ ...v, [c.id]: randomBarcode() }))} accessibilityLabel={`สุ่มบาร์โค้ดไซซ์ ${sizeName(c.size)}`}>
                  <Icon name="shuffle" size={15} color={colors.primary} />
                </Pressable>
              </View>
              {e ? <Text style={[s.errText, { marginLeft: 58 }]}>{e}</Text> : null}
            </View>
          );
        })}
        <View style={[s.row, { gap: 6, flexWrap: 'wrap', marginTop: 4 }]}>
          <Pressable style={s.quick} onPress={() => setVals((v) => ({ ...v, ...Object.fromEntries(cells.filter((c) => !(v[c.id] ?? '').trim()).map((c) => [c.id, c.sku])) }))}>
            <Text style={s.quickText}>ช่องที่ว่าง → ใช้รหัส SKU</Text>
          </Pressable>
          <Pressable style={s.quick} onPress={() => setVals((v) => ({ ...v, ...Object.fromEntries(cells.filter((c) => !(v[c.id] ?? '').trim()).map((c) => [c.id, randomBarcode()])) }))}>
            <Icon name="shuffle" size={13} color={colors.primary} />
            <Text style={s.quickText}>ช่องที่ว่าง → สุ่ม EAN-13</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

// ---------------- ชิ้นส่วนย่อย ----------------
function Legend({ box, text, strike }: { box: object; text: string; strike?: boolean }) {
  return (
    <View style={[s.row, { gap: 4 }]}>
      <View style={[s.qty, box, { width: 22, height: 18 }]}>
        <Text style={[s.qtyText, { fontSize: 9 }, strike && s.strike]}>0</Text>
      </View>
      <Text style={s.sub}>{text}</Text>
    </View>
  );
}

function DropBtn({ label, onPress, active, small }: { label: string; onPress: () => void; active?: boolean; small?: boolean }) {
  return (
    <Pressable style={[s.drop, small && { height: 34, paddingHorizontal: 10 }, active && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={[s.dropText, active && { color: colors.primary, fontWeight: '600' }]} numberOfLines={1}>{label}</Text>
      <Icon name="caret-down" size={11} color={active ? colors.primary : colors.text} />
    </Pressable>
  );
}

function ToolBtn({ icon, label, on, onPress }: { icon: IconName; label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[s.tool, on && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]} onPress={onPress} accessibilityLabel={label}>
      <Icon name={icon} size={17} color={on ? colors.primary : colors.text} />
    </Pressable>
  );
}

function Th({ label, flex, width, center, sortKey, sort, onSort }: {
  label: string; flex?: number; width?: number; center?: boolean;
  sortKey?: SortKey; sort?: { key: SortKey; dir: 'asc' | 'desc' } | null; onSort?: (k: SortKey) => void;
}) {
  const on = sortKey && sort?.key === sortKey;
  const body = (
    <>
      <Text style={[s.thText, on && { color: colors.primary }]} numberOfLines={1}>{label}</Text>
      {sortKey ? <Icon name={on ? (sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'swap-vertical'} size={12} color={on ? colors.primary : colors.faint} /> : null}
    </>
  );
  const style = [s.th, flex ? { flex } : { width }, center && { justifyContent: 'center' as const }];
  return sortKey && onSort ? (
    <Pressable style={style} onPress={() => onSort(sortKey)} accessibilityLabel={`เรียงตาม${label}`}>{body}</Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

function Pager({ page, pages, onPage, compact }: { page: number; pages: number; onPage: (p: number) => void; compact?: boolean }) {
  const nums = useMemo(() => {
    const span = compact ? 1 : 2;
    const set = new Set<number>([1, pages]);
    for (let i = page - span; i <= page + span; i++) if (i >= 1 && i <= pages) set.add(i);
    const list = [...set].sort((a, b) => a - b);
    const out: (number | '…')[] = [];
    list.forEach((n, i) => {
      if (i > 0 && n - list[i - 1] > 1) out.push('…');
      out.push(n);
    });
    return out;
  }, [page, pages, compact]);
  if (pages <= 1) return null;
  return (
    <View style={s.pager}>
      <Pressable style={[s.pg, page <= 1 && { opacity: 0.4 }]} disabled={page <= 1} onPress={() => onPage(page - 1)} accessibilityLabel="ก่อนหน้า">
        {compact ? <Icon name="chevron-back" size={14} color={colors.text} /> : <Text style={s.pgText}>ก่อนหน้า</Text>}
      </Pressable>
      {nums.map((n, i) =>
        n === '…' ? (
          <View key={`e${i}`} style={s.pg}>
            <Text style={[s.pgText, { color: colors.faint }]}>…</Text>
          </View>
        ) : (
          <Pressable key={n} style={[s.pg, n === page && s.pgOn]} onPress={() => onPage(n)} accessibilityLabel={`หน้า ${n}`}>
            <Text style={[s.pgText, n === page && { color: colors.primary, fontWeight: '700' }]}>{n}</Text>
          </Pressable>
        ),
      )}
      <Pressable style={[s.pg, page >= pages && { opacity: 0.4 }]} disabled={page >= pages} onPress={() => onPage(page + 1)} accessibilityLabel="ถัดไป">
        {compact ? <Icon name="chevron-forward" size={14} color={colors.text} /> : <Text style={s.pgText}>ถัดไป</Text>}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  sub: { fontFamily: font, fontSize: 11, color: colors.sub },
  label: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  pillBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  addBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
  xlOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  xlNote: { fontFamily: font, fontSize: 12, color: colors.sub },
  pillText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  drop: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, maxWidth: 220 },
  dropText: { fontFamily: font, fontSize: 13, color: colors.text, flexShrink: 1 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, flexGrow: 1, maxWidth: 520 },
  searchInput: { flex: 1, fontFamily: font, fontSize: 13, color: colors.text, outlineStyle: 'none', minWidth: 0 } as object,
  count: { fontFamily: font, fontSize: 13, color: colors.sub },
  tool: { width: 38, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  pager: { flexDirection: 'row', borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: 'hidden' },
  pg: { minWidth: 34, height: 34, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.line, backgroundColor: '#fff' },
  pgOn: { backgroundColor: colors.primarySoft },
  pgText: { fontFamily: font, fontSize: 13, color: colors.text },
  thead: { flexDirection: 'row', gap: 4, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 6 },
  th: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
  thText: { fontFamily: font, fontSize: 12, fontWeight: '700', color: colors.text, flexShrink: 1 },
  qtyInput: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text, textAlign: 'center', borderColor: '#9DB7F7', paddingHorizontal: 2 },
  qtyDirty: { borderColor: colors.primary, backgroundColor: '#EEF3FF', color: colors.primary },
  priceInput: { fontFamily: font, fontSize: 13, color: colors.text, height: 30, width: 80, maxWidth: '100%', borderRadius: radius.sm, borderWidth: 1, borderColor: '#9DB7F7', paddingHorizontal: 6, textAlign: 'center', backgroundColor: '#fff' },
  cancelBtn: { height: 30, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', justifyContent: 'center' },
  cancelText: { fontFamily: font, fontSize: 12, color: colors.text },
  saveBtn: { height: 30, minWidth: 64, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: font, fontSize: 12, color: '#fff', fontWeight: '700' },
  groupEditing: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: '#F8FAFF' },
  group: { borderRadius: radius.sm, marginTop: 8, paddingHorizontal: 6, paddingBottom: 4 },
  tr: { flexDirection: 'row', gap: 4, minHeight: 44, alignItems: 'center' },
  productRow: { minHeight: 54 },
  trLine: { borderTopWidth: 1, borderTopColor: '#ECEEF2' },
  td: { paddingHorizontal: 8, paddingVertical: 5, justifyContent: 'center', minWidth: 0 },
  rowCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 6 },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start', gap: 3 },
  sizeHeadBox: { width: CELL_W, height: 24, borderRadius: radius.sm, backgroundColor: '#E9ECF2', alignItems: 'center', justifyContent: 'center' },
  sizeHead: { fontFamily: font, fontSize: 11, fontWeight: '700', color: colors.text },
  qty: { width: CELL_W, height: 30, borderRadius: radius.sm, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E4E7EC', alignItems: 'center', justifyContent: 'center' },
  qtyHover: { borderColor: colors.primary },
  qtyText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  qtyOut: { backgroundColor: '#FFF1F1', borderColor: '#F7C9CB' },
  qtyLow: { backgroundColor: '#FFF7E6', borderColor: '#F3D9A4' },
  qtyOff: { backgroundColor: '#F1F2F4', borderColor: '#E4E7EC', opacity: 0.6 },
  qtyNone: { backgroundColor: 'transparent', borderColor: 'transparent' },
  qtyNoneText: { fontFamily: font, fontSize: 13, color: colors.faint },
  strike: { textDecorationLine: 'line-through', color: colors.faint },
  codeDot: { position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  codeLink: { fontFamily: font, fontSize: 13, color: colors.primary, fontWeight: '500' },
  code: { fontFamily: font, fontSize: 12, color: colors.primary },
  name: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '600' },
  off: { fontFamily: font, fontSize: 10, color: colors.danger, marginTop: 2 },
  editBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  cell: { fontFamily: font, fontSize: 13, color: colors.text, flexShrink: 1 },
  cellBold: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text, flexShrink: 1 },
  barcodeText: { fontFamily: font, fontSize: 13, color: colors.text, letterSpacing: 0.3 },
  addCode: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, height: 26, borderRadius: radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: '#9DB7F7', alignSelf: 'flex-start' },
  addCodeText: { fontFamily: font, fontSize: 11, color: colors.primary, fontWeight: '600' },
  codeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 28, borderRadius: radius.pill, backgroundColor: colors.primarySoft, alignSelf: 'flex-start' },
  codeChipDone: { backgroundColor: colors.successSoft },
  codeChipNone: { backgroundColor: '#fff', borderWidth: 1, borderStyle: 'dashed', borderColor: '#9DB7F7' },
  codeChipText: { fontFamily: font, fontSize: 11, color: colors.primary, fontWeight: '600' },
  okBtn: { width: 34, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  thumb: { borderRadius: radius.sm, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#EEF0F3' },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, marginBottom: 10, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: colors.surface },
  cardRow: { gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#ECEEF2' },
  error: { fontFamily: font, color: colors.danger, textAlign: 'center', marginVertical: 20 },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 6 },
  emptyText: { fontFamily: font, fontSize: 14, color: colors.sub },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 46, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  optOn: { backgroundColor: colors.primarySoft },
  optText: { fontFamily: font, fontSize: 14, color: colors.text },
  preview: { minHeight: 96, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 10 },
  input: { fontFamily: font, fontSize: 16, color: colors.text, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff', letterSpacing: 0.5 },
  errText: { fontFamily: font, fontSize: 12, color: colors.danger },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  quickText: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '600' },
  sizeTag: { width: 50, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sizeTagText: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.text },
  smallBtn: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  track: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.line, padding: 3 },
  trackOn: { backgroundColor: colors.success },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  btn: { height: 48, paddingHorizontal: 18, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
