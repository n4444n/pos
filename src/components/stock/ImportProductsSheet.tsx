// นำเข้าสินค้าจากที่อื่น: เลือกไฟล์ .xlsx/.csv → ตรวจ (ไม่บันทึก) → ยืนยันนำเข้า
// คอลัมน์: Code · Custom barcode id · Quantity · Product name · Colors · Size · Category · Notify when product less than · Price
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, type ImportResult, type ImportRow } from '../../api';
import { n0 } from '../../format';
import { fileToRows, pickFile } from '../../sheetImport';
import { colors, font, radius } from '../../theme';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';

/** ชื่อหัวคอลัมน์ที่รองรับ (ไม่สนตัวพิมพ์เล็ก/ใหญ่) */
const HEADERS: Record<keyof Omit<ImportRow, 'line'>, string[]> = {
  code: ['code', 'product code', 'รหัสสินค้า', 'รหัส'],
  barcode: ['custom barcode id', 'barcode', 'บาร์โค้ด', 'sku'],
  qty: ['quantity', 'qty', 'stock', 'จำนวน', 'คงเหลือ'],
  name: ['product name', 'name', 'ชื่อสินค้า', 'สินค้า'],
  color: ['colors', 'color', 'colour', 'สี'],
  size: ['size', 'sizes', 'ไซซ์', 'ไซส์', 'ขนาด'],
  category: ['category', 'หมวดหมู่', 'หมวด'],
  lowStock: ['notify when product less than', 'low stock', 'แจ้งเตือนเมื่อเหลือ', 'แจ้งเตือน'],
  price: ['price', 'ราคา', 'ราคาขาย'],
};

function parse(table: string[][]): { rows: ImportRow[]; missing: string[] } {
  const norm = (s: string) => (s ?? '').trim().toLowerCase();
  const hi = table.findIndex((r) => r.some((c) => HEADERS.code.includes(norm(c))));
  if (hi < 0) return { rows: [], missing: ['Code'] };
  const head = table[hi].map(norm);
  const col = Object.fromEntries(
    (Object.keys(HEADERS) as (keyof typeof HEADERS)[]).map((k) => [k, head.findIndex((h) => HEADERS[k].includes(h))]),
  ) as Record<keyof typeof HEADERS, number>;
  const missing = (['code', 'qty', 'name'] as const).filter((k) => col[k] < 0).map((k) => ({ code: 'Code', qty: 'Quantity', name: 'Product name' })[k]);
  const get = (r: string[], k: keyof typeof HEADERS) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
  const rows = table
    .slice(hi + 1)
    .map((r, i) => ({
      line: hi + i + 2, code: get(r, 'code'), barcode: get(r, 'barcode'), qty: get(r, 'qty'), name: get(r, 'name'), color: get(r, 'color'),
      size: get(r, 'size'), category: get(r, 'category'), lowStock: get(r, 'lowStock'), price: get(r, 'price'),
    }))
    .filter((r) => r.code || r.name);
  return { rows, missing };
}

