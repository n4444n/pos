// ตั้งค่า → Beam Checkout (เครื่องรับบัตร Beam Bolt หน้าร้าน · โหมด Pairing)
//
// ที่นี่ทำ 2 อย่าง
//   1) ค่าตั้งของร้าน (บันทึกด้วยปุ่มบันทึกด้านล่างเหมือนหมวดอื่น): เปิด/ปิด · โหมด · กุญแจ · วิธีรับเงิน
//   2) ผูก/ยกเลิกเครื่อง Bolt (ทำทันที ไม่ผ่านปุ่มบันทึก) — ต้องบันทึกกุญแจก่อนถึงจะผูกได้
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, type AdminSettings, type BeamMethod, type BeamStatus } from '../api';
import { colors, radius } from '../theme';
import { Card, Field, Grid, Input, Seg, SmallBtn, Toggle, type Notify, type Upd, s } from './ui';

const METHODS: [BeamMethod, string][] = [
  ['CARD', 'บัตรเครดิต/เดบิต'],
  ['CARD_INSTALLMENTS', 'ผ่อนชำระผ่านบัตร'],
  ['QR_PROMPT_PAY', 'พร้อมเพย์ QR'],
  ['TRUE_MONEY', 'TrueMoney'],
  ['LINE_PAY', 'LINE Pay'],
  ['SHOPEE_PAY', 'ShopeePay'],
  ['ALIPAY', 'Alipay'],
  ['ALIPAY_PLUS', 'Alipay+'],
  ['WECHAT_PAY', 'WeChat Pay'],
  ['SPAY_LATER', 'SPayLater'],
];

