// ตั้งค่า → เครื่องพิมพ์บาร์โค้ด ของคอมพิวเตอร์เครื่องนี้ (เก็บในแอปเดสก์ท็อป)
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import type { AdminSettings } from '../api';
import { Icon } from '../components/Icon';
import type { Toast } from '../store/usePos';
import { colors } from '../theme';
import { desktop, type LabelPrinterConfig } from '../desktop';
import { DEFAULT_LABEL_PROFILE } from '../appSettings';
import { labelPageSize, printLabels, profileSummary, sheetName } from '../labels';
import { LabelPreview } from '../components/stock/LabelPreview';
import { Card, Field, STICKY, SmallBtn, Toggle, s } from './ui';
import { sampleFor } from './LabelsSection';

/**
 * ตั้งค่าเครื่องพิมพ์บาร์โค้ดของ "เครื่องนี้" — แยกจากเครื่องพิมพ์ใบเสร็จ (ร้านส่วนใหญ่ใช้คนละเครื่อง)
 * เก็บในแอปเดสก์ท็อป · พิมพ์ผ่านไดรเวอร์ Windows ด้วยขนาดกระดาษตามโปรไฟล์ป้าย (เมนู กระดาษบาร์โค้ด)
 */
export function LabelPrinterSection({ barcode, notify, goLabels }: { barcode: AdminSettings['barcode']; notify: (k: Toast['kind'], t: string) => void; goLabels: () => void }) {
  const app = desktop();
  const bridge = app?.labels;
  const { width } = useWindowDimensions();
  const wide = width >= 1250;
  const [c, setC] = useState<LabelPrinterConfig | null>(null);
  const [saved, setSaved] = useState('');
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([]);
  const [receiptPrinter, setReceiptPrinter] = useState('');
  const [busy, setBusy] = useState<'' | 'test' | 'save'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const profiles = barcode.labelProfiles?.length ? barcode.labelProfiles : [DEFAULT_LABEL_PROFILE];
  const [profileId, setProfileId] = useState(barcode.labelProfile || profiles[0].id);
  const profile = profiles.find((x) => x.id === profileId) ?? profiles[0];

  const loadPrinters = useCallback(() => {
    bridge?.list().then(setPrinters).catch(() => {});
  }, [bridge]);
  useEffect(() => {
    if (!bridge) return;
    bridge.get().then((x) => {
      if (!x) return;
      const cfg = { labelPrinter: x.labelPrinter, labelSilent: x.labelSilent };
      setC(cfg);
      setSaved(JSON.stringify(cfg));
    });
    loadPrinters();
    app?.printer?.get().then((r) => setReceiptPrinter(r?.printMode === 'driver' || r?.connection === 'usb' ? r?.printer ?? '' : '')).catch(() => {});
  }, [bridge, app, loadPrinters]);

  if (bridge && !c) return <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />;

  const set = (x: Partial<LabelPrinterConfig>) => {
    if (c) setC({ ...c, ...x });
    setMsg(null);
  };
  const dirty = !!c && JSON.stringify(c) !== saved;
  const chip = (on: boolean) => [s.segItem, on && s.segOn];
  const missing = !!c?.labelPrinter && printers.length > 0 && !printers.some((p) => p.name === c.labelPrinter);
  const sameAsReceipt = !!c?.labelPrinter && c.labelPrinter === receiptPrinter;
  const sample = sampleFor(profile);
  const page = labelPageSize(profile);
  const mm = (n: number) => Math.round(n * 10) / 10;

  // ทดสอบพิมพ์ 1 แถว ด้วยโปรไฟล์ที่เลือก (ใช้ค่าล่าสุดจากเมนู กระดาษบาร์โค้ด แม้ยังไม่บันทึก)
  const test = () => {
    setMsg(null);
    if (!bridge) {
      // เบราว์เซอร์ / แอปรุ่นเก่า → เปิดหน้าต่างพิมพ์ให้เลือกเครื่องเอง
      const ok = printLabels(Array.from({ length: profile.cols }, () => sample), profile);
      setMsg(ok ? { ok: true, text: 'เปิดหน้าต่างพิมพ์แล้ว — เลือกเครื่องพิมพ์บาร์โค้ด' } : { ok: false, text: 'เปิดหน้าต่างพิมพ์ไม่ได้ — อนุญาต pop-up ของหน้านี้ แล้วกดอีกครั้ง' });
      return;
    }
    setBusy('test');
    const ok = printLabels(Array.from({ length: profile.cols }, () => sample), profile, c ?? undefined, (r) => {
      setBusy('');
      setMsg(r.ok ? { ok: true, text: c?.labelPrinter && c.labelSilent ? `ส่งป้ายทดสอบเข้า "${c.labelPrinter}" แล้ว` : 'เปิดกล่องพิมพ์แล้ว' } : { ok: false, text: r.error ?? 'พิมพ์ไม่สำเร็จ' });
    });
    if (!ok) setBusy('');
  };
  const save = async () => {
    if (!bridge || !c) return;
    setBusy('save');
    try {
      const x = await bridge.save(c);
      if (x) {
        const cfg = { labelPrinter: x.labelPrinter, labelSilent: x.labelSilent };
        setC(cfg);
        setSaved(JSON.stringify(cfg));
        notify('success', 'บันทึกเครื่องพิมพ์บาร์โค้ดแล้ว');
      }
    } finally {
      setBusy('');
    }
  };

  const printerCard =
    bridge && c ? (
      <Card title="เครื่องพิมพ์บาร์โค้ด (ป้ายติดสินค้า)">
        <Text style={s.hint}>
          แยกจากเครื่องพิมพ์ใบเสร็จ — ใบเสร็จออกเครื่องที่ตั้งใน "ตั้งค่าเครื่องพิมพ์ใบเสร็จ" ส่วนป้ายบาร์โค้ดออกเครื่องที่เลือกตรงนี้ ·
          ต้องติดตั้งไดรเวอร์ของเครื่องพิมพ์บาร์โค้ดใน Windows ก่อน
        </Text>
        <Field label="เครื่องพิมพ์ใน Windows">
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            <Pressable onPress={() => set({ labelPrinter: '' })} style={chip(c.labelPrinter === '')}>
              <Text style={[s.segText, c.labelPrinter === '' && { color: '#fff' }]}>ถามทุกครั้ง</Text>
            </Pressable>
            {printers.map((p) => (
              <Pressable key={p.name} onPress={() => set({ labelPrinter: p.name })} style={chip(c.labelPrinter === p.name)}>
                <Text style={[s.segText, c.labelPrinter === p.name && { color: '#fff' }]}>
                  {p.displayName}{p.name === receiptPrinter ? ' (เครื่องใบเสร็จ)' : ''}
                </Text>
              </Pressable>
            ))}
            {missing ? <View style={chip(true)}><Text style={[s.segText, { color: '#fff' }]}>{c.labelPrinter} (ไม่พบตอนนี้)</Text></View> : null}
            <SmallBtn label="โหลดรายชื่อใหม่" icon="refresh" onPress={loadPrinters} />
          </View>
          {missing ? <Text style={[s.hint, { color: colors.danger }]}>ไม่พบ "{c.labelPrinter}" — ตรวจสาย/การเปิดเครื่อง แล้วกด "โหลดรายชื่อใหม่"</Text> : null}
          {sameAsReceipt ? <Text style={[s.hint, { color: '#B26A00' }]}>เครื่องนี้ตั้งเป็นเครื่องพิมพ์ใบเสร็จอยู่ด้วย — ถ้าใช้คนละเครื่อง ให้เลือกเครื่องพิมพ์บาร์โค้ด</Text> : null}
        </Field>
        <Toggle
          label="พิมพ์ทันทีโดยไม่ถาม"
          hint={c.labelPrinter ? 'ปิด = แสดงกล่องเลือกเครื่องพิมพ์ทุกครั้ง' : 'เลือกเครื่องพิมพ์ด้านบนก่อน — "ถามทุกครั้ง" จะแสดงกล่องเลือกเครื่องพิมพ์เสมอ'}
          value={c.labelSilent}
          onChange={(x) => set({ labelSilent: x })}
        />
      </Card>
    ) : (
      <Card title={app ? 'อัปเดตแอป Clothing POS เพื่อเลือกเครื่องพิมพ์' : 'เลือกเครื่องพิมพ์ได้ในแอป Clothing POS'}>
        <Text style={s.hint}>
          {app
            ? `แอปเวอร์ชัน ${app.version} ที่ติดตั้งอยู่ยังไม่รองรับการตั้งเครื่องพิมพ์บาร์โค้ดแยก — กดปุ่ม "อัปเดต" ในโปรแกรมเมื่อมีเวอร์ชันใหม่ · ระหว่างนี้การพิมพ์ป้ายจะเปิดหน้าต่างพิมพ์ให้เลือกเครื่องพิมพ์บาร์โค้ดเอง`
            : 'เครื่องพิมพ์บาร์โค้ดตั้งค่าแยกในคอมพิวเตอร์แต่ละเครื่อง — เปิดหน้านี้จากแอป Clothing POS บนเครื่องที่ต่อเครื่องพิมพ์บาร์โค้ด เพื่อเลือกเครื่องและพิมพ์ทันทีโดยไม่ถาม · เมื่อเปิดผ่านเบราว์เซอร์ การพิมพ์ป้ายจะเปิดหน้าต่างพิมพ์ให้เลือกเครื่องเอง (ทดสอบพิมพ์ได้ด้านข้าง)'}
        </Text>
      </Card>
    );

  const settings = (
    <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
      {printerCard}
      <Card title="ขนาดกระดาษ & ความละเอียดในไดรเวอร์เครื่องพิมพ์">
        <Text style={s.hint}>
          ระบบส่งขนาดหน้ากระดาษให้เครื่องพิมพ์ตามโปรไฟล์ป้ายอัตโนมัติ — ถ้าพิมพ์เลื่อน/ขาด/เว้นดวง ให้ตั้งขนาดกระดาษใน Printing Preferences ของไดรเวอร์ให้ตรงตามนี้
        </Text>
        <View style={{ gap: 6 }}>
          {profiles.map((q) => {
            const pg = labelPageSize(q);
            return (
              <View key={q.id} style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={[s.sub, { flex: 1 }]} numberOfLines={1}>{q.name}</Text>
                <Text style={[s.sub, { fontWeight: '700', color: colors.text }]}>
                  {q.paper === 'a4' ? `${sheetName(q)} (${mm(pg.width)} × ${mm(pg.height)} มม.)` : `${mm(pg.width)} × ${mm(pg.height)} มม.`}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={s.hint}>
          {Platform.OS === 'web' && !bridge ? 'ในหน้าต่างพิมพ์ของเบราว์เซอร์: เลือกเครื่องพิมพ์บาร์โค้ด · ขนาดกระดาษให้ตรง · ระยะขอบ: ไม่มี · ' : ''}
          ความละเอียดเครื่องพิมพ์: เครื่องพิมพ์ป้ายทั่วไป 203 dpi → ตั้ง "ความหนาแท่ง" ของบาร์โค้ด 0.25 มม. ขึ้นไป · 300 dpi → 0.17 มม. ขึ้นไป เพื่อให้แท่งคมและสแกนติดง่าย ·{' '}
          ปรับขนาดดวง จำนวนดวงต่อแถว ระยะขอบ ความหนาแท่ง และหน้าตาป้าย ได้ที่เมนู{' '}
          <Text style={s.link} onPress={goLabels}>กระดาษบาร์โค้ด</Text>
        </Text>
      </Card>
    </View>
  );

  const side = (
    <View style={[{ gap: 12 }, wide ? [{ width: 380 }, STICKY] : { width: '100%' }]}>
      <Card title={bridge ? 'ทดสอบ & บันทึก' : 'ทดสอบพิมพ์ป้าย'}>
        <Text style={s.hint}>
          ทดสอบพิมพ์ 1 แถว (ไม่เปลืองสติ๊กเกอร์) ด้วยหน้าตาป้ายล่าสุดจากเมนู กระดาษบาร์โค้ด ได้เลยแม้ยังไม่บันทึก
          {bridge ? ' · ค่าเครื่องพิมพ์ในหน้านี้ใช้เฉพาะคอมพิวเตอร์เครื่องนี้' : ''}
        </Text>
        <Field label="โปรไฟล์ป้ายที่ใช้ทดสอบ">
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            {profiles.map((p) => (
              <Pressable key={p.id} onPress={() => setProfileId(p.id)} style={chip(p.id === profile.id)}>
                <Text style={[s.segText, p.id === profile.id && { color: '#fff' }]}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.hint}>{profileSummary(profile)} · หน้ากระดาษ {profile.paper === 'a4' ? sheetName(profile) : `${mm(page.width)} × ${mm(page.height)} มม.`}</Text>
        </Field>
        <View style={s.previewBox}>
          <LabelPreview profile={profile} sample={sample} maxWidth={wide ? 340 : 520} />
        </View>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          <SmallBtn label="ทดสอบพิมพ์ป้าย" icon="print-outline" onPress={test} busy={busy === 'test'} />
        </View>
        {msg ? <Text style={[s.hint, { color: msg.ok ? colors.success : colors.danger }]}>{msg.ok ? '✓ ' : ''}{msg.text}</Text> : null}
        {bridge && c ? (
          <View style={[s.row, { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }]}>
            <Text style={[s.sub, { flex: 1 }]}>{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'บันทึกแล้ว'}</Text>
            <Pressable style={[s.ghostBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty || busy === 'save'} onPress={() => setC(JSON.parse(saved) as LabelPrinterConfig)}>
              <Text style={s.ghostText}>ยกเลิก</Text>
            </Pressable>
            <Pressable style={[s.primaryBtn, (!dirty || busy === 'save') && { opacity: 0.45 }]} disabled={!dirty || busy === 'save'} onPress={save}>
              {busy === 'save' ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Icon name="save-outline" size={16} color="#fff" />
                  <Text style={s.primaryText}>บันทึก</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}
      </Card>
    </View>
  );

  return wide ? (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      {settings}
      {side}
    </View>
  ) : (
    <View style={{ gap: 12 }}>
      {side}
      {settings}
    </View>
  );
}
