// แก้ไขบิล / เปลี่ยนสินค้า (สาขาที่ไม่ล็อกการแก้ไข) — เก็บ/คืนส่วนต่าง
import { sellableStock } from '../../appSettings';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { api } from '../../api';
import { baht, bahtShort, MONEY_RE, moneyInput, PAYMENT_LABEL, variantLabel } from '../../format';
import type { Toast } from '../../store/usePos';
import { useSession } from '../../session';
import { colors, font, radius } from '../../theme';
import type { Bootstrap, EditPreview, OrderDetail, PaymentMethod, Product, Variant } from '../../types';
import { GarmentArt } from '../GarmentArt';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { VariantModal } from '../VariantModal';
import { Chips, FieldLabel } from './Chips';

const REASONS = ['เปลี่ยนไซซ์', 'เปลี่ยนสี', 'สินค้ามีตำหนิ', 'ลูกค้าคืนบางรายการ', 'ซื้อเพิ่ม', 'แก้ไขข้อมูลผิด'];
const METHODS: PaymentMethod[] = ['cash', 'promptpay', 'card', 'transfer'];

/** บรรทัดในบิลที่กำลังแก้ไข — origQty = จำนวนเดิมในบิล (0 = เพิ่มใหม่) */
interface Line {
  variantId: number;
  qty: number;
  origQty: number;
}

interface Props {
  visible: boolean;
  order: OrderDetail;
  catalog: Bootstrap;
  onClose: () => void;
  onSaved: (o: OrderDetail) => void;
  notify: (kind: Toast['kind'], text: string) => void;
}

/**
 * แก้ไขบิล / เปลี่ยนสินค้า
 * - เปลี่ยนไซซ์/สี: ตัวเดิมจะถูกคืน (ขีดฆ่า) และเพิ่มตัวใหม่เป็นรายการ "ใหม่"
 * - ลด/เพิ่มจำนวน, ลบ (คืนสินค้า), เพิ่มสินค้าใหม่
 * - ระบบคำนวณส่วนต่าง: ลูกค้าจ่ายเพิ่ม หรือร้านคืนเงิน
 */
