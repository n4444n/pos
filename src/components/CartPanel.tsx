// หน้าขาย: ตะกร้าสินค้าด้านขวา (จำนวน · ลบ · ยอดรวม · ปุ่มชำระเงิน)
import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { baht, bahtShort, PAYMENT_LABEL, variantLabel } from '../format';
import { sellableStock, useAppSettings } from '../appSettings';
import { imageSrc } from '../api';
import type { CartRow, Pos } from '../store/usePos';
import { colors, font, radius } from '../theme';
import { GarmentArt } from './GarmentArt';
import { Icon } from './Icon';
import { Select } from './Select';

interface Props {
  pos: Pos;
  onPayment: () => void;
  onPlace: () => void;
}

const CartItem = memo(function CartItem({ row, onQty, onRemove, showImage }: { row: CartRow; onQty: (id: number, q: number) => void; onRemove: (id: number) => void; showImage: boolean }) {
  const { product, variant, line } = row;
  return (
    <View style={s.item}>
      <View style={s.itemMedia}>
        {showImage && product.imageUrl ? (
          // รูปเล็กในตะกร้า: ใช้รูปย่อขนาดเล็กเสมอ (โหลดเร็ว)
          <Image source={{ uri: imageSrc(product.imageUrl, 'low') }} style={s.itemImg} resizeMode="cover" />
        ) : (
          <GarmentArt art={product.art} color={variant.colorHex} size={42} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.itemName} numberOfLines={1}>{product.name}</Text>
        <View style={s.itemVar}>
          <View style={[s.miniDot, { backgroundColor: variant.colorHex }]} />
          <Text style={s.itemVarText}>{variantLabel(variant)}</Text>
        </View>
        <View style={s.itemBottom}>
          <View style={s.stepper}>
            <Pressable style={s.stepBtn} onPress={() => onQty(variant.id, line.qty - 1)} accessibilityLabel="ลดจำนวน">
              <Icon name={line.qty === 1 ? 'trash-outline' : 'remove'} size={14} color={line.qty === 1 ? colors.danger : colors.text} />
            </Pressable>
            <Text style={s.qty}>{line.qty}</Text>
            <Pressable
              style={[s.stepBtn, line.qty >= sellableStock(variant.stock) && { opacity: 0.35 }]}
              onPress={() => onQty(variant.id, line.qty + 1)}
              accessibilityLabel="เพิ่มจำนวน"
            >
              <Icon name="add" size={14} />
            </Pressable>
          </View>
          <Text style={s.lineTotal}>{bahtShort(row.lineTotal)}</Text>
        </View>
      </View>
      <Pressable onPress={() => onRemove(variant.id)} hitSlop={8} style={s.remove} accessibilityLabel="ลบรายการ">
        <Icon name="close" size={14} color={colors.faint} />
      </Pressable>
    </View>
  );
});

function Dashed() {
  return <View style={s.dashed} />;
}

export function CartPanel({ pos, onPayment, onPlace }: Props) {
  const { data, rows, totals, itemCount, promo } = pos;
  const nameRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);

  // ล้างช่องโค้ดเมื่อยกเลิกโค้ด หรือเริ่มบิลใหม่
  useEffect(() => {
    if (!promo) setCode('');
  }, [promo]);

  const apply = async () => {
    setApplying(true);
    await pos.applyPromo(code);
    setApplying(false);
  };

  const payLabel = pos.payment ? PAYMENT_LABEL[pos.payment.method] : 'วิธีชำระเงิน';
  const settings = useAppSettings();
  // ค่าธรรมเนียมของวิธีชำระที่เลือก (ตั้งค่า → วิธีชำระเงิน) — ร้านเป็นผู้จ่าย ยอดลูกค้าไม่เปลี่ยน
  const fee = totals.fee;

  return (
    <View style={s.panel}>
      {/* header */}
      <View style={s.header}>
        <View style={s.headerIcon}>
          <Icon name="receipt-outline" size={20} color={colors.sub} />
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <TextInput
            ref={nameRef}
            value={pos.customerName}
            onChangeText={pos.setCustomerName}
            placeholder="ชื่อลูกค้า"
            placeholderTextColor={colors.sub}
            style={s.customer}
            maxLength={60}
          />
          <Text style={s.orderNo}>เลขที่บิล {data?.nextOrderNo ?? '—'}</Text>
        </View>
        <Pressable style={s.headerIcon} onPress={() => nameRef.current?.focus()} accessibilityLabel="แก้ไขชื่อลูกค้า">
          <Icon name="pencil-outline" size={18} color={colors.text} />
        </Pressable>
      </View>

      <View style={s.selects}>
        <Select
          placeholder="พนักงานขาย"
          value={pos.salesperson}
          options={data?.staff.map((s) => s.name) ?? []}
          icon="person-outline"
          onChange={pos.setSalesperson}
        />
        <Select
          placeholder="ประเภทการขาย"
          value={pos.orderType}
          options={data?.orderTypes ?? []}
          icon="storefront-outline"
          onChange={pos.setOrderType}
        />
      </View>

      {/* items */}
      <View style={s.itemsWrap}>
        {rows.length === 0 ? (
          <View style={s.empty}>
            <Icon name="bag-handle-outline" size={34} color={colors.line} />
            <Text style={s.emptyText}>ยังไม่ได้เลือกสินค้า</Text>
            <Text style={s.emptyHint}>แตะที่สินค้า หรือสแกน/พิมพ์รหัส SKU</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingVertical: 4 }}>
            {rows.map((r) => (
              <CartItem key={r.variant.id} row={r} onQty={pos.setQty} onRemove={pos.removeLine} showImage={settings.display.cartImages && settings.display.showImages} />
            ))}
          </ScrollView>
        )}
      </View>

      <Dashed />

      {/* totals */}
      <View style={s.totals}>
        <View style={s.tRow}>
          <Text style={s.tLabel}>รวม ({itemCount} ชิ้น)</Text>
          <Text style={s.tVal}>{baht(totals.subtotal)}</Text>
        </View>
        {promo ? (
          <View style={s.tRow}>
            <Pressable style={s.promoTag} onPress={() => pos.setPromo(null)} accessibilityLabel="ยกเลิกโค้ด">
              <Text style={s.promoTagText}>ส่วนลด {promo.code}</Text>
              <Icon name="close-circle" size={14} color={colors.success} />
            </Pressable>
            <Text style={[s.tVal, { color: colors.success }]}>
              {totals.discount > 0 ? `−${baht(totals.discount)}` : `ขั้นต่ำ ${bahtShort(promo.minTotal)}`}
            </Text>
          </View>
        ) : null}
        {settings.payments.vat.enabled && settings.payments.vat.rate > 0 ? (
          <View style={s.tRow}>
            <Text style={s.tSmall}>VAT {settings.payments.vat.rate}% (รวมในราคาแล้ว)</Text>
            <Text style={s.tSmall}>{baht(totals.vat)}</Text>
          </View>
        ) : null}
        {totals.exempt > 0 ? (
          <View style={s.tRow}>
            <Text style={s.tSmall}>สินค้ายกเว้น VAT</Text>
            <Text style={s.tSmall}>{baht(totals.exempt)}</Text>
          </View>
        ) : null}
        {fee ? (
          <View style={s.tRow}>
            <Text style={fee.customer ? s.tLabel : s.tSmall} numberOfLines={1}>
              ค่าธรรมเนียม{fee.label} {fee.rule}{fee.customer ? '' : ' (ร้านจ่าย)'}
            </Text>
            <Text style={fee.customer ? s.tVal : s.tSmall}>{fee.customer ? `+${baht(fee.fee)}` : baht(fee.fee)}</Text>
          </View>
        ) : null}
      </View>

      <Dashed />

      <View style={[s.tRow, s.grand]}>
        <Text style={s.grandLabel}>ยอดสุทธิ</Text>
        <Text style={s.grandVal}>{baht(totals.total)}</Text>
      </View>

      <View style={s.actions}>
        <View style={s.promoBox}>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="โค้ดส่วนลด / คูปอง"
            placeholderTextColor={colors.faint}
            style={s.promoInput}
            autoCapitalize="characters"
            onSubmitEditing={apply}
          />
          <Pressable onPress={apply} disabled={!code || applying || rows.length === 0} style={s.promoBtn} accessibilityLabel="ใช้โค้ด">
            {applying ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="pricetag-outline" size={17} color={code ? colors.primary : colors.sub} />}
          </Pressable>
        </View>
        <Pressable style={[s.payBtn, pos.payment && s.payBtnOn]} onPress={onPayment} disabled={rows.length === 0}>
          {pos.payment ? <Icon name="checkmark-circle" size={16} color={colors.primary} /> : null}
          <Text style={[s.payText, pos.payment && { color: colors.primary }]} numberOfLines={1}>{payLabel}</Text>
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [s.place, rows.length === 0 && s.placeDisabled, pressed && { opacity: 0.9 }]}
        disabled={rows.length === 0 || pos.placing}
        onPress={onPlace}
      >
        {pos.placing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={s.placeText}>{pos.payment ? `ชำระเงิน ${baht(totals.total)}` : 'ยืนยันการขาย'}</Text>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  panel: { flex: 1, backgroundColor: colors.panel, borderRadius: radius.xl, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  customer: {
    fontFamily: font, fontSize: 16, color: colors.text, textAlign: 'center', width: '100%',
    paddingVertical: 2, outlineStyle: 'none',
  } as object,
  orderNo: { fontFamily: font, fontSize: 11, color: colors.sub, marginTop: 1 },
  selects: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 6 },
  itemsWrap: { flex: 1, paddingHorizontal: 12, minHeight: 120 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 24 },
  emptyText: { fontFamily: font, fontSize: 14, color: colors.sub, marginTop: 4 },
  emptyHint: { fontFamily: font, fontSize: 11, color: colors.faint },
  item: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F3F6', alignItems: 'flex-start' },
  itemMedia: { width: 54, height: 54, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  itemImg: { width: '100%', height: '100%' },
  itemName: { fontFamily: font, fontSize: 13, fontWeight: '500', color: colors.text, paddingRight: 18 },
  itemVar: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  miniDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  itemVarText: { fontFamily: font, fontSize: 11, color: colors.sub },
  itemBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 2 },
  stepBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  qty: { fontFamily: font, fontSize: 13, fontWeight: '600', minWidth: 28, textAlign: 'center', color: colors.text },
  lineTotal: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  remove: { position: 'absolute', right: 0, top: 10 },
  dashed: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, marginHorizontal: 12 },
  totals: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  tRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tLabel: { fontFamily: font, fontSize: 13, color: colors.text },
  tVal: { fontFamily: font, fontSize: 13, color: colors.text },
  tSmall: { fontFamily: font, fontSize: 11, color: colors.faint },
  promoTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  promoTagText: { fontFamily: font, fontSize: 11, color: colors.success, fontWeight: '600' },
  grand: { paddingHorizontal: 14, paddingVertical: 12 },
  grandLabel: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  grandVal: { fontFamily: font, fontSize: 20, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  promoBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingLeft: 14, paddingRight: 4, height: 42,
  },
  promoInput: { flex: 1, fontFamily: font, fontSize: 12, color: colors.text, outlineStyle: 'none', minWidth: 0 } as object,
  promoBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  payBtn: {
    flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center',
    justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 10,
  },
  payBtnOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  payText: { fontFamily: font, fontSize: 12, fontWeight: '500', color: colors.text },
  place: { height: 60, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  placeDisabled: { backgroundColor: '#9DB7F7' },
  placeText: { fontFamily: font, color: '#fff', fontSize: 17, fontWeight: '600' },
});
