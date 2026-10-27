// หน้าขาย: เลือกสี/ไซซ์ของสินค้าก่อนใส่ตะกร้า
import { allowNegativeStock, sellableStock } from '../appSettings';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { imageSrc } from '../api';
import { dimsOf, findVariant, optionAvailable, valueOf, type Dim, type DimPick } from '../variantDims';
import { bahtShort } from '../format';
import { colors, font, radius } from '../theme';
import type { Product, Variant } from '../types';
import { GarmentArt } from './GarmentArt';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

interface Props {
  product: Product | null;
  variants: Variant[];
  inCartQty: (variantId: number) => number;
  onClose: () => void;
  onAdd: (variantId: number, qty: number) => void;
  /** เลือกตัวเลือกนี้ไว้ก่อน (ใช้ตอนเปลี่ยนไซซ์/สีในการแก้ไขบิล) */
  initialVariantId?: number;
}

/** เลือกสี / ไซซ์ / จำนวน ก่อนเพิ่มลงตะกร้า */
export function VariantModal({ product, variants, inCartQty, onClose, onAdd, initialVariantId }: Props) {
  const dims = useMemo(() => (product ? dimsOf(product, variants) : []), [product, variants]);
  const [pick, setPick] = useState<DimPick>({});
  const [qty, setQty] = useState(1);

  // ตั้งค่าเริ่มต้น: SKU ที่ส่งมา หรือ SKU แรกที่มีของ
  useEffect(() => {
    if (!product) return;
    const init = variants.find((v) => v.id === initialVariantId) ?? variants.find((v) => sellableStock(v.stock) - inCartQty(v.id) > 0) ?? variants[0];
    const p: DimPick = {};
    if (init) for (const d of dims) p[d.key] = valueOf(init, d.key);
    setPick(p);
    setQty(1);
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** ขายได้อีกกี่ชิ้น (เปิดขายได้แม้หมด → ไม่จำกัด) · real = คงเหลือจริง */
  const left = (v: Variant) => sellableStock(v.stock) - inCartQty(v.id);
  const real = (v: Variant) => v.stock - inCartQty(v.id);
  const selected = findVariant(variants, dims, pick) ?? null;
  const available = selected ? left(selected) : 0;
  const colorDim = dims.find((d) => d.isColor);
  const hex = (pick.color && colorDim?.options.find((o) => o.value === pick.color)?.hex) || product?.tint || '#ccc';
  const lastKey = dims[dims.length - 1]?.key;

  const choose = (d: Dim, val: string) => {
    const next = { ...pick, [d.key]: val };
    // ถ้าตัวเลือกเดิมของมิติอื่นไม่มีของในชุดใหม่ → เลื่อนไปตัวที่มีของ
    if (!findVariant(variants, dims, next) || left(findVariant(variants, dims, next)!) <= 0) {
      const alt = variants.find((v) => valueOf(v, d.key) === val && left(v) > 0);
      if (alt) for (const o of dims) next[o.key] = valueOf(alt, o.key);
    }
    setPick(next);
    setQty(1);
  };

  if (!product) return null;
  const unit = selected?.price ?? product.price;

  return (
    <Sheet
      visible={!!product}
      onClose={onClose}
      width={520}
      footer={
        <Pressable
          style={[s.add, (!selected || available <= 0) && s.addDisabled]}
          disabled={!selected || available <= 0}
          onPress={() => selected && onAdd(selected.id, Math.min(qty, available))}
        >
          <Icon name="bag-add-outline" size={18} color="#fff" />
          <Text style={s.addText}>
            {selected && available > 0
              ? `เพิ่มลงรายการ · ${bahtShort(unit * Math.min(qty, available))}`
              : selected
                ? 'สต็อกไม่พอ'
                : `เลือก${dims.filter((d) => !pick[d.key]).map((d) => d.name).join('และ')}`}
          </Text>
        </Pressable>
      }
    >
      <View style={s.head}>
        <View style={s.media}>
          {product.imageUrl ? (
            <Image source={{ uri: imageSrc(product.imageUrl, 'medium') }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <GarmentArt art={product.art} color={hex} size={92} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.sku}>{selected?.sku ?? product.barcode ?? product.sku}</Text>
          <Text style={s.name}>{product.name}</Text>
          <Text style={s.price}>{bahtShort(unit)}</Text>
        </View>
        <Pressable onPress={onClose} style={s.close} hitSlop={8} accessibilityLabel="ปิด">
          <Icon name="close" size={20} color={colors.sub} />
        </Pressable>
      </View>

      {dims.map((d) => (
        <View key={d.key}>
          <Text style={s.section}>
            {d.name} · <Text style={s.sectionVal}>{pick[d.key] ?? '-'}</Text>
          </Text>
          <View style={s.wrap}>
            {d.options.map((o) => {
              const on = pick[d.key] === o.value;
              const ok = optionAvailable(variants, dims, pick, d, o.value, left);
              if (d.isColor) {
                return (
                  <Pressable key={o.value} onPress={() => choose(d, o.value)} style={[s.colorBtn, on && s.colorOn, !ok && { opacity: 0.4 }]}>
                    <View style={[s.swatch, { backgroundColor: o.hex }]} />
                    <Text style={s.colorText}>{o.value}</Text>
                  </Pressable>
                );
              }
              // มิติสุดท้าย: แสดงจำนวนคงเหลือใต้ตัวเลือก
              const v = d.key === lastKey ? findVariant(variants, dims, { ...pick, [d.key]: o.value }) : undefined;
              const n = v ? real(v) : 0;
              return (
                <Pressable key={o.value} onPress={() => choose(d, o.value)} style={[s.sizeBtn, on && s.sizeOn, !ok && s.sizeDisabled]}>
                  <Text style={[s.sizeText, on && { color: colors.primary }, !ok && { color: colors.faint, textDecorationLine: 'line-through' }]}>{o.value}</Text>
                  {d.key === lastKey ? (
                    <Text style={[s.stockText, on && { color: colors.primary }]}>{!v ? 'หมด' : n > 0 ? `เหลือ ${n}` : allowNegativeStock() ? `สต็อก ${n}` : 'หมด'}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <View style={s.qtyRow}>
        <Text style={s.section}>จำนวน</Text>
        <View style={s.stepper}>
          <Pressable style={s.stepBtn} onPress={() => setQty((q) => Math.max(1, q - 1))} accessibilityLabel="ลดจำนวน">
            <Icon name="remove" size={18} />
          </Pressable>
          <Text style={s.qty}>{qty}</Text>
          <Pressable
            style={s.stepBtn}
            onPress={() => setQty((q) => Math.min(Math.max(available, 1), q + 1))}
            accessibilityLabel="เพิ่มจำนวน"
          >
            <Icon name="add" size={18} />
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingTop: 8, marginBottom: 6 },
  media: { width: 112, height: 112, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sku: { fontFamily: font, fontSize: 11, color: colors.faint, letterSpacing: 0.5 },
  name: { fontFamily: font, fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 2 },
  price: { fontFamily: font, fontSize: 20, fontWeight: '700', color: colors.primary, marginTop: 6 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, alignSelf: 'flex-start' },
  section: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 16, marginBottom: 8 },
  sectionVal: { fontWeight: '400', color: colors.sub },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 38,
    borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line,
  },
  colorOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  swatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  colorText: { fontFamily: font, fontSize: 13, color: colors.text },
  sizeBtn: {
    minWidth: 72, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: colors.line, alignItems: 'center',
  },
  sizeOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  sizeDisabled: { backgroundColor: colors.surface, borderColor: colors.surface },
  sizeText: { fontFamily: font, fontSize: 15, fontWeight: '600', color: colors.text },
  stockText: { fontFamily: font, fontSize: 10, color: colors.sub, marginTop: 1 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4, marginTop: 8 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  qty: { fontFamily: font, fontSize: 16, fontWeight: '600', minWidth: 36, textAlign: 'center', color: colors.text },
  add: {
    height: 52, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  addDisabled: { backgroundColor: '#B8C7EE' },
  addText: { fontFamily: font, color: '#fff', fontSize: 16, fontWeight: '600' },
});
