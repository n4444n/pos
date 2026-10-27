// สต็อก: เพิ่ม/แก้ไขสินค้า (รายละเอียด · ราคา · ตัวเลือก · รูป · ยกเว้น VAT)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api } from '../../api';
import { priceRange, thaiDateTime, variantLabel } from '../../format';
import {
  comboCount, emptyDraft, fromDraft, MAX_SKU, remapRows, syncRows, toDraft, validate, type DAttr, type Draft,
} from '../../stockDraft';
import type { Toast } from '../../store/usePos';
import { colors, font, radius } from '../../theme';
import type { ProductFull } from '../../types';
import { Chips, FieldLabel } from '../history/Chips';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { useAppSettings } from '../../appSettings';
import { AttributeEditor } from './AttributeEditor';
import { ImagePicker } from './ImagePicker';
import { Barcode } from './Barcode';
import { SkuMatrix } from './SkuMatrix';

type Category = { id: string; name: string; icon: string };

interface Props {
  productId: number | 'new';
  categories: Category[];
  onCategoriesChanged: () => void;
  onClose: () => void;
  onSaved: (p: ProductFull, isNew: boolean) => void;
  notify: (kind: Toast['kind'], text: string) => void;
}

/** หน้าเพิ่ม/แก้ไขสินค้า — ซ้าย: รายละเอียด · ขวา: SKU (คุณสมบัติ + ต้นทุน/ราคา/จำนวน/แสดงขาย) */
export function ProductEditor({ productId, categories, onCategoriesChanged, onClose, onSaved, notify }: Props) {
  // สาขาย่อย: รายการสินค้ามาจากสาขาหลัก → แก้ได้เฉพาะจำนวน/ราคาขายของสาขานี้
  const appBranch = useAppSettings().branch;
  const branchMode = !appBranch.isMain && productId !== 'new';
  const { width } = useWindowDimensions();
  const twoCol = width >= 1100;
  const compactMatrix = width < 700;
  const isNew = productId === 'new';

  const [draft, setDraft] = useState<Draft | null>(isNew ? emptyDraft(categories[0]?.id ?? '') : null);
  const [initial, setInitial] = useState<string>('');
  const [full, setFull] = useState<ProductFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (isNew) {
      const d = emptyDraft(categories[0]?.id ?? '');
      setDraft(d);
      setInitial(JSON.stringify(d));
      return;
    }
    api
      .product(productId)
      .then((p) => {
        const d = toDraft(p);
        setFull(p);
        setDraft(d);
        setInitial(JSON.stringify(d));
      })
      .catch((e: Error) => setError(e.message));
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useCallback((p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);

  const setAttrs = (attrs: DAttr[]) =>
    setDraft((d) => {
      if (!d) return d;
      const first = d.rows[0];
      const rows = syncRows(attrs, remapRows(d.attrs, attrs, d.rows), { cost: first?.cost ?? '0', price: first?.price ?? '' });
      return { ...d, attrs, rows };
    });

  const dirty = !!draft && JSON.stringify(draft) !== initial;
  const problem = draft ? validate(draft) : null;
  const totals = useMemo(() => {
    if (!draft) return null;
    const act = draft.rows.filter((r) => r.active);
    const prices = act.map((r) => Number(r.price)).filter((n) => Number.isFinite(n) && String(n) !== '');
    return {
      qty: draft.rows.reduce((a, r) => a + (Number(r.stock) || 0), 0),
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      low: act.filter((r) => Number(r.stock || 0) <= draft.lowStock).length,
    };
  }, [draft]);

  const save = async () => {
    if (!draft) return;
    const msg = validate(draft);
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const p = await api.saveProduct(draft.id, fromDraft(draft));
      const d = toDraft(p);
      setFull(p);
      setDraft(d);
      setInitial(JSON.stringify(d));
      onSaved(p, draft.id == null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const back = () => (dirty ? setConfirmLeave(true) : onClose());

  const addCategory = async () => {
    if (!newCat?.trim()) return;
    try {
      const c = await api.createCategory({ name: newCat.trim(), icon: draft?.art ?? 'tshirt' });
      onCategoriesChanged();
      patch({ categoryId: c.id });
      setNewCat(null);
      notify('success', `เพิ่มหมวดหมู่ "${c.name}" แล้ว`);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  // Ctrl/⌘ + S = บันทึก
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!draft) {
    return (
      <View style={s.center}>
        {error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator color={colors.primary} size="large" />}
      </View>
    );
  }

  const details = (
    <View style={[s.card, branchMode && { opacity: 0.6 }]} pointerEvents={branchMode ? 'none' : 'auto'}>
      <View style={s.cardHead}>
        <Icon name="information-circle-outline" size={18} color={colors.text} />
        <Text style={s.cardTitle}>รายละเอียดสินค้า</Text>
      </View>

      {/* บาร์โค้ดจากรหัสสินค้า */}
      <View style={s.barcodeBox}>
        {(() => {
          const code = draft.code.trim() || full?.sku || '';
          return code ? (
            <Barcode value={code} />
          ) : (
            <View style={s.noBarcode}>
              <Icon name="barcode-outline" size={34} color={colors.faint} />
              <Text style={s.small}>ยังไม่มีรหัสสินค้า — พิมพ์รหัสด้านล่าง หรือเว้นว่างให้ระบบสร้างให้ตอนบันทึก</Text>
            </View>
          );
        })()}
        {full?.updatedAt ? <Text style={s.updated}>อัปเดต: {thaiDateTime(full.updatedAt)}</Text> : null}
      </View>

      <FieldLabel>รหัสสินค้า (บ่งบอกว่าสินค้านี้คืออะไร)</FieldLabel>
      <TextInput
        value={draft.code}
        onChangeText={(t) => patch({ code: t.replace(/\s/g, '').toUpperCase() })}
        placeholder="เช่น TS-001, SHIRT-LINEN — เว้นว่าง = สร้างอัตโนมัติ (P000123)"
        placeholderTextColor={colors.faint}
        style={s.input}
        maxLength={40}
        autoCapitalize="characters"
        accessibilityLabel="รหัสสินค้า"
      />
      <Text style={s.small}>รหัส SKU ของแต่ละตัวเลือกสร้างจากรหัสนี้ เช่น {draft.code || 'TS-001'}-0001 · บาร์โค้ดสำหรับพิมพ์ป้ายของแต่ละ SKU ตั้งได้ที่หน้า "สต็อกสินค้า (คุณสมบัติ)"</Text>

      <FieldLabel required>ชื่อสินค้า</FieldLabel>
      <TextInput
        value={draft.name}
        onChangeText={(t) => patch({ name: t })}
        placeholder="เช่น เสื้อยืดคอกลม Cotton 100%"
        placeholderTextColor={colors.faint}
        style={[s.input, !draft.name.trim() && s.inputWarn]}
        maxLength={120}
        accessibilityLabel="ชื่อสินค้า"
      />

      <View style={[s.row, { justifyContent: 'space-between', marginTop: 12, marginBottom: 6 }]}>
        <Text style={s.label}>
          หมวดหมู่<Text style={{ color: colors.danger }}> *</Text>
        </Text>
        <Pressable onPress={() => setNewCat('')}>
          <Text style={s.link}>+ เพิ่มหมวดหมู่</Text>
        </Pressable>
      </View>
      <Chips options={categories.map((c) => ({ value: c.id, label: c.name }))} value={draft.categoryId} onChange={(v) => patch({ categoryId: v })} />

      <Pressable style={s.toggleRow} onPress={() => patch({ active: !draft.active })} accessibilityRole="switch" accessibilityState={{ checked: draft.active }}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>แสดงขายที่หน้าขาย</Text>
          <Text style={s.small}>{draft.active ? 'เปิดอยู่ — ลูกค้าซื้อได้' : 'ปิดอยู่ — ซ่อนจากหน้าขาย (ข้อมูลและสต็อกยังอยู่)'}</Text>
        </View>
        <View style={[s.track, draft.active && s.trackOn]}>
          <View style={[s.knob, draft.active && { transform: [{ translateX: 18 }] }]} />
        </View>
      </Pressable>

      {/* ภาษีมูลค่าเพิ่ม: สินค้าเสีย VAT / ยกเว้น VAT (มีผลกับบิลใหม่) */}
      <FieldLabel>ภาษีมูลค่าเพิ่ม (VAT)</FieldLabel>
      <View style={s.vatSeg}>
        {([[false, 'เสีย VAT', 'ราคาขายรวม VAT แล้ว'], [true, 'ยกเว้น VAT', 'ไม่คิด VAT ในบิล']] as const).map(([v, label, hint]) => {
          const on = draft.vatExempt === v;
          return (
            <Pressable key={label} onPress={() => patch({ vatExempt: v })} style={[s.vatBtn, on && s.vatOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
              <Text style={[s.label, on && { color: colors.primary }]}>{label}</Text>
              <Text style={s.small}>{hint}</Text>
            </Pressable>
          );
        })}
      </View>

      <FieldLabel>ภาพสินค้า</FieldLabel>
      <ImagePicker imageUrl={draft.imageUrl} art={draft.art} tint={draft.tint} onChange={(v) => patch(v)} />

      <FieldLabel>แจ้งเตือนเมื่อสินค้าเหลือน้อยกว่าหรือเท่ากับ</FieldLabel>
      <View style={s.row}>
        <View style={s.stepper}>
          <Pressable style={s.stepBtn} onPress={() => patch({ lowStock: Math.max(0, draft.lowStock - 1) })} accessibilityLabel="ลด">
            <Icon name="remove" size={16} />
          </Pressable>
          <TextInput
            value={String(draft.lowStock)}
            onChangeText={(t) => patch({ lowStock: Math.min(9999, Number(t.replace(/[^0-9]/g, '')) || 0) })}
            keyboardType="number-pad"
            style={s.stepInput}
            accessibilityLabel="จุดแจ้งเตือนสินค้าเหลือน้อย"
          />
          <Pressable style={s.stepBtn} onPress={() => patch({ lowStock: draft.lowStock + 1 })} accessibilityLabel="เพิ่ม">
            <Icon name="add" size={16} />
          </Pressable>
        </View>
        <Text style={s.small}>ชิ้น ต่อ SKU (0 = แจ้งเฉพาะตอนหมด)</Text>
      </View>

      <FieldLabel>หมายเหตุเพิ่มเติม</FieldLabel>
      <TextInput
        value={draft.note}
        onChangeText={(t) => patch({ note: t })}
        placeholder="เช่น เนื้อผ้า วิธีดูแล ผู้ผลิต ตำแหน่งที่เก็บ"
        placeholderTextColor={colors.faint}
        style={[s.input, s.textarea]}
        multiline
        maxLength={2000}
        accessibilityLabel="หมายเหตุ"
      />
      <Text style={[s.small, { textAlign: 'right' }]}>{draft.note.length}/2000</Text>
    </View>
  );

  const skus = (
    <View style={{ gap: 14 }}>
      <View style={s.card}>
        <View style={s.cardHead}>
          <Icon name="layers-outline" size={18} color={colors.text} />
          <Text style={s.cardTitle}>สินค้า SKU</Text>
          <Text style={s.cardSub}>(เช่น สี, ไซซ์, ดีไซน์)</Text>
        </View>
        {branchMode ? (
          <Text style={s.small}>{draft.attrs.map((a) => `${a.name}: ${a.options.map((o) => o.value).join(', ')}`).join(' · ') || '—'}</Text>
        ) : (
          <AttributeEditor attrs={draft.attrs} onChange={setAttrs} />
        )}
        {comboCount(draft.attrs) > MAX_SKU ? (
          <Text style={s.error}>ตัวเลือกรวมกัน {comboCount(draft.attrs)} แบบ เกิน {MAX_SKU} รายการ — แสดงแค่ {MAX_SKU} แบบแรก</Text>
        ) : null}
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <Icon name="pricetags-outline" size={18} color={colors.text} />
          <Text style={s.cardTitle}>ต้นทุน · ราคา · จำนวน</Text>
          <Text style={s.cardSub}>{draft.rows.length} SKU</Text>
        </View>
        <SkuMatrix
          productCode={draft.code.trim() || full?.sku || ''}
          productName={draft.name}
          attrs={draft.attrs}
          rows={draft.rows}
          lowStock={draft.lowStock}
          showCost={!branchMode}
          lockActive={branchMode}
          compact={compactMatrix}
          onChange={(rows) => patch({ rows })}
        />
      </View>

      {full && full.moves.length ? (
        <View style={s.card}>
          <View style={s.cardHead}>
            <Icon name="time-outline" size={18} color={colors.text} />
            <Text style={s.cardTitle}>ประวัติสต็อกล่าสุด</Text>
          </View>
          {full.moves.slice(0, 8).map((m) => (
            <View key={m.id} style={s.moveRow}>
              <Text style={[s.moveDelta, { color: m.delta > 0 ? colors.success : colors.danger }]}>{m.delta > 0 ? `+${m.delta}` : m.delta}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.moveText}>{variantLabel(m)} · {m.reason}</Text>
                <Text style={s.small}>{thaiDateTime(m.createdAt)} · {m.staff ?? '—'} · คงเหลือ {m.balance}</Text>
              </View>
            </View>
          ))}
          <Text style={s.small}>การขาย/คืนสินค้าจากบิลดูได้ที่หน้าประวัติการขาย</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* หัวหน้า */}
      <View style={s.head}>
        <Pressable style={s.backBtn} onPress={back} accessibilityLabel="กลับไปรายการสินค้า">
          <Icon name="arrow-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1}>{isNew ? 'เพิ่มสินค้าใหม่' : draft.name || 'แก้ไขสินค้า'}</Text>
          <Text style={s.small}>สต็อกสินค้า / {isNew ? 'เพิ่มสินค้า' : `รหัสสินค้า ${full?.sku ?? ''}`}</Text>
        </View>
        {totals ? (
          <View style={[s.pills, compactMatrix && { width: '100%', paddingLeft: 54 }]}>
            <Text style={[s.pill, { color: colors.primary }]}>{totals.qty.toLocaleString()} ชิ้น</Text>
            <Text style={[s.pill, { backgroundColor: colors.primarySoft, color: colors.primary }]}>
              {totals.min || totals.max ? priceRange(totals.min, totals.max) : '฿—'}
            </Text>
            {totals.low ? <Text style={[s.pill, { backgroundColor: '#FFF4E0', color: '#B26A00' }]}>เหลือน้อย {totals.low}</Text> : null}
          </View>
        ) : null}
      </View>

      {branchMode ? (
        <View style={s.branchNote}>
          <Icon name="location-outline" size={16} color={colors.primary} />
          <Text style={s.branchNoteText}>
            สาขา <Text style={{ fontWeight: '700' }}>{appBranch.name}</Text>: แก้ได้เฉพาะ <Text style={{ fontWeight: '700' }}>ราคาขาย</Text> และ <Text style={{ fontWeight: '700' }}>จำนวน</Text> ของสาขานี้ · ชื่อ หมวดหมู่ รูป ตัวเลือก ต้นทุน และการแสดงขาย แก้ที่สาขาหลัก
          </Text>
        </View>
      ) : null}
      {twoCol ? (
        // จอกว้าง: ซ้าย (รายละเอียด) อยู่กับที่ · ขวา (SKU) เลื่อนแยกอิสระ
        <View style={{ flex: 1, flexDirection: 'row', gap: 14, minHeight: 0 }}>
          <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ paddingBottom: 90 }} showsVerticalScrollIndicator={false}>
            {details}
          </ScrollView>
          <ScrollView style={{ flex: 1.25, minWidth: 0 }} contentContainerStyle={{ paddingBottom: 90 }}>
            {skus}
          </ScrollView>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 90, gap: 14 }}>
          {details}
          {skus}
        </ScrollView>
      )}

      {/* แถบบันทึก */}
      <View style={s.saveBar}>
        <Text style={[s.saveMsg, error ? { color: colors.danger } : problem && dirty ? { color: '#B26A00' } : null]} numberOfLines={2}>
          {error ?? (dirty ? problem ?? 'มีการแก้ไขที่ยังไม่บันทึก' : 'บันทึกแล้ว')}
        </Text>
        <Pressable style={[s.btn, s.ghost]} onPress={back}>
          <Text style={s.ghostText}>{dirty ? 'ยกเลิก' : 'กลับ'}</Text>
        </Pressable>
        <Pressable style={[s.btn, s.primary, (!dirty || saving) && { opacity: 0.5 }]} disabled={!dirty || saving} onPress={save}>
          {saving ? <ActivityIndicator color="#fff" /> : (
            <>
              <Icon name="save-outline" size={16} color="#fff" />
              <Text style={s.primaryText}>{isNew && !full ? 'เพิ่มสินค้า' : 'บันทึก'}</Text>
            </>
          )}
        </Pressable>
      </View>

      <Sheet visible={newCat != null} onClose={() => setNewCat(null)} title="เพิ่มหมวดหมู่" width={380}
        footer={
          <Pressable style={[s.btn, s.primary, { flexGrow: 1 }, !newCat?.trim() && { opacity: 0.45 }]} disabled={!newCat?.trim()} onPress={addCategory}>
            <Text style={s.primaryText}>เพิ่มหมวดหมู่</Text>
          </Pressable>
        }
      >
        <TextInput value={newCat ?? ''} onChangeText={setNewCat} placeholder="เช่น ชุดว่ายน้ำ, ชุดนอน" placeholderTextColor={colors.faint} style={s.input} autoFocus maxLength={40} onSubmitEditing={addCategory} />
        <Text style={[s.small, { marginTop: 6 }]}>ไอคอนหมวดใช้ตามไอคอนสินค้าที่เลือกไว้</Text>
      </Sheet>

      <Sheet visible={confirmLeave} onClose={() => setConfirmLeave(false)} title="ยังไม่ได้บันทึก" width={380}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[s.btn, s.ghost, { flexGrow: 1 }]} onPress={() => { setConfirmLeave(false); onClose(); }}>
              <Text style={[s.ghostText, { color: colors.danger }]}>ทิ้งการแก้ไข</Text>
            </Pressable>
            <Pressable style={[s.btn, s.primary, { flexGrow: 1 }]} onPress={() => setConfirmLeave(false)}>
              <Text style={s.primaryText}>แก้ไขต่อ</Text>
            </Pressable>
          </View>
        }
      >
        <Text style={s.moveText}>มีการแก้ไขที่ยังไม่บันทึก ต้องการออกจากหน้านี้หรือไม่?</Text>
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  branchNote: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.primarySoft, padding: 10, borderRadius: radius.md, marginBottom: 10 },
  branchNoteText: { flex: 1, fontFamily: font, fontSize: 12, color: colors.text, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  backBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: { fontFamily: font, fontSize: 13, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surface, overflow: 'hidden' },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 4, backgroundColor: '#fff' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  cardTitle: { fontFamily: font, fontSize: 16, fontWeight: '600', color: colors.text },
  cardSub: { fontFamily: font, fontSize: 12, color: colors.sub },
  updated: { fontFamily: font, fontSize: 10, color: colors.faint },
  barcodeBox: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.surface, gap: 4 },
  noBarcode: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text },
  link: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '600' },
  small: { fontFamily: font, fontSize: 11, color: colors.sub, lineHeight: 16 },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff' },
  inputWarn: { borderColor: '#F3C4C6' },
  textarea: { height: 96, paddingTop: 10, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginTop: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  vatSeg: { flexDirection: 'row', gap: 8 },
  vatBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', gap: 2 },
  vatOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  track: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.line, padding: 3 },
  trackOn: { backgroundColor: colors.success },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stepInput: { width: 54, textAlign: 'center', fontFamily: font, fontSize: 15, fontWeight: '600', color: colors.text },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F1F3F6' },
  moveDelta: { fontFamily: font, fontSize: 14, fontWeight: '700', width: 44, textAlign: 'right' },
  moveText: { fontFamily: font, fontSize: 13, color: colors.text },
  error: { fontFamily: font, fontSize: 12, color: colors.danger, marginTop: 6 },
  saveBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line,
  },
  saveMsg: { flex: 1, fontFamily: font, fontSize: 12, color: colors.sub },
  btn: { height: 46, paddingHorizontal: 18, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  ghost: { borderWidth: 1.5, borderColor: colors.line },
  ghostText: { fontFamily: font, fontSize: 14, color: colors.text, fontWeight: '500' },
  primary: { backgroundColor: colors.primary, minWidth: 120 },
  primaryText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});

