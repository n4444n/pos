// ตั้งค่า → วิธีชำระเงิน & ค่าธรรมเนียม
import { Pressable, Text, View } from 'react-native';
import type { AdminSettings } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { baht } from '../format';
import { colors } from '../theme';
import { Card, Field, Input, Seg, Switch, type Upd, s } from './ui';

/** สาขาหลัก: รายชื่อสาขาย่อย + ปุ่มเพิ่มสาขา (สร้าง key เชื่อมสาขาให้อัตโนมัติ) */
export function PaymentsSection({ v, set, goTax }: { v: AdminSettings['payments']; set: Upd<AdminSettings['payments']>; goTax: () => void }) {
  const ICON: Record<string, IconName> = { cash: 'cash-outline', promptpay: 'qr-code-outline', card: 'card-outline', transfer: 'swap-horizontal-outline' };
  const upd = (id: string, x: Partial<AdminSettings['payments']['methods'][number]>) => set({ methods: v.methods.map((m) => (m.id === id ? { ...m, ...x } : m)) });
  const move = (i: number, d: number) => {
    const a = [...v.methods];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    set({ methods: a });
  };
  return (
    <>
      <Card title="วิธีชำระเงิน">
        <Field label="ผู้จ่ายค่าธรรมเนียม" hint={v.feePayer === 'customer' ? 'บวกเพิ่มในยอดบิล เช่น สินค้า ฿1,000 + ค่าธรรมเนียมบัตร 2% = ลูกค้าจ่าย ฿1,020 (แสดงในตะกร้า/ใบเสร็จ)' : 'ลูกค้าจ่ายเท่าราคาสินค้า ร้านรับภาระค่าธรรมเนียมเอง (บันทึกไว้ดูในรายงาน ไม่พิมพ์บนใบเสร็จ)'}>
          <Seg value={v.feePayer} options={[['customer', 'ลูกค้าจ่าย (บวกเพิ่มในยอด)'], ['shop', 'ร้านจ่ายเอง']]} onChange={(x) => set({ feePayer: x as 'customer' | 'shop' })} />
        </Field>
        {/* 2 × 2: แต่ละวิธีชำระเป็นการ์ด — ชื่อ + เปิด/ปิด · ค่าธรรมเนียม · ตัวอย่าง · ลำดับ */}
        <View style={s.payGrid}>
          {v.methods.map((m, i) => {
            const fee = (1000 * m.feePercent) / 100 + m.feeFixed;
            return (
              <View key={m.id} style={[s.payCard, m.enabled ? s.payCardOn : { opacity: 0.6 }]}>
                <View style={[s.row, { gap: 8 }]}>
                  <View style={[s.payIcon, m.enabled && { backgroundColor: colors.primarySoft }]}>
                    <Icon name={ICON[m.id]} size={20} color={m.enabled ? colors.primary : colors.sub} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Input value={m.label} onChange={(t) => upd(m.id, { label: t })} max={40} />
                  </View>
                  <Switch value={m.enabled} onChange={(x) => upd(m.id, { enabled: x })} label={`เปิดใช้ ${m.label}`} />
                </View>
                <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
                  <Text style={[s.sub, { width: 74 }]}>ค่าธรรมเนียม</Text>
                  <View style={s.unitBox}>
                    <Input value={String(m.feePercent)} onChange={(t) => upd(m.id, { feePercent: Number(t.replace(/[^0-9.]/g, '')) || 0 })} keyboard="decimal-pad" max={5} compact />
                    <Text style={s.unit}>%</Text>
                  </View>
                  <Text style={s.sub}>+</Text>
                  <View style={s.unitBox}>
                    <Input value={String(m.feeFixed)} onChange={(t) => upd(m.id, { feeFixed: Number(t.replace(/[^0-9.]/g, '')) || 0 })} keyboard="decimal-pad" max={6} compact />
                    <Text style={s.unit}>บาท/บิล</Text>
                  </View>
                </View>
                <View style={[s.row, { gap: 8 }]}>
                  <Text style={[s.sub, { flex: 1, fontSize: 11 }]} numberOfLines={2}>
                    {!m.enabled
                      ? 'ปิดใช้งาน — ไม่แสดงในหน้าชำระเงิน'
                      : fee
                        ? `เช่น ฿1,000 → ค่าธรรมเนียม ${baht(fee)}${v.feePayer === 'customer' ? ` · ลูกค้าจ่าย ${baht(1000 + fee)}` : ' (ร้านจ่าย)'}`
                        : 'ไม่มีค่าธรรมเนียม'}
                  </Text>
                  <Text style={[s.sub, { fontSize: 11 }]}>ลำดับ {i + 1}</Text>
                  <Pressable onPress={() => move(i, -1)} disabled={i === 0} style={s.arrow} accessibilityLabel={`เลื่อน ${m.label} ไปก่อน`}>
                    <Icon name="chevron-back" size={16} color={i === 0 ? colors.line : colors.text} />
                  </Pressable>
                  <Pressable onPress={() => move(i, 1)} disabled={i === v.methods.length - 1} style={s.arrow} accessibilityLabel={`เลื่อน ${m.label} ไปหลัง`}>
                    <Icon name="chevron-forward" size={16} color={i === v.methods.length - 1 ? colors.line : colors.text} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </Card>
      <Card title="ลิ้นชักเงินสด (เปิด / ปิดกะ)">
        <View style={s.optRow}>
          <Icon name="cash-outline" size={22} color={colors.text} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.optTitle}>บังคับแจกแจงจำนวนเงิน</Text>
            <Text style={s.sub}>
              {v.requireDenominations
                ? 'เปิดอยู่ — ตอนเปิดกะ / ปิดกะ พนักงานต้องนับธนบัตร / เหรียญทีละชนิด กรอกยอดรวมเองไม่ได้ และใช้ยอดจากปิดกะล่าสุดไม่ได้'
                : 'ปิดอยู่ — ตอนเปิดกะ / ปิดกะ เลือกได้ว่าจะนับธนบัตร / เหรียญ หรือกรอกยอดรวมเอง'}
            </Text>
          </View>
          <Switch value={!!v.requireDenominations} onChange={(x) => set({ requireDenominations: x })} label="บังคับแจกแจงจำนวนเงิน" />
        </View>
      </Card>
      <Card title="ภาษีมูลค่าเพิ่ม (VAT)">
        <Text style={s.sub}>
          {v.vat.enabled ? `สาขานี้จด VAT · อัตราที่มีผลวันนี้ ${v.vat.rate}%` : 'สาขานี้ไม่ได้จด VAT'} — ตั้งจด VAT, อัตรา VAT (วันเริ่ม/สิ้นสุด), สำนักงานใหญ่/สาขาที่ และหมายเลขเครื่อง POS ที่เมนู{' '}
          <Text style={s.link} onPress={goTax}>ภาษี (VAT)</Text>
        </Text>
      </Card>
      <Card title="พร้อมเพย์">
        <Field label="หมายเลขพร้อมเพย์ของร้าน" hint="เบอร์มือถือ 10 หลัก หรือเลขบัตร/เลขผู้เสียภาษี 13 หลัก — แสดงในหน้าชำระเงิน">
          <Input value={v.promptpayId} onChange={(t) => set({ promptpayId: t.replace(/[^0-9]/g, '') })} keyboard="number-pad" max={15} placeholder="08xxxxxxxx" />
        </Field>
      </Card>
    </>
  );
}