export function BillEditor({ visible, order, catalog, onClose, onSaved, notify }: Props) {
  const { width, height } = useWindowDimensions();
  const { me } = useSession();
  const twoCol = width >= 900;

  const idx = useMemo(() => {
    const products = new Map<number, Product>(catalog.products.map((p) => [p.id, p]));
    const variants = new Map<number, Variant>(catalog.variants.map((v) => [v.id, v]));
    const byProduct = new Map<number, Variant[]>();
    for (const v of catalog.variants) {
      const a = byProduct.get(v.productId);
      if (a) a.push(v);
      else byProduct.set(v.productId, [v]);
    }
    return { products, variants, byProduct };
  }, [catalog]);

  const initial = useMemo<Line[]>(() => {
    const m = new Map<number, number>();
    for (const it of order.items) m.set(it.variantId, (m.get(it.variantId) ?? 0) + it.qty);
    return [...m].map(([variantId, qty]) => ({ variantId, qty, origQty: qty }));
  }, [order]);

  const [lines, setLines] = useState<Line[]>(initial);
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ product: Product; replace?: number } | null>(null);
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState(order.customerName ?? '');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [cash, setCash] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // รีเซ็ตทุกครั้งที่เปิด
  useEffect(() => {
    if (!visible) return;
    setLines(initial);
    setCustomer(order.customerName ?? '');
    setReason('');
    setMethod(null);
    setCash('');
    setSearch('');
    setSaveErr(null);
  }, [visible, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  // ให้ server คำนวณยอดใหม่ (ราคาเดิม/ราคาใหม่, ส่วนลด, VAT) — หน่วง 250ms
  useEffect(() => {
    if (!visible) return;
    const items = lines.filter((l) => l.qty > 0).map(({ variantId, qty }) => ({ variantId, qty }));
    const t = setTimeout(async () => {
      try {
        const res = await api.previewEdit(order.id, items);
        setPreview(res.preview);
        setPreviewErr(null);
      } catch (e) {
        setPreviewErr((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [lines, visible, order.id]);

  const qtyOf = (vid: number) => lines.find((l) => l.variantId === vid)?.qty ?? 0;
  const origOf = (vid: number) => lines.find((l) => l.variantId === vid)?.origQty ?? 0;
  /** VariantModal คำนวณ "เหลือ" = stock - inCartQty → ส่งจำนวนที่เพิ่มจากของเดิม */
  const usedBeyondOriginal = (vid: number) => qtyOf(vid) - origOf(vid);

  const setQty = (vid: number, qty: number) => {
    const v = idx.variants.get(vid);
    const max = sellableStock(v?.stock ?? 0) + origOf(vid);
    if (qty > max) {
      notify('info', `ใช้ได้สูงสุด ${max} ชิ้น`);
      qty = max;
    }
    setLines((ls) =>
      ls
        .map((l) => (l.variantId === vid ? { ...l, qty: Math.max(0, qty) } : l))
        .filter((l) => l.qty > 0 || l.origQty > 0), // รายการใหม่ที่ลดเหลือ 0 → ลบทิ้ง
    );
  };

  const addVariant = (vid: number, qty: number, replace?: number) => {
    setLines((ls) => {
      let next = ls.slice();
      if (replace != null && replace !== vid) {
        // เปลี่ยนไซซ์/สี: ลดตัวเดิมลงตามจำนวนที่เปลี่ยน
        next = next
          .map((l) => (l.variantId === replace ? { ...l, qty: Math.max(0, l.qty - qty) } : l))
          .filter((l) => l.qty > 0 || l.origQty > 0);
      }
      const i = next.findIndex((l) => l.variantId === vid);
      if (i >= 0) next[i] = { ...next[i], qty: next[i].qty + qty };
      else next.push({ variantId: vid, qty, origQty: 0 });
      return next;
    });
  };

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return catalog.products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 6);
  }, [search, catalog]);

  const priceOf = (vid: number) => {
    const pl = preview?.lines.find((l) => l.variantId === vid);
    if (pl) return pl.unitPrice;
    const orig = order.items.find((i) => i.variantId === vid);
    if (orig) return orig.unitPrice;
    return idx.variants.get(vid)?.price ?? 0;
  };

  const diff = preview?.diff ?? 0;
  const cashNum = cash === '' ? diff : MONEY_RE.test(cash) && cash !== '.' ? Number(cash) : NaN;
  const needMethod = diff !== 0;
  // ปุ่มจำนวนเงินด่วน (เงินสด): พอดี + ปัดขึ้นหลัก 100 / 500 / 1,000
  const quickCash = (() => {
    if (diff <= 0) return [];
    const set = new Set<number>([Math.round(diff * 100) / 100]);
    for (const step of [100, 500, 1000]) set.add(Math.ceil(diff / step) * step);
    return Array.from(set).sort((a, b) => a - b).slice(0, 4);
  })();
  const hasItems = lines.some((l) => l.qty > 0);
  const changed = !!preview?.changed || customer.trim() !== (order.customerName ?? '');
  const ready =
    hasItems && changed && !previewErr && reason.trim().length > 0 && (!needMethod || !!method) &&
    !(method === 'cash' && diff > 0 && !(cashNum >= diff));

  const save = async () => {
    if (needMethod && !method) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await api.saveEdit(order.id, {
        items: lines.filter((l) => l.qty > 0).map(({ variantId, qty }) => ({ variantId, qty })),
        customerName: customer,
        staff: me.name,
        reason,
        settleMethod: needMethod ? method! : undefined,
        cashReceived: method === 'cash' && diff > 0 ? cashNum : undefined,
      });
      const msg =
        res.diff > 0
          ? `บันทึกแล้ว · เก็บเงินเพิ่ม ${baht(res.diff)}${res.changeDue ? ` · ทอน ${baht(res.changeDue)}` : ''}`
          : res.diff < 0
            ? `บันทึกแล้ว · คืนเงินลูกค้า ${baht(-res.diff)}`
            : 'บันทึกการแก้ไขบิลแล้ว';
      notify('success', msg);
      onSaved(res.order);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ---------------- UI ----------------
  const itemsPanel = (
    <View style={{ gap: 8 }}>
      <View style={s.addBox}>
        <Icon name="add-circle-outline" size={18} color={colors.primary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="เพิ่มสินค้า: พิมพ์ชื่อ หรือรหัส SKU…"
          placeholderTextColor={colors.faint}
          style={s.addInput}
        />
      </View>
      {results.length > 0 ? (
        <View style={s.results}>
          {results.map((p) => (
            <Pressable
              key={p.id}
              style={({ hovered }: { hovered?: boolean }) => [s.result, hovered && { backgroundColor: colors.surface }]}
              onPress={() => {
                setPicker({ product: p });
                setSearch('');
              }}
            >
              <GarmentArt art={p.art} color={p.tint} size={30} />
              <Text style={s.resultName} numberOfLines={1}>{p.name}</Text>
              <Text style={s.resultPrice}>{bahtShort(p.price)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {lines.map((l) => {
        const v = idx.variants.get(l.variantId);
        const p = v ? idx.products.get(v.productId) : undefined;
        const orig = order.items.find((i) => i.variantId === l.variantId);
        const name = p?.name ?? orig?.name ?? `#${l.variantId}`;
        const removed = l.qty === 0;
        const isNew = l.origQty === 0;
        const delta = l.qty - l.origQty;
        return (
          <View key={l.variantId} style={[s.line, removed && s.lineRemoved, isNew && s.lineNew]}>
            <View style={s.thumb}>
              <GarmentArt art={p?.art ?? orig?.art ?? 'tshirt'} color={v?.colorHex ?? orig?.colorHex ?? '#ccc'} size={36} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.lineName, removed && s.strike]} numberOfLines={1}>{name}</Text>
                {isNew ? <Tag text="ใหม่" bg={colors.primarySoft} fg={colors.primary} /> : null}
                {removed ? <Tag text="คืน" bg={colors.dangerSoft} fg={colors.danger} /> : null}
                {!isNew && !removed && delta !== 0 ? (
                  <Tag text={delta > 0 ? `+${delta}` : `คืน ${-delta}`} bg={delta > 0 ? colors.primarySoft : colors.dangerSoft} fg={delta > 0 ? colors.primary : colors.danger} />
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Pressable
                  style={s.variantChip}
                  disabled={!p || removed}
                  onPress={() => p && setPicker({ product: p, replace: l.variantId })}
                  accessibilityLabel="เปลี่ยนไซซ์หรือสี"
                >
                  <View style={[s.dot, { backgroundColor: v?.colorHex ?? '#ccc' }]} />
                  <Text style={s.variantText}>{variantLabel(v ?? orig ?? {})}</Text>
                  {!removed && p ? <Icon name="swap-horizontal" size={13} color={colors.primary} /> : null}
                </Pressable>
                <Text style={s.unit}>{baht(priceOf(l.variantId))} / ชิ้น</Text>
              </View>
            </View>
            {removed ? (
              <Pressable style={s.undo} onPress={() => setQty(l.variantId, l.origQty)}>
                <Icon name="arrow-undo" size={14} color={colors.text} />
                <Text style={s.undoText}>ยกเลิกคืน</Text>
              </Pressable>
            ) : (
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={s.stepper}>
                  <Pressable style={s.stepBtn} onPress={() => setQty(l.variantId, l.qty - 1)} accessibilityLabel="ลดจำนวน">
                    <Icon name={l.qty === 1 ? 'trash-outline' : 'remove'} size={14} color={l.qty === 1 ? colors.danger : colors.text} />
                  </Pressable>
                  <Text style={s.qty}>{l.qty}</Text>
                  <Pressable style={s.stepBtn} onPress={() => setQty(l.variantId, l.qty + 1)} accessibilityLabel="เพิ่มจำนวน">
                    <Icon name="add" size={14} />
                  </Pressable>
                </View>
                <Text style={s.lineTotal}>{baht(priceOf(l.variantId) * l.qty)}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );

  const summaryBox = (
    <View style={s.sumBox}>
      <SumRow l="ยอดเดิม" r={baht(order.total)} />
      {preview && preview.discount > 0 ? <SumRow l={`ส่วนลด ${preview.promoCode}`} r={`−${baht(preview.discount)}`} /> : null}
      {preview?.fee && preview.feePayer === 'customer' ? <SumRow l={`ค่าธรรมเนียม${PAYMENT_LABEL[order.paymentMethod] ?? ''}`} r={`+${baht(preview.fee)}`} /> : null}
      <SumRow l="ยอดใหม่" r={preview ? baht(preview.total) : '…'} bold />
      <View
        style={[
          s.diffBox,
          { backgroundColor: diff > 0 ? colors.primarySoft : diff < 0 ? colors.dangerSoft : colors.surface },
        ]}
      >
        <Text style={[s.diffLabel, { color: diff > 0 ? colors.primary : diff < 0 ? colors.danger : colors.sub }]}>
          {diff > 0 ? 'ลูกค้าชำระเพิ่ม' : diff < 0 ? 'คืนเงินลูกค้า' : 'ไม่มีส่วนต่าง'}
        </Text>
        <Text style={[s.diffValue, { color: diff > 0 ? colors.primary : diff < 0 ? colors.danger : colors.text }]}>
          {baht(Math.abs(diff))}
        </Text>
      </View>
      {preview && preview.changed ? <Text style={s.summary} numberOfLines={3}>{preview.summary}</Text> : null}
      {previewErr ? <Text style={s.error}>{previewErr}</Text> : null}
    </View>
  );

  const settlePanel = (
    <View>
      {needMethod ? (
        <>
          <FieldLabel required>{diff > 0 ? 'รับเงินส่วนต่างโดย' : 'คืนเงินโดย'}</FieldLabel>
          <Chips options={METHODS.map((m) => ({ value: m, label: PAYMENT_LABEL[m] }))} value={method} onChange={setMethod} />
          {method === 'cash' && diff > 0 ? (
            <View style={s.cashRow}>
              <TextInput
                value={cash}
                onChangeText={(t) => setCash((c) => moneyInput(t, c))}
                placeholder={`รับเงินมา (${diff.toFixed(2)})`}
                placeholderTextColor={colors.faint}
                keyboardType="decimal-pad"
                style={[s.input, { flex: 1, marginTop: 0 }]}
              />
              <Text style={[s.change, !(cashNum >= diff) && { color: colors.danger }]}>
                {!Number.isFinite(cashNum) ? 'จำนวนเงินไม่ถูกต้อง' : cashNum >= diff ? `ทอน ${baht(cashNum - diff)}` : `ขาด ${baht(diff - cashNum)}`}
              </Text>
            </View>
          ) : null}
          {method === 'cash' && diff > 0 ? (
            <View style={s.quickRow}>
              {quickCash.map((q) => {
                const on = cash !== '' && Number(cash) === q;
                return (
                  <Pressable key={q} style={[s.quick, on && s.quickOn]} onPress={() => setCash(String(q))}>
                    <Text style={[s.quickText, on && { color: colors.primary, fontWeight: '700' }]}>{q === Math.round(diff * 100) / 100 ? 'พอดี' : bahtShort(q)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}

      <FieldLabel>ชื่อลูกค้า</FieldLabel>
      <TextInput value={customer} onChangeText={setCustomer} placeholder="ลูกค้าทั่วไป" placeholderTextColor={colors.faint} style={s.input} maxLength={60} />

      <FieldLabel>ผู้แก้ไข</FieldLabel>
      <View style={s.byMe}>
        <Icon name="person-circle-outline" size={18} color={colors.primary} />
        <Text style={s.byMeText}>{me.name}</Text>
        <Text style={s.byMeSub}>(บันทึกจากผู้ที่เข้าสู่ระบบ)</Text>
      </View>

      <FieldLabel required>เหตุผล</FieldLabel>
      <Chips options={REASONS.map((r) => ({ value: r, label: r }))} value={REASONS.includes(reason) ? reason : null} onChange={setReason} />
      <TextInput value={reason} onChangeText={setReason} placeholder="หรือพิมพ์เหตุผล…" placeholderTextColor={colors.faint} style={s.input} maxLength={200} />

      {saveErr ? <Text style={[s.error, { marginTop: 10 }]}>{saveErr}</Text> : null}
    </View>
  );

  const bodyH = Math.min(620, height * 0.68);

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        title={`แก้ไขบิล ${order.orderNo}`}
        width={twoCol ? 1000 : 560}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[s.btn, s.ghost]} onPress={onClose}>
              <Text style={s.ghostText}>ยกเลิก</Text>
            </Pressable>
            <Pressable style={[s.btn, s.primary, { flexGrow: 2 }, !ready && { opacity: 0.45 }]} disabled={!ready || saving} onPress={save}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.primaryText}>
                  {diff > 0 ? `บันทึก · เก็บเพิ่ม ${baht(diff)}` : diff < 0 ? `บันทึก · คืนเงิน ${baht(-diff)}` : 'บันทึกการแก้ไข'}
                </Text>
              )}
            </Pressable>
          </View>
        }
      >
        {twoCol ? (
          <View style={{ flexDirection: 'row', gap: 18, height: bodyH }}>
            {/* ซ้าย: รายการสินค้า (สูงคงที่ เลื่อนดูได้) + สรุปยอดด้านล่าง */}
            <View style={{ flex: 1.3, gap: 10 }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingRight: 4 }}>{itemsPanel}</ScrollView>
              {summaryBox}
            </View>
            {/* ขวา: วิธีรับเงิน/คืนเงิน ลูกค้า เหตุผล */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingRight: 4 }}>{settlePanel}</ScrollView>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: bodyH }}>
            {itemsPanel}
            <View style={{ height: 14 }} />
            {summaryBox}
            {settlePanel}
          </ScrollView>
        )}
      </Sheet>

      <VariantModal
        product={picker?.product ?? null}
        variants={picker ? idx.byProduct.get(picker.product.id) ?? [] : []}
        inCartQty={usedBeyondOriginal}
        initialVariantId={picker?.replace}
        onClose={() => setPicker(null)}
        onAdd={(vid, qty) => {
          if (picker?.replace === vid) return setPicker(null); // เลือกตัวเดิม → ไม่เปลี่ยน
          addVariant(vid, picker?.replace != null ? Math.min(qty, qtyOf(picker.replace)) : qty, picker?.replace);
          setPicker(null);
        }}
      />
    </>
  );
}

function Tag({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill }}>
      <Text style={{ fontFamily: font, fontSize: 10, fontWeight: '700', color: fg }}>{text}</Text>
    </View>
  );
}

function SumRow({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[s.sumText, bold && { fontWeight: '700', fontSize: 15 }]}>{l}</Text>
      <Text style={[s.sumText, bold && { fontWeight: '700', fontSize: 15 }]}>{r}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  addBox: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#D6E1FF', borderStyle: 'dashed', paddingHorizontal: 12 },
  addInput: { flex: 1, fontFamily: font, fontSize: 13, color: colors.text, outlineStyle: 'none', minWidth: 0 } as object,
  results: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 44 },
  resultName: { flex: 1, fontFamily: font, fontSize: 13, color: colors.text },
  resultPrice: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  lineRemoved: { backgroundColor: '#FFF8F8', borderColor: '#F6D5D6' },
  lineNew: { borderColor: '#BBD0FF', backgroundColor: '#F8FAFF' },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  lineName: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text, flexShrink: 1 },
  strike: { textDecorationLine: 'line-through', color: colors.faint },
  variantChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 26, borderRadius: radius.pill, backgroundColor: colors.surface },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  variantText: { fontFamily: font, fontSize: 11, color: colors.text },
  unit: { fontFamily: font, fontSize: 11, color: colors.sub },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 2 },
  stepBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  qty: { fontFamily: font, fontSize: 13, fontWeight: '600', minWidth: 28, textAlign: 'center', color: colors.text },
  lineTotal: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  undoText: { fontFamily: font, fontSize: 11, color: colors.text },
  sumBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 6 },
  sumText: { fontFamily: font, fontSize: 13, color: colors.text },
  diffBox: { borderRadius: radius.md, padding: 12, marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  diffLabel: { fontFamily: font, fontSize: 13, fontWeight: '600' },
  diffValue: { fontFamily: font, fontSize: 22, fontWeight: '700' },
  summary: { fontFamily: font, fontSize: 11, color: colors.sub, lineHeight: 17 },
  error: { fontFamily: font, fontSize: 12, color: colors.danger },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quick: { flex: 1, height: 38, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  quickOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  quickText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  cashRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  change: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.success },
  input: { fontFamily: font, fontSize: 13, color: colors.text, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12, marginTop: 8 },
  byMe: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  byMeText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.primary },
  byMeSub: { fontFamily: font, fontSize: 11, color: colors.sub },
  btn: { flexGrow: 1, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  ghost: { borderWidth: 1.5, borderColor: colors.line },
  ghostText: { fontFamily: font, fontSize: 14, color: colors.text, fontWeight: '500' },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
