import { memo, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { bahtShort, priceRange } from '../format';
import { imageSrc } from '../api';
import { DEFAULT_SETTINGS, FONT_SCALE, OPTION_PX, SHAPE_RATIO, SWATCH_PX, type PublicSettings } from '../appSettings';
import { autoPick, dimsOf, findVariant, optionAvailable, type DimPick } from '../variantDims';
import { colors, font, radius } from '../theme';
import type { Product, Variant } from '../types';
import { GarmentArt } from './GarmentArt';
import { Icon } from './Icon';

interface Props {
  product: Product;
  categoryName: string;
  variants: Variant[];
  /** variantId → จำนวนที่อยู่ในตะกร้าแล้ว */
  cartQty: Map<number, number>;
  /** ความกว้างโดยประมาณ — ใช้ปรับขนาดรูป/ปุ่มเท่านั้น (ความกว้างจริงคุมด้วยกริด) */
  width: number;
  onAdd: (variantId: number) => void;
  onOpen: (p: Product) => void;
  /** ตั้งค่า → การแสดงผลหน้าขาย */
  display?: PublicSettings['display'];
  /** ตั้งค่า → สต็อก → ขายได้แม้สต็อกหมด */
  allowNegative?: boolean;
}

/**
 * การ์ดสินค้า: เลือกไซซ์ + สีบนการ์ด แล้วกดปุ่มตะกร้าเพื่อเพิ่ม
 * (แตะที่รูปเพื่อเปิดหน้ารายละเอียด/เลือกจำนวน)
 */
function ProductCardImpl({ product, categoryName, variants, cartQty, width, onAdd, onOpen, display = DEFAULT_SETTINGS.display, allowNegative = false }: Props) {
  const { showStock, showImages: showImage, imageShape, imageFit, imageQuality, showSku, showCategoryTag } = display;
  const fs = FONT_SCALE[display.fontSize] ?? 1;
  // ขนาดวงกลมสี / ปุ่มไซซ์ ตามตั้งค่า (การ์ดแคบ → ย่อลง 10%)
  const k = width < 180 ? 0.9 : 1;
  const sw = SWATCH_PX[display.swatchSize] ?? SWATCH_PX.medium;
  const op = OPTION_PX[display.optionSize] ?? OPTION_PX.medium;
  const ringStyle = { width: sw.ring * k, height: sw.ring * k, borderRadius: (sw.ring * k) / 2 };
  const dotStyle = { width: sw.dot * k, height: sw.dot * k, borderRadius: (sw.dot * k) / 2 };
  const optStyle = { minWidth: op.w * k, height: op.h * k, paddingHorizontal: op.pad * k, borderRadius: Math.round(op.h * k * 0.22) };
  const dims = useMemo(() => dimsOf(product, variants), [product, variants]);
  const [pick, setPick] = useState<DimPick>({});
  const [warn, setWarn] = useState(false);

  // มิติที่มีตัวเลือกเดียว → เลือกให้อัตโนมัติ (และไม่ต้องแสดงแถวนั้น)
  useEffect(() => {
    setPick((p) => ({ ...autoPick(dims), ...p }));
  }, [dims]);

  /** ขายได้อีกกี่ชิ้น (เปิด "ขายได้แม้สต็อกหมด" → ไม่จำกัด) — ยอดคงเหลือจริงใช้ realLeft */
  const left = (v: Variant | undefined) => (v ? (allowNegative ? 99999 : v.stock) - (cartQty.get(v.id) ?? 0) : 0);
  const realLeft = (v: Variant | undefined) => (v ? v.stock - (cartQty.get(v.id) ?? 0) : 0);
  const selected = findVariant(variants, dims, pick);
  const remaining = left(selected);
  const totalLeft = variants.reduce((a, v) => a + left(v), 0);
  const inCart = variants.reduce((a, v) => a + (cartQty.get(v.id) ?? 0), 0);
  const soldOut = totalLeft <= 0 && inCart === 0;
  const colorDim = dims.find((d) => d.isColor);
  const artColor = (pick.color && colorDim?.options.find((o) => o.value === pick.color)?.hex) || product.tint;
  const ready = !!selected && remaining > 0;
  const lowAt = product.lowStock ?? 3;
  const prices = variants.map((v) => v.price);
  const priceText = selected ? bahtShort(selected.price) : prices.length ? priceRange(Math.min(...prices), Math.max(...prices)) : bahtShort(product.price);

  const add = () => {
    if (!ready) {
      setWarn(true);
      return;
    }
    onAdd(selected!.id);
    setWarn(false);
  };

  const missing = dims.filter((d) => !pick[d.key]).map((d) => d.name);
  let hint = missing.length ? `กรุณาเลือก${missing.join('และ')}` : '';
  let hintColor: string = colors.faint;
  if (soldOut) hint = 'สินค้าหมด';
  else if (selected && remaining <= 0) {
    hint = 'ตัวเลือกนี้หมดสต็อก';
    hintColor = colors.danger;
  } else if (ready && allowNegative && realLeft(selected) <= 0) {
    // ขายเกินสต็อก: ยังขายได้ แต่เตือนว่าสต็อกจะติดลบ
    hint = showStock ? `สต็อก ${realLeft(selected)} · ขายได้ (ติดลบ)` : 'พร้อมขาย';
    hintColor = showStock ? '#B26A00' : colors.success;
  } else if (ready && !showStock) {
    hint = 'พร้อมขาย';
    hintColor = colors.success;
  } else if (ready) {
    const real = realLeft(selected);
    hint = `คงเหลือ ${real} ชิ้น`;
    hintColor = real <= lowAt ? '#B26A00' : colors.success;
  }
  if (warn && !ready && !soldOut) hintColor = colors.danger;

  const compact = width < 180;
  // กรอบรูปตามรูปทรงที่ตั้งไว้ (กว้าง ÷ สูง) — ใช้ aspectRatio ให้พอดีความกว้างการ์ดจริง
  const ratio = SHAPE_RATIO[imageShape] ?? SHAPE_RATIO.landscape;
  const mediaH = Math.round((width - (compact ? 16 : 20)) / ratio);

  return (
    <View style={[s.card, compact && { padding: 8 }, soldOut && { opacity: 0.6 }]}>
      <Pressable style={[s.media, { aspectRatio: ratio }]} onPress={() => onOpen(product)} accessibilityLabel={`ดูรายละเอียด ${product.name}`}>
        {product.imageUrl && showImage ? (
          <Image source={{ uri: imageSrc(product.imageUrl, imageQuality) }} style={s.img} resizeMode={imageFit === 'contain' ? 'contain' : 'cover'} />
        ) : (
          <GarmentArt art={product.art} color={artColor} size={Math.round(Math.min(mediaH, width) * 0.66)} />
        )}
        {showCategoryTag ? <Text style={s.cat} numberOfLines={1}>{categoryName}</Text> : null}
        {inCart > 0 ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>{inCart}</Text>
          </View>
        ) : null}
      </Pressable>

      <Text style={[s.name, { fontSize: (compact ? 13 : 14) * fs }]} numberOfLines={1}>{product.name}</Text>
      {showSku ? <Text style={[s.sku, { fontSize: 11 * fs }]} numberOfLines={1}>{selected?.sku || product.sku}</Text> : null}

      {dims.filter((d) => d.options.length > 1).map((d) => (
        <View key={d.key}>
          <Text style={s.label}>{d.name}</Text>
          <View style={s.wrap}>
            {d.options.map((o) => {
              const on = pick[d.key] === o.value;
              const ok = optionAvailable(variants, dims, pick, d, o.value, left);
              const toggle = () => { setPick((p) => ({ ...p, [d.key]: on ? null : o.value })); setWarn(false); };
              return d.isColor ? (
                <Pressable key={o.value} onPress={toggle} style={[s.ring, ringStyle, on && s.ringOn]} accessibilityLabel={`สี${o.value}`}>
                  <View style={[s.dot, dotStyle, { backgroundColor: o.hex }, !ok && { opacity: 0.3 }]} />
                </Pressable>
              ) : (
                <Pressable
                  key={o.value}
                  onPress={toggle}
                  style={[s.size, optStyle, on && s.sizeOn, !ok && !on && s.sizeOff]}
                  accessibilityLabel={`${d.name} ${o.value}`}
                >
                  <Text style={[s.sizeText, { fontSize: op.font * k * fs }, on && s.sizeTextOn, !ok && !on && s.sizeTextOff]} numberOfLines={1}>{o.value}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <View style={s.bottom}>
        <Text style={[s.price, { fontSize: (compact ? 15 : 17) * fs }]} numberOfLines={1}>{priceText}</Text>
        <Pressable
          onPress={add}
          disabled={soldOut}
          style={({ hovered }: { hovered?: boolean }) => [s.cartBtn, compact && s.cartBtnCompact, ready && s.cartBtnReady, hovered && !soldOut && s.cartBtnHover]}
          accessibilityLabel="เพิ่มลงตะกร้า"
        >
          <Icon name="cart-outline" size={18} color={ready ? '#fff' : colors.text} />
        </Pressable>
      </View>
      <Text style={[s.hint, { color: hintColor, fontSize: 11 * fs }]} numberOfLines={1}>{hint || ' '}</Text>
    </View>
  );
}

export const ProductCard = memo(ProductCardImpl);

const s = StyleSheet.create({
  card: { width: '100%', backgroundColor: colors.panel, borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: colors.line },
  media: {
    borderRadius: radius.sm, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  sku: { fontFamily: font, color: colors.faint, marginTop: 2, letterSpacing: 0.3 },
  cat: {
    position: 'absolute', top: 6, left: 6, fontFamily: font, fontSize: 11, color: colors.sub, maxWidth: '75%',
    backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden',
  },
  badge: {
    position: 'absolute', top: 6, right: 6, minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: font },
  name: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 10 },
  label: { fontFamily: font, fontSize: 12, color: colors.sub, marginTop: 10, marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  size: {
    minWidth: 38, height: 36, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  sizeCompact: { minWidth: 34, height: 32, paddingHorizontal: 6 },
  sizeOn: { backgroundColor: colors.text, borderColor: colors.text },
  sizeOff: { backgroundColor: colors.surface, borderColor: colors.surface },
  sizeText: { fontFamily: font, fontSize: 14, color: colors.text },
  sizeTextOn: { color: '#fff', fontWeight: '600' },
  sizeTextOff: { color: colors.faint, textDecorationLine: 'line-through' },
  ring: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: colors.text },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 6 },
  price: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text },
  cartBtn: {
    width: 38, height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  cartBtnCompact: { width: 34, height: 34 },
  cartBtnReady: { backgroundColor: colors.primary, borderColor: colors.primary },
  cartBtnHover: { borderColor: colors.primary },
  hint: { fontFamily: font, fontSize: 11, marginTop: 4 },
});