export function ImportProductsSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (r: ImportResult) => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [updateInfo, setUpdateInfo] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setRows([]);
    setResult(null);
    setErr(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const check = async (r = rows, m = mode, u = updateInfo) => {
    if (!r.length) return;
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.importProducts({ rows: r, mode: m, updateInfo: u, apply: false }));
    } catch (e) {
      setErr((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const f = await pickFile('.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (!f) return;
    reset();
    setFile(f.name);
    try {
      const { rows: r, missing } = parse(await fileToRows(f));
      if (missing.length) throw new Error(`ไม่พบคอลัมน์ ${missing.join(', ')} ในไฟล์ — ใช้หัวตาราง: Code, Custom barcode id, Quantity, Product name, Colors, Size, Category, Notify when product less than, Price`);
      if (!r.length) throw new Error('ไม่พบรายการสินค้าในไฟล์');
      setRows(r);
      check(r);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const apply = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.importProducts({ rows, mode, updateInfo, apply: true });
      reset();
      onDone(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sm = result?.summary;
  const canApply = !!sm && !busy && sm.newProducts + sm.updatedProducts > 0;

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="นำเข้าสินค้าจากที่อื่น"
      width={640}
      footer={
        <View style={[s.row, { justifyContent: 'flex-end' }]}>
          <Pressable style={s.ghost} onPress={close} disabled={busy}>
            <Text style={s.btnText}>ยกเลิก</Text>
          </Pressable>
          <Pressable style={[s.primary, !canApply && { opacity: 0.45 }]} onPress={apply} disabled={!canApply}>
            {busy ? <ActivityIndicator color="#fff" /> : <Icon name="cloud-upload-outline" size={18} color="#fff" />}
            <Text style={[s.btnText, { color: '#fff', fontWeight: '700' }]}>
              {sm ? `นำเข้า ${n0(sm.newProducts + sm.updatedProducts)} สินค้า` : 'นำเข้า'}
            </Text>
          </Pressable>
        </View>
      }
    >
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: 12 }}>
        <Pressable style={s.drop} onPress={choose} disabled={busy}>
          <Icon name={file ? 'document-text-outline' : 'cloud-upload-outline'} size={28} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.dropTitle}>{file ?? 'เลือกไฟล์ .xlsx หรือ .csv'}</Text>
            <Text style={s.small}>
              {file ? `${n0(rows.length)} แถว · กดเพื่อเลือกไฟล์ใหม่` : 'คอลัมน์: Code · Custom barcode id · Quantity · Product name · Colors · Size · Category · Notify when product less than · Price'}
            </Text>
          </View>
        </Pressable>

        <Text style={s.label}>สินค้าที่มีอยู่แล้ว (รหัสสินค้าตรงกัน) — จำนวนในไฟล์ให้</Text>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {([['add', 'บวกเพิ่มจากสต็อกเดิม (โอนเข้า)'], ['set', 'ตั้งเป็นจำนวนในไฟล์']] as const).map(([k, t]) => (
            <Pressable key={k} style={[s.chip, mode === k && s.chipOn]} onPress={() => { setMode(k); check(rows, k, updateInfo); }} disabled={busy}>
              <Text style={[s.chipText, mode === k && { color: '#fff' }]}>{t}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={s.row} onPress={() => { setUpdateInfo(!updateInfo); check(rows, mode, !updateInfo); }} disabled={busy}>
          <Icon name={updateInfo ? 'checkbox' : 'square-outline'} size={20} color={updateInfo ? colors.primary : colors.sub} />
          <Text style={s.text}>อัปเดตชื่อ / หมวดหมู่ / ราคา / แจ้งเตือนเหลือน้อย ของสินค้าที่มีอยู่แล้วตามไฟล์ด้วย</Text>
        </Pressable>
        <Text style={s.small}>สินค้าใหม่ = สร้างให้พร้อม SKU ตามสี/ไซซ์ + บาร์โค้ดจากไฟล์ · หมวดหมู่ที่ยังไม่มีจะสร้างให้ · สต็อกเข้าสาขานี้</Text>

        {err ? <Text style={s.err}>{err}</Text> : null}
        {busy && !sm ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} /> : null}

        {sm ? (
          <>
            <Text style={s.label}>ผลการตรวจ (ยังไม่บันทึก)</Text>
            <View style={s.stats}>
              <Stat n={sm.newProducts} label="สินค้าใหม่" sub={`${n0(sm.newSkus)} SKU ใหม่`} color={colors.success} />
              <Stat n={sm.updatedProducts} label="สินค้าเดิมที่เปลี่ยน" sub={`${n0(sm.updatedSkus)} SKU ปรับ · ${n0(sm.unchangedSkus)} ไม่เปลี่ยน`} color={colors.primary} />
              <Stat n={sm.units} label={mode === 'add' ? 'ตัวที่รับเข้า' : 'ส่วนต่างสต็อก (ตัว)'} sub={`จาก ${n0(sm.products)} รหัสสินค้า`} color={colors.text} />
            </View>
            {sm.newCategories.length ? <Text style={s.small}>หมวดหมู่ใหม่: {sm.newCategories.join(', ')}</Text> : null}
            <Issues title="นำเข้าไม่ได้ทั้งสินค้า" color={colors.danger} items={result!.failed.map((f) => `${f.code} ${f.name}: ${f.text}`)} />
            <Issues title="แถวที่ข้าม" color={colors.danger} items={result!.errors.map((e) => `แถว ${e.line}${e.code ? ` (${e.code})` : ''}: ${e.text}`)} />
            <Issues title="แถวที่ปรับค่า" color="#B26A00" items={result!.warnings.map((e) => `แถว ${e.line} (${e.code}): ${e.text}`)} />
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

function Stat({ n, label, sub, color }: { n: number; label: string; sub: string; color: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statN, { color }]}>{n0(n)}</Text>
      <Text style={s.text}>{label}</Text>
      <Text style={s.small}>{sub}</Text>
    </View>
  );
}

function Issues({ title, color, items }: { title: string; color: string; items: string[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const show = all ? items : items.slice(0, 5);
  return (
    <View style={s.issues}>
      <Text style={[s.label, { color }]}>{title} ({n0(items.length)})</Text>
      {show.map((t, i) => (
        <Text key={i} style={s.small}>• {t}</Text>
      ))}
      {items.length > 5 ? (
        <Pressable onPress={() => setAll(!all)}>
          <Text style={[s.small, { color: colors.primary, fontWeight: '600' }]}>{all ? 'ย่อ' : `ดูทั้งหมด ${n0(items.length)} รายการ`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drop: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.md, borderWidth: 1.5,
    borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.primarySoft,
  },
  dropTitle: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  label: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.text },
  text: { fontFamily: font, fontSize: 13, color: colors.text, flexShrink: 1 },
  small: { fontFamily: font, fontSize: 12, color: colors.sub },
  err: { fontFamily: font, fontSize: 13, color: colors.danger, backgroundColor: colors.dangerSoft, padding: 10, borderRadius: radius.md },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  stats: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  stat: { flex: 1, minWidth: 160, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, gap: 2 },
  statN: { fontFamily: font, fontSize: 24, fontWeight: '800' },
  issues: { padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, gap: 3 },
  ghost: { height: 44, paddingHorizontal: 18, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  primary: { height: 44, paddingHorizontal: 20, borderRadius: radius.pill, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  btnText: { fontFamily: font, fontSize: 14, color: colors.text },
});
