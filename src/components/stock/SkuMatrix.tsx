import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { moneyInput } from '../../format';
import { MAX_SKU, rowLabel, type DAttr, type DRow } from '../../stockDraft';
import { colors, font, radius } from '../../theme';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { Barcode } from './Barcode';
import { BarcodeLabelSheet } from './BarcodeLabelSheet';
import type { LabelItem } from '../../labels';

interface Props {
  /** รหัสสินค้า — ใช้แสดงตัวอย่างรหัสอัตโนมัติของ SKU ใหม่ (รหัสสินค้า-0001) */
  productCode: string;
  /** ชื่อสินค้า — พิมพ์บนป้ายบาร์โค้ด */
  productName?: string;
  attrs: DAttr[];
  rows: DRow[];
  lowStock: number;
  /** ซ่อนคอลัมน์ต้นทุน (พนักงานทั่วไป) */
  showCost: boolean;
  compact: boolean;
  /** สาขาย่อย: เปิด/ปิดแสดงขายเป็นของสาขาหลัก — ดูได้อย่างเดียว */
  lockActive?: boolean;
  onChange: (rows: DRow[]) => void;
}

type Col = 'cost' | 'price' | 'stock';
const COL_LABEL: Record<Col, string> = { cost: 'ต้นทุน', price: 'ราคาขาย', stock: 'จำนวน' };

