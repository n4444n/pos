// ตั้งค่า → วิธีชำระเงิน & ค่าธรรมเนียม
import { Pressable, Text, View } from 'react-native';
import type { AdminSettings } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { baht } from '../format';
import { colors } from '../theme';
import { Card, Field, Input, Seg, Switch, type Upd, s } from './ui';
import { QrView } from '../components/QrView';
import { PROMPTPAY_KIND_LABEL, promptPayKind, promptPayPayload } from '../promptpay';

/** สาขาหลัก: รายชื่อสาขาย่อย + ปุ่มเพิ่มสาขา (สร้าง key เชื่อมสาขาให้อัตโนมัติ) */
export function PaymentsSection({ v, set, goTax }: { v: AdminSettings['payments']; set: Upd<AdminSettings['payments']>; goTax: () => void }) {
  const ICON: Record<string, IconName> = { cash: 'cash-outline', promptpay: 'qr-code-outline', card: 'card-outline', transfer: 'swap-horizontal-outline', beam: 'card-outline' };
  const upd = (id: string, x: Partial<AdminSettings['payments']['methods'][number]>) => set({ methods: v.methods.map((m) => (m.id === id ? { ...m, ...x } : m)) });
  const move = (i: number, d: number) => {
    const a = [...v.methods];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    set({ methods: a });
  };
  const ppKind = promptPayKind(v.promptpayId);
  const ppSample = ppKind ? promptPayPayload(v.promptpayId, v.promptpayLock !== false ? 100 : undefined) : null;
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
      <Card title="พร้อมเพย์ (QR)">
        <View style={[s.row, { gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }]}>
          <View style={{ flex: 1, minWidth: 260, gap: 4 }}>
            <Field label="หมายเลขพร้อมเพย์ของร้าน" hint={ppKind ? `ประเภท: ${PROMPTPAY_KIND_LABEL[ppKind]}` : v.promptpayId ? 'ต้องเป็นเบอร์มือถือ 10 หลัก (ขึ้นต้น 0) · เลขบัตร/เลขผู้เสียภาษี 13 หลัก · หรือ e-Wallet 15 หลัก' : 'เบอร์มือถือ 10 หลัก · เลขบัตร/เลขผู้เสียภาษี 13 หลัก · e-Wallet 15 หลัก'}>
              <Input value={v.promptpayId} onChange={(t) => set({ promptpayId: t.replace(/[^0-9]/g, '') })} keyboard="number-pad" max={15} placeholder="08xxxxxxxx" />
            </Field>
            <Field label="ชื่อบัญชี (แสดงใต้ QR)" hint="ให้ลูกค้าตรวจว่าโอนถูกบัญชี — เว้นว่าง = ใช้ชื่อร้าน">
              <Input value={v.promptpayName ?? ''} onChange={(t) => set({ promptpayName: t })} max={60} placeholder="เช่น บจก. ร้านเสื้อผ้า" />
            </Field>
            <View style={s.optRow}>
              <Icon name="lock-closed-outline" size={22} color={colors.text} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.optTitle}>ล็อคยอดเงินใน QR อัตโนมัติ</Text>
                <Text style={s.sub}>
                  {v.promptpayLock !== false
                    ? 'เปิดอยู่ — QR สร้างใหม่ทุกบิลพร้อมยอดที่ต้องชำระ (รวมค่าธรรมเนียม) ลูกค้าสแกนแล้วแอปธนาคารกรอกยอดให้ แก้ยอดไม่ได้'
                    : 'ปิดอยู่ — QR ไม่มียอดเงิน ลูกค้าต้องพิมพ์ยอดเองในแอปธนาคาร (เสี่ยงโอนผิดยอด)'}
                </Text>
              </View>
              <Switch value={v.promptpayLock !== false} onChange={(x) => set({ promptpayLock: x })} label="ล็อคยอดเงินใน QR อัตโนมัติ" />
            </View>
            <Text style={[s.sub, { fontSize: 11 }]}>
              แจ้งเตือนเมื่อรับชำระพร้อมเพย์ (LINE / WhatsApp / Webhook API) ตั้งได้ที่ ตั้งค่า → การแจ้งเตือน & API → เหตุการณ์ “รับชำระพร้อมเพย์ (QR)”
            </Text>
          </View>
          <View style={{ alignItems: 'center', gap: 6, width: 200 }}>
            <Text style={[s.sub, { fontWeight: '600' }]}>ตัวอย่าง QR (ยอด ฿100)</Text>
            {ppSample ? (
              <View style={{ padding: 8, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: colors.line }}>
                <QrView value={ppSample} size={160} />
              </View>
            ) : (
              <View style={{ width: 176, height: 176, borderRadius: 10, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
                <Icon name="qr-code-outline" size={36} color={colors.faint} />
                <Text style={[s.sub, { textAlign: 'center', fontSize: 11, marginTop: 6 }]}>กรอกหมายเลขพร้อมเพย์ให้ถูกต้องเพื่อดูตัวอย่าง</Text>
              </View>
            )}
            {ppSample ? <Text style={[s.sub, { fontSize: 11, textAlign: 'center' }]}>ลองสแกนด้วยแอปธนาคาร (ไม่ต้องโอนจริง) เพื่อตรวจชื่อบัญชี</Text> : null}
          </View>
        </View>
      </Card>
    </>
  );
}
