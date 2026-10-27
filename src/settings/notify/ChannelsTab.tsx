// การแจ้งเตือน → แท็บช่องทาง (LINE · WhatsApp · Webhook) + ทดสอบส่ง
import { Pressable, Text, View } from 'react-native';
import type { AdminSettings } from '../../api';
import { Icon } from '../../components/Icon';
import { colors } from '../../theme';
import { Card, Field, Grid, Input, SmallBtn, Toggle, type Upd, s } from '../ui';
import type { TestFn } from './NotifySection';

export function ChannelsTab({ v, set, test, testing }: { v: AdminSettings['notify']; set: Upd<AdminSettings['notify']>; test: TestFn; testing: string | null }) {
  return (
    <>
      <Card title="LINE (Messaging API) — แนะนำ">
        <Toggle label="เปิดใช้การแจ้งเตือนทาง LINE" hint="ส่งเป็นการ์ดสวยงาม (Flex Message) ปรับหน้าตาได้ที่แท็บ “ออกแบบการ์ด LINE”" value={v.line.enabled} onChange={(x) => set({ line: { ...v.line, enabled: x } })} />
        <Grid>
          <Field label="Channel access token" hint={v.line.token.startsWith('••') ? `มีแล้ว (${v.line.token}) — กรอกใหม่เพื่อเปลี่ยน` : 'LINE Developers → Messaging API → Channel access token (long-lived)'}>
            <Input value={v.line.token.startsWith('••') ? '' : v.line.token} onChange={(t) => set({ line: { ...v.line, token: t.trim() } })} placeholder={v.line.token || 'token'} secure max={500} />
          </Field>
          <Field label="ส่งถึง (User ID / Group ID)" hint="User ID ขึ้นต้นด้วย U… · Group ID ขึ้นต้นด้วย C…">
            <Input value={v.line.to} onChange={(t) => set({ line: { ...v.line, to: t.trim() } })} placeholder="Uxxxxxxxx หรือ Cxxxxxxxx" max={80} />
          </Field>
        </Grid>
        <View style={s.infoBox}>
          <Text style={s.b}>ตั้งค่าครั้งแรก (ประมาณ 5 นาที)</Text>
          <Text style={s.p}>1. สร้าง LINE Official Account ที่ manager.line.biz แล้วเปิด “Messaging API”</Text>
          <Text style={s.p}>2. ที่ developers.line.biz → Channel → Messaging API → กด Issue “Channel access token” แล้วนำมาวาง</Text>
          <Text style={s.p}>3. User ID ของคุณอยู่ที่แท็บ Basic settings (Your user ID) · หรือเพิ่มบอทเข้ากลุ่มเพื่อแจ้งทั้งทีม แล้วใช้ Group ID</Text>
          <Text style={s.p}>4. เพิ่มบอทเป็นเพื่อนในแอป LINE → บันทึก → กด “ทดสอบส่ง”</Text>
          <Text style={s.hint}>LINE Notify ปิดบริการแล้ว (31 มี.ค. 2025) ระบบนี้ใช้ Messaging API แทน · บัญชีฟรีส่งได้ตามโควตาข้อความต่อเดือนของ LINE OA</Text>
        </View>
        <View style={[s.row, { justifyContent: 'flex-end' }]}>
          <SmallBtn label="ทดสอบส่งการ์ด" icon="paper-plane-outline" busy={testing === 'line'} onPress={() => test('line')} />
        </View>
      </Card>

      <Card title="WhatsApp (Cloud API)">
        <Toggle label="เปิดใช้การแจ้งเตือนทาง WhatsApp" hint="ส่งเป็นข้อความตัวอักษร (ใช้ข้อความเดียวกับการ์ด LINE)" value={v.whatsapp.enabled} onChange={(x) => set({ whatsapp: { ...v.whatsapp, enabled: x } })} />
        <Grid>
          <Field label="Access token" hint={v.whatsapp.token.startsWith('••') ? `มีแล้ว (${v.whatsapp.token})` : 'จาก Meta for Developers'}>
            <Input value={v.whatsapp.token.startsWith('••') ? '' : v.whatsapp.token} onChange={(t) => set({ whatsapp: { ...v.whatsapp, token: t.trim() } })} placeholder={v.whatsapp.token || 'token'} secure max={500} />
          </Field>
          <Field label="Phone number ID"><Input value={v.whatsapp.phoneNumberId} onChange={(t) => set({ whatsapp: { ...v.whatsapp, phoneNumberId: t.trim() } })} max={40} /></Field>
          <Field label="เบอร์ผู้รับ" hint="รูปแบบสากล เช่น 66812345678"><Input value={v.whatsapp.to} onChange={(t) => set({ whatsapp: { ...v.whatsapp, to: t.replace(/[^0-9]/g, '') } })} keyboard="number-pad" max={20} /></Field>
        </Grid>
        <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
          <Text style={[s.sub, { flex: 1, minWidth: 200 }]}>WhatsApp ส่งข้อความอิสระได้เมื่อผู้รับเคยทักบอทภายใน 24 ชม. (นอกเหนือจากนั้นต้องใช้ Template ที่ Meta อนุมัติ)</Text>
          <SmallBtn label="ทดสอบส่ง" icon="paper-plane-outline" busy={testing === 'whatsapp'} onPress={() => test('whatsapp')} />
        </View>
      </Card>

      <Card title="Webhook (ส่งเหตุการณ์ให้ระบบอื่น)">
        <Toggle label="เปิดใช้ Webhook" hint="ระบบจะ POST JSON ไปที่ URL ทันทีที่เกิดเหตุการณ์ — ใช้ต่อกับ Google Sheets, n8n, Make, Zapier, Discord หรือระบบของคุณเอง" value={v.webhook.enabled} onChange={(x) => set({ webhook: { ...v.webhook, enabled: x } })} />
        <Field label="Webhook URL">
          <Input value={v.webhook.url} onChange={(t) => set({ webhook: { ...v.webhook, url: t.trim() } })} placeholder="https://example.com/pos-webhook" max={300} />
        </Field>
        <Field label="Secret สำหรับลายเซ็น (ไม่บังคับ)" hint={v.webhook.secret.startsWith('••') ? `มีแล้ว (${v.webhook.secret})` : 'ส่งเป็น header X-POS-Signature: sha256=HMAC(secret, body) เพื่อยืนยันว่ามาจากร้านจริง'}>
          <Input value={v.webhook.secret.startsWith('••') ? '' : v.webhook.secret} onChange={(t) => set({ webhook: { ...v.webhook, secret: t } })} placeholder={v.webhook.secret || 'ไม่บังคับ'} secure max={200} />
        </Field>
        <View style={s.infoBox}>
          <Text style={s.b}>ตัวอย่างข้อมูลที่ส่ง</Text>
          <Text selectable style={s.code}>{`{ "event": "order.created", "at": "2026-10-11T08:42:00Z",\n  "shop": "ร้านเสื้อผ้า", "branch": "B02", "branchName": "สาขาภูเก็ต",\n  "data": { "orderNo": "INV-B02-261011-0012", "total": 1280, ... } }`}</Text>
          <Text style={s.hint}>header: X-POS-Event = ชื่อเหตุการณ์ · เลือกว่าเหตุการณ์ไหนส่ง Webhook ได้ที่แท็บ “เหตุการณ์”</Text>
        </View>
        <View style={[s.row, { justifyContent: 'flex-end' }]}>
          <SmallBtn label="ทดสอบ Webhook" icon="flash-outline" busy={testing === 'webhook'} onPress={() => test('webhook')} />
        </View>
      </Card>
    </>
  );
}

export function ChannelChip({ label, value, onChange, ready }: { label: string; value: boolean; onChange: (x: boolean) => void; ready: boolean }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={[s.chChip, value && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <Icon name={value ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={value ? colors.primary : colors.faint} />
      <Text style={[s.chText, value && { color: colors.primary, fontWeight: '600' }, value && !ready && { color: '#B26A00' }]}>{label}</Text>
    </Pressable>
  );
}