/** ตาราง SKU: ต้นทุน · ราคา · จำนวน · แสดงขาย (ตั้งค่าทุกแถวพร้อมกันได้) */
export function SkuMatrix({ productCode, productName = '', attrs, rows, lowStock, showCost, compact, lockActive, onChange }: Props) {
  const [bulk, setBulk] = useState<Col | null>(null);
  const [bulkVal, setBulkVal] = useState('');
  // แสดงบาร์โค้ดแทนป้ายรหัส · หน้าต่างพิมพ์ป้ายบาร์โค้ด
  const [showBc, setShowBc] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const cols: Col[] = showCost ? ['cost', 'price', 'stock'] : ['price', 'stock'];

  const set = (key: string, patch: Partial<DRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const clean = (c: Col, t: string, prev = '') => (c === 'stock' ? t.replace(/[^0-9]/g, '') : moneyInput(t, prev)).slice(0, 9);
  const allOn = rows.every((r) => r.active);

  // ป้ายรหัสของแต่ละ SKU: บาร์โค้ด (กำหนดเอง) ถ้ามี → ไม่งั้นรหัสอัตโนมัติ รหัสสินค้า-0001
  const codeOf = new Map<string, { text: string; custom: boolean; pending: boolean }>();
  {
    let next = rows.filter((r) => r.sku).length + 1;
    for (const r of rows) {
      if (r.barcode) codeOf.set(r.key, { text: r.barcode, custom: true, pending: false });
      else if (r.sku) codeOf.set(r.key, { text: r.sku, custom: false, pending: false });
      else codeOf.set(r.key, { text: `${productCode || 'P…'}-${String(next++).padStart(4, '0')}`, custom: false, pending: true });
    }
  }

  // ป้ายที่พิมพ์ได้ = SKU ที่บันทึกแล้ว (มีรหัสจริง)
  const labelItems: LabelItem[] = rows
    .filter((r) => !codeOf.get(r.key)!.pending)
    .map((r) => ({
      key: r.key,
      name: productName.trim() || productCode,
      variant: rowLabel(attrs, r.key),
      code: codeOf.get(r.key)!.text,
      price: Number(r.price) || 0,
      stock: Math.max(0, Number(r.stock) || 0),
    }));
  const pendingCount = rows.length - labelItems.length;

  const tools = (
    <View style={s.tools}>
      <Pressable
        style={({ hovered }: { hovered?: boolean }) => [s.toolBtn, showBc && s.toolOn, hovered && !showBc && { backgroundColor: colors.surface }]}
        onPress={() => setShowBc((v) => !v)}
        accessibilityRole="switch"
        accessibilityState={{ checked: showBc }}
        accessibilityLabel={showBc ? 'ซ่อนบาร์โค้ด' : 'แสดงบาร์โค้ด'}
      >
        <Icon name="barcode-outline" size={18} color={showBc ? '#fff' : colors.text} />
        <Text style={[s.toolText, showBc && { color: '#fff' }]}>{showBc ? 'ซ่อนบาร์โค้ด' : 'แสดงบาร์โค้ด'}</Text>
      </Pressable>
      <Pressable
        style={({ hovered }: { hovered?: boolean }) => [s.toolBtn, hovered && { backgroundColor: colors.surface }, !labelItems.length && { opacity: 0.45 }]}
        disabled={!labelItems.length}
        onPress={() => setPrintOpen(true)}
        accessibilityLabel="พิมพ์บาร์โค้ดทุกรุ่น"
      >
        <Icon name="print-outline" size={18} color={colors.text} />
        <Text style={s.toolText}>พิมพ์บาร์โค้ด</Text>
      </Pressable>
    </View>
  );

  const stockTone = (r: DRow) => {
    const n = Number(r.stock || 0);
    if (!r.active) return null;
    if (n === 0) return { bg: '#FFD6D8', fg: '#C62828', label: 'หมด' };
    if (n <= lowStock) return { bg: '#FFE9A8', fg: '#8A6100', label: 'เหลือน้อย' };
    return null;
  };

  const header = (
    <View style={s.thead}>
      <Text style={[s.th, { flex: 1.4, textAlign: 'left', paddingLeft: 8 }]}>คุณสมบัติ</Text>
      {cols.map((c) => (
        <Pressable key={c} style={[s.thBtn, { flex: 1 }]} onPress={() => { setBulk(c); setBulkVal(''); }} accessibilityLabel={`ตั้ง${COL_LABEL[c]}ทุกแถว`}>
          <Text style={[s.th, c !== 'stock' && { color: colors.primary }]}>{COL_LABEL[c]}</Text>
          <Icon name="calculator-outline" size={13} color={colors.primary} />
        </Pressable>
      ))}
      <Pressable style={[s.thBtn, { width: 64 }]} disabled={lockActive} onPress={() => onChange(rows.map((r) => ({ ...r, active: !allOn })))} accessibilityLabel="เปิด/ปิดแสดงขายทุกแถว">
        <Text style={s.th}>แสดงขาย</Text>
      </Pressable>
    </View>
  );

  return (
    <View>
      {tools}
      {!compact ? header : (
        <View style={s.bulkBar}>
          {cols.map((c) => (
            <Pressable key={c} style={s.bulkChip} onPress={() => { setBulk(c); setBulkVal(''); }}>
              <Icon name="calculator-outline" size={13} color={colors.primary} />
              <Text style={s.bulkChipText}>ตั้ง{COL_LABEL[c]}ทุกแถว</Text>
            </Pressable>
          ))}
        </View>
      )}

      {rows.map((r) => {
        const tone = stockTone(r);
        const label = rowLabel(attrs, r.key);
        const cells = cols.map((c) => (
          <View key={c} style={compact ? { flex: 1, gap: 2 } : { flex: 1 }}>
            {compact ? <Text style={s.cellLabel}>{COL_LABEL[c]}</Text> : null}
            <TextInput
              value={r[c]}
              onChangeText={(t) => set(r.key, { [c]: clean(c, t, String(r[c] ?? '')) } as Partial<DRow>)}
              keyboardType={c === 'stock' ? 'number-pad' : 'decimal-pad'}
              placeholder={c === 'price' ? 'ราคา' : '0'}
              placeholderTextColor={colors.faint}
              style={[s.cell, c === 'price' && r.price.trim() === '' && s.cellErr, c === 'stock' && tone && { borderColor: tone.fg }]}
              selectTextOnFocus
              accessibilityLabel={`${COL_LABEL[c]} ${label}`}
            />
          </View>
        ));
        const toggle = (
          <Pressable
            onPress={() => set(r.key, { active: !r.active })}
            disabled={lockActive}
            style={[s.track, r.active && s.trackOn, lockActive && { opacity: 0.45 }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: r.active }}
            accessibilityLabel={`แสดงขาย ${label}`}
          >
            <View style={[s.knob, r.active && { transform: [{ translateX: 18 }] }]} />
          </Pressable>
        );
        const name = (
          <View style={{ gap: 3, alignItems: compact ? 'flex-start' : 'center' }}>
            <Text style={[s.label, !r.active && { color: colors.faint }]} numberOfLines={2}>{label}</Text>
            <View style={s.skuRow}>
              {(() => {
                const c = codeOf.get(r.key)!;
                if (showBc && !c.pending) {
                  return (
                    <View style={s.bcBox}>
                      <Barcode value={c.text} height={34} maxWidth={compact ? 200 : 170} />
                    </View>
                  );
                }
                return (
                  <View
                    style={[s.skuChip, c.custom && s.skuChipCustom, tone && { backgroundColor: tone.bg }]}
                    accessibilityLabel={`${c.custom ? 'บาร์โค้ด' : 'รหัส SKU'} ${c.text}${tone ? ` (${tone.label})` : ''}`}
                  >
                    {c.custom ? <Icon name="barcode-outline" size={11} color={tone ? tone.fg : colors.primary} /> : null}
                    <Text
                      style={[s.sku, c.custom && { color: colors.primary }, c.pending && { fontStyle: 'italic', color: colors.faint }, tone && { color: tone.fg, fontWeight: '600' }]}
                      numberOfLines={1}
                    >
                      {c.text}
                    </Text>
                  </View>
                );
              })()}
            </View>
          </View>
        );
        return compact ? (
          <View key={r.key} style={[s.card, !r.active && { opacity: 0.6 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              {name}
              {toggle}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>{cells}</View>
          </View>
        ) : (
          <View key={r.key} style={[s.tr, !r.active && { opacity: 0.6 }]}>
            <View style={{ flex: 1.4 }}>{name}</View>
            {cells}
            <View style={{ width: 64, alignItems: 'center' }}>{toggle}</View>
          </View>
        );
      })}
      <Text style={s.foot}>ป้ายใต้ชื่อ SKU = บาร์โค้ด (กำหนดเอง) ถ้าตั้งไว้แล้ว ไม่งั้นเป็นรหัสอัตโนมัติ รหัสสินค้า-0001 · ป้ายสีเหลือง = เหลือน้อย · สีแดง = หมด · รองรับ SKU สูงสุด {MAX_SKU} รายการ (เช่น ดำ/XL = 1 รายการ) · จำนวนที่แก้จะปรับจากยอดล่าสุด ไม่ทับยอดที่ขายไประหว่างแก้ไข</Text>

      <BarcodeLabelSheet
        visible={printOpen}
        onClose={() => setPrintOpen(false)}
        title={`พิมพ์บาร์โค้ด · ${productName.trim() || productCode || 'สินค้า'}`}
        items={labelItems}
        note={pendingCount ? `มี ${pendingCount} SKU ที่ยังไม่บันทึก — กดบันทึกสินค้าก่อนจึงจะพิมพ์บาร์โค้ดได้` : undefined}
      />

      <Sheet visible={!!bulk} onClose={() => setBulk(null)} title={bulk ? `ตั้ง${COL_LABEL[bulk]}ทุกแถว` : ''} width={360}
        footer={
          <Pressable
            style={[s.apply, bulkVal === '' && { opacity: 0.45 }]}
            disabled={bulkVal === ''}
            onPress={() => {
              if (bulk) onChange(rows.map((r) => ({ ...r, [bulk]: bulkVal })));
              setBulk(null);
            }}
          >
            <Text style={s.applyText}>ใช้กับทั้ง {rows.length} แถว</Text>
          </Pressable>
        }
      >
        <TextInput
          value={bulkVal}
          onChangeText={(t) => bulk && setBulkVal((v) => clean(bulk, t, v))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.faint}
          style={s.bulkInput}
          autoFocus
          accessibilityLabel="ค่าที่จะตั้งทุกแถว"
        />
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  tools: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  toolBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  toolOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toolText: { fontFamily: font, fontSize: 13, color: colors.text },
  bcBox: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 6, alignSelf: 'stretch' },
  thead: { flexDirection: 'row', gap: 6, backgroundColor: colors.surface, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center' },
  th: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text, textAlign: 'center' },
  thBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  tr: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  label: { fontFamily: font, fontSize: 13, color: colors.text, textAlign: 'center' },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'center' },
  skuChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, maxWidth: '100%' },
  skuChipCustom: { backgroundColor: colors.primarySoft },
  sku: { fontFamily: font, fontSize: 10, color: colors.sub, flexShrink: 1 },
  cell: { fontFamily: font, fontSize: 15, color: colors.text, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, textAlign: 'center', backgroundColor: '#fff', minWidth: 0 },
  cellErr: { borderColor: colors.danger, backgroundColor: '#FFF8F8' },
  cellLabel: { fontFamily: font, fontSize: 10, color: colors.sub },
  track: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.line, padding: 3 },
  trackOn: { backgroundColor: colors.success },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 10, gap: 8, marginBottom: 8 },
  bulkBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  bulkChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  bulkChipText: { fontFamily: font, fontSize: 11, color: colors.primary, fontWeight: '600' },
  foot: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 8, lineHeight: 17 },
  bulkInput: { fontFamily: font, fontSize: 24, fontWeight: '600', color: colors.text, height: 56, borderRadius: radius.md, backgroundColor: colors.surface, textAlign: 'center' },
  apply: { height: 50, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
