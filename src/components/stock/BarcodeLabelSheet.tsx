// หน้าต่างพิมพ์ป้ายบาร์โค้ด: เลือก SKU (ทุกรุ่นของสินค้า) · จำนวนดวง · ขนาดสติ๊กเกอร์ → พิมพ์
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  expandLabels, LABEL_PAPERS, loadLabelOptions, printLabels, saveLabelOptions,
  type LabelItem, type LabelOptions,
} from '../../labels';
import { colors, font, radius } from '../../theme';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { Barcode } from './Barcode';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  items: LabelItem[];
  /** SKU ที่ติ๊กไว้ตอนเปิด (ไม่ส่ง = ทุกรุ่น) */
  preselect?: string[];
  /** หมายเหตุใต้รายการ เช่น "SKU ที่ยังไม่บันทึกพิมพ์ไม่ได้" */
  note?: string;
}

type CopyMode = 'one' | 'stock' | 'custom';

export function BarcodeLabelSheet({ visible, onClose, title = 'พิมพ์บาร์โค้ด', items, preselect, note }: Props) {
  const [opts, setOpts] = useState<LabelOptions>(loadLabelOptions);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<CopyMode>('one');
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [blocked, setBlocked] = useState(false);

  // เปิดใหม่ทุกครั้ง → เลือกตาม preselect (หรือทุกรุ่น) · จำนวน 1 ดวงต่อ SKU
  useEffect(() => {
    if (!visible) return;
    setSel(new Set(preselect ?? items.map((i) => i.key)));
    setMode('one');
    setCustom({});
    setBlocked(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOpt = (patch: Partial<LabelOptions>) =>
    setOpts((o) => {
      const n = { ...o, ...patch };
      saveLabelOptions(n);
      return n;
    });

  const copiesOf = (it: LabelItem) => {
    if (!sel.has(it.key)) return 0;
    if (mode === 'stock') return Math.max(0, it.stock);
    if (mode === 'custom') return Math.max(0, Math.min(999, Number(custom[it.key] ?? '1') || 0));
    return 1;
  };
  const copies = useMemo(() => new Map(items.map((it) => [it.key, copiesOf(it)])), [items, sel, mode, custom]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = [...copies.values()].reduce((a, b) => a + b, 0);
  const allOn = items.length > 0 && items.every((i) => sel.has(i.key));
  const sample = items.find((i) => sel.has(i.key)) ?? items[0];

  const toggle = (k: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const doPrint = () => {
    const ok = printLabels(expandLabels(items, copies), opts);
    setBlocked(!ok);
    if (ok) onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      width={620}
      footer={
        <View style={{ gap: 8 }}>
          {blocked ? <Text style={s.err}>เปิดหน้าต่างพิมพ์ไม่ได้ — อนุญาต pop-up ของเว็บนี้ แล้วกดพิมพ์อีกครั้ง</Text> : null}
          <Pressable style={[s.print, total === 0 && { opacity: 0.45 }]} disabled={total === 0} onPress={doPrint} accessibilityRole="button">
            <Icon name="print-outline" size={18} color="#fff" />
            <Text style={s.printText}>พิมพ์ {total.toLocaleString()} ดวง</Text>
          </Pressable>
        </View>
      }
    >
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: 14 }}>
        {/* ขนาดป้าย */}
        <View style={{ gap: 6 }}>
          <Text style={s.h}>ขนาดสติ๊กเกอร์</Text>
          <View style={s.wrap}>
            {LABEL_PAPERS.map((p) => {
              const on = opts.paper === p.id;
              return (
                <Pressable key={p.id} style={[s.paper, on && s.on]} onPress={() => setOpt({ paper: p.id })} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Text style={[s.paperT, on && { color: colors.primary }]}>{p.label}</Text>
                  <Text style={s.paperH}>{p.hint}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ข้อมูลบนป้าย + ตัวอย่าง */}
        <View style={[s.row, { alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }]}>
          <View style={{ gap: 6, flex: 1, minWidth: 220 }}>
            <Text style={s.h}>แสดงบนป้าย</Text>
            <View style={s.wrap}>
              {([
                ['showName', 'ชื่อสินค้า'],
                ['showVariant', 'สี / ไซซ์'],
                ['showPrice', 'ราคา'],
                ['showShop', 'ชื่อร้าน'],
              ] as const).map(([k, label]) => (
                <Pressable key={k} style={[s.chip, opts[k] && s.on]} onPress={() => setOpt({ [k]: !opts[k] } as Partial<LabelOptions>)} accessibilityRole="checkbox" accessibilityState={{ checked: opts[k] }}>
                  <Icon name={opts[k] ? 'checkbox' : 'square-outline'} size={15} color={opts[k] ? colors.primary : colors.sub} />
                  <Text style={s.chipT}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {sample ? (
            <View style={s.preview} accessibilityLabel="ตัวอย่างป้าย">
              {opts.showName ? <Text style={s.pvName} numberOfLines={1}>{sample.name}</Text> : null}
              {opts.showVariant || opts.showPrice ? (
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <Text style={s.pvMeta} numberOfLines={1}>{opts.showVariant ? sample.variant : ''}</Text>
                  {opts.showPrice ? <Text style={[s.pvMeta, { fontWeight: '700' }]}>฿{sample.price.toLocaleString()}</Text> : null}
                </View>
              ) : null}
              <Barcode value={sample.code} height={40} maxWidth={200} />
            </View>
          ) : null}
        </View>

        {/* จำนวนดวง */}
        <View style={{ gap: 6 }}>
          <Text style={s.h}>จำนวนดวงต่อ SKU</Text>
          <View style={s.wrap}>
            {([
              ['one', 'SKU ละ 1 ดวง'],
              ['stock', 'ตามจำนวนสต็อก'],
              ['custom', 'กำหนดเอง'],
            ] as const).map(([m, label]) => (
              <Pressable key={m} style={[s.chip, mode === m && s.on]} onPress={() => setMode(m)} accessibilityRole="radio" accessibilityState={{ checked: mode === m }}>
                <Text style={[s.chipT, mode === m && { color: colors.primary, fontWeight: '600' }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* รายการ SKU */}
        <View style={s.list}>
          <Pressable style={[s.item, s.itemHead]} onPress={() => setSel(allOn ? new Set() : new Set(items.map((i) => i.key)))} accessibilityRole="checkbox" accessibilityState={{ checked: allOn }}>
            <Icon name={allOn ? 'checkbox' : 'square-outline'} size={18} color={allOn ? colors.primary : colors.sub} />
            <Text style={[s.itemT, { fontWeight: '600' }]}>เลือกทั้งหมด ({sel.size}/{items.length} รุ่น)</Text>
            <Text style={s.colH}>ดวง</Text>
          </Pressable>
          {items.map((it) => {
            const on = sel.has(it.key);
            return (
              <View key={it.key} style={[s.item, !on && { opacity: 0.55 }]}>
                <Pressable style={[s.row, { flex: 1, gap: 10, minWidth: 0 }]} onPress={() => toggle(it.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Icon name={on ? 'checkbox' : 'square-outline'} size={18} color={on ? colors.primary : colors.sub} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.itemT} numberOfLines={1}>{it.name} <Text style={s.sub}>· {it.variant}</Text></Text>
                    <Text style={s.code} numberOfLines={1}>{it.code} · คงเหลือ {it.stock}</Text>
                  </View>
                </Pressable>
                {mode === 'custom' && on ? (
                  <TextInput
                    value={custom[it.key] ?? '1'}
                    onChangeText={(t) => setCustom((c) => ({ ...c, [it.key]: t.replace(/[^0-9]/g, '').slice(0, 3) }))}
                    keyboardType="number-pad"
                    selectTextOnFocus
                    style={s.qty}
                    accessibilityLabel={`จำนวนดวง ${it.variant}`}
                  />
                ) : (
                  <Text style={s.qtyT}>{copies.get(it.key) ?? 0}</Text>
                )}
              </View>
            );
          })}
          {!items.length ? <Text style={[s.sub, { padding: 12 }]}>ไม่มี SKU ที่พิมพ์ได้</Text> : null}
        </View>
        {note ? <Text style={s.sub}>{note}</Text> : null}
        <Text style={s.sub}>หน้าต่างพิมพ์จะเปิดขึ้น — เลือกเครื่องพิมพ์ป้าย (เช่น Xprinter, TSC, Zebra) และตั้งขนาดกระดาษให้ตรงกับสติ๊กเกอร์ · ระยะขอบ: ไม่มี (None)</Text>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  h: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  sub: { fontFamily: font, fontSize: 12, color: colors.sub },
  on: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  paper: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12, minWidth: 128 },
  paperT: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  paperH: { fontFamily: font, fontSize: 11, color: colors.sub },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 12 },
  chipT: { fontFamily: font, fontSize: 13, color: colors.text },
  preview: { width: 220, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.faint, borderRadius: radius.sm, padding: 8, gap: 2, backgroundColor: '#fff' },
  pvName: { fontFamily: font, fontSize: 12, fontWeight: '700', color: '#000', textAlign: 'center' },
  pvMeta: { fontFamily: font, fontSize: 11, color: '#000' },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#F0F2F5' },
  itemHead: { borderTopWidth: 0, backgroundColor: colors.surface },
  itemT: { fontFamily: font, fontSize: 13, color: colors.text, flex: 1 },
  colH: { fontFamily: font, fontSize: 12, color: colors.sub, width: 56, textAlign: 'center' },
  code: { fontFamily: font, fontSize: 11, color: colors.sub },
  qty: { width: 56, height: 34, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, textAlign: 'center', fontFamily: font, fontSize: 14, color: colors.text, backgroundColor: '#fff' },
  qtyT: { width: 56, textAlign: 'center', fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  print: { height: 48, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  printText: { fontFamily: font, fontSize: 15, fontWeight: '600', color: '#fff' },
  err: { fontFamily: font, fontSize: 12, color: colors.danger, textAlign: 'center' },
});