export function BeamSection({ v, set, notify, dirty }: { v: AdminSettings['beam']; set: Upd<AdminSettings['beam']>; notify: Notify; dirty: boolean }) {
  const [status, setStatus] = useState<BeamStatus | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api.beam().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);

  const toggleMethod = (m: BeamMethod) =>
    set({ methods: v.methods.includes(m) ? v.methods.filter((x) => x !== m) : [...v.methods, m] });

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy('');
      load();
    }
  };

  const test = () => run('test', async () => {
    const r = await api.beamTest();
    notify('success', `เชื่อมต่อ Beam ได้ (${r.env === 'production' ? 'ใช้งานจริง' : 'ทดสอบ'} · ร้าน ${r.merchantId})`);
  });

  const pair = () => run('pair', async () => {
    await api.beamPair(code.trim());
    setCode('');
    notify('success', 'ผูกเครื่องแล้ว — ที่เครื่องควรขึ้นว่าพร้อมรับเงิน');
  });

  const unpair = (terminalId: number) => run('unpair', async () => {
    const r = await api.beamUnpair(terminalId);
    notify(r.warning ? 'error' : 'success', r.warning || 'ยกเลิกการผูกเครื่องแล้ว');
  });

  return (
    <>
      <Card title="Beam Checkout">
        <Toggle
          label="รับเงินผ่านเครื่อง Beam Bolt"
          hint={
            v.enabled
              ? 'เปิดอยู่: หน้าขายจะมีวิธีชำระ "เครื่องรับบัตร" ส่งยอดไปขึ้นบนเครื่องให้ลูกค้าจ่าย'
              : 'ปิดอยู่ — เปิดเมื่อร้านมีบัญชี Beam และเครื่อง Bolt แล้ว'
          }
          value={v.enabled}
          onChange={(x) => set({ enabled: x })}
        />
        <Grid>
          <Field label="โหมด" hint="กุญแจของสองโหมดใช้แทนกันไม่ได้ · ทดสอบ = เงินไม่เดินจริง">
            <Seg
              value={v.env}
              options={[['playground', 'ทดสอบ'], ['production', 'ใช้งานจริง']]}
              onChange={(x) => set({ env: x as AdminSettings['beam']['env'] })}
            />
          </Field>
          <Field label="Merchant ID" hint="ดูได้ในแผงควบคุมของ Beam (Lighthouse)">
            <Input value={v.merchantId} onChange={(t) => set({ merchantId: t.trim() })} max={100} placeholder="เช่น beam_xxxxx" />
          </Field>
          <Field label="API Key" hint="เก็บไว้ในเซิร์ฟเวอร์ร้านเท่านั้น ไม่แสดงซ้ำ · พิมพ์ - เพื่อลบ">
            <Input value={v.apiKey} onChange={(t) => set({ apiKey: t })} max={300} secure placeholder="วางกุญแจที่ได้จาก Beam" />
          </Field>
        </Grid>

        <Field label="วิธีรับเงินที่ให้เครื่องเสนอลูกค้า" hint="เลือกเฉพาะที่เปิดใช้จริงกับบัญชี Beam ของร้าน ไม่งั้นลูกค้าจะกดแล้วไม่ผ่าน">
          <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
            {METHODS.map(([id, label]) => {
              const on = v.methods.includes(id);
              return (
                <Pressable
                  key={id}
                  onPress={() => toggleMethod(id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [
                    {
                      paddingHorizontal: 12, height: 34, borderRadius: radius.md, justifyContent: 'center',
                      borderWidth: 1, borderColor: on ? colors.primary : colors.line,
                      backgroundColor: on ? colors.primarySoft : colors.surface,
                    },
                    hovered && !on ? { borderColor: colors.sub } : undefined,
                  ]}
                >
                  <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? colors.primary : colors.text }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Grid>
          <Field label="ผู้จัดการยืนยันก่อนส่งยอดไปเครื่อง" hint="ยืนยันก่อนเงินออก — ถ้ายืนยันทีหลังแล้วไม่อนุมัติ ต้องคืนเงินลูกค้า">
            <Seg value={v.requireManager ? 1 : 0} options={[[1, 'ต้องยืนยัน'], [0, 'ไม่ต้อง']]} onChange={(x) => set({ requireManager: Number(x) === 1 })} />
          </Field>
          <Field label="รอลูกค้าจ่ายนานสุด" hint="ครบเวลาแล้วยกเลิกรายการบนเครื่องอัตโนมัติ">
            <Seg
              value={v.timeoutSec}
              options={[[60, '1 นาที'], [120, '2 นาที'], [180, '3 นาที'], [300, '5 นาที'], [600, '10 นาที']]}
              onChange={(x) => set({ timeoutSec: Number(x) })}
            />
          </Field>
        </Grid>

        <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
          <SmallBtn label="ทดสอบการเชื่อมต่อ" icon="pulse-outline" onPress={test} busy={busy === 'test'} disabled={dirty || !status?.configured} />
          {dirty ? <Text style={s.sub}>บันทึกก่อน แล้วค่อยกดทดสอบ</Text> : null}
          {!dirty && !status?.configured ? <Text style={s.sub}>ใส่ Merchant ID + API Key แล้วเปิดใช้งานก่อน</Text> : null}
        </View>
      </Card>

      <Card title="เครื่องที่ผูกไว้">
        {status?.connections.length ? (
          status.connections.map((c) => (
            <View key={c.terminalId} style={[s.row, { gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>
                  {c.deviceName || 'เครื่อง Bolt'} {c.terminalId ? `· เครื่อง POS #${c.terminalId}` : '· ใช้ได้ทั้งสาขา'}
                </Text>
                <Text style={s.sub}>
                  {c.deviceId || '—'} · ผูกเมื่อ {c.createdAt}
                  {c.stale ? ' · ผูกไว้คนละโหมดกับที่ตั้งอยู่ ต้องผูกใหม่' : ''}
                </Text>
              </View>
              <SmallBtn label="ยกเลิกการผูก" icon="unlink-outline" onPress={() => unpair(c.terminalId)} busy={busy === 'unpair'} />
            </View>
          ))
        ) : (
          <Text style={s.sub}>ยังไม่ได้ผูกเครื่อง</Text>
        )}

        <Field
          label="ผูกเครื่องใหม่"
          hint="ที่เครื่อง Bolt: เข้าสู่ระบบด้วยบัญชีร้าน → เลือกโหมด Pairing → เครื่องจะแสดงรหัส แล้วนำรหัสมากรอกที่นี่ (รหัสมีอายุสั้น)"
        >
          <View style={[s.row, { gap: 8 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Input value={code} onChange={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))} max={12} placeholder="รหัสจากหน้าจอเครื่อง" />
            </View>
            <SmallBtn label="ผูกเครื่อง" icon="link-outline" onPress={pair} busy={busy === 'pair'} disabled={code.length < 4 || !status?.configured} />
          </View>
        </Field>

        <Text style={s.sub}>
          เครื่องต้องค้างอยู่หน้าจอ "พร้อมรับเงิน" ตอนขาย ไม่งั้นยอดที่ส่งไปจะหายเงียบ ๆ · หนึ่งสาขาผูกได้ 1 เครื่อง
          (ถ้ามีหลายเครื่องต่อสาขา บอกผู้พัฒนาเพื่อผูกแยกรายเครื่อง POS)
        </Text>
      </Card>
    </>
  );
}
