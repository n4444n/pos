// ตั้งค่า → เครื่องพิมพ์ใบเสร็จ ของคอมพิวเตอร์เครื่องนี้ (USB / LAN / Bluetooth · ESC/POS · ลิ้นชักเงิน)
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Icon } from '../components/Icon';
import type { Toast } from '../store/usePos';
import { colors } from '../theme';
import { desktop, type PrinterConfig } from '../desktop';
import { AutoImage, Card, Field, Grid, Input, STICKY, Seg, SmallBtn, Toggle, s } from './ui';

/**
 * ตั้งค่าเครื่องพิมพ์ใบเสร็จของ "เครื่องนี้" — เก็บในแอปเดสก์ท็อป (แต่ละเครื่อง/สาขาตั้งไม่เหมือนกันได้)
 * บันทึกแยกจากตั้งค่าร้าน (ปุ่มบันทึกในการ์ดด้านขวา) · เปิดผ่านเบราว์เซอร์จะไม่มีส่วนนี้
 */
export function PrinterSection({ shopPaper, notify, goReceipt }: { shopPaper: 58 | 80; notify: (k: Toast['kind'], t: string) => void; goReceipt: () => void }) {
  const bridge = desktop()?.printer;
  const { width } = useWindowDimensions();
  const [c, setC] = useState<PrinterConfig | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([]);
  const [ports, setPorts] = useState<{ port: string; name: string; bluetooth: boolean }[] | null>(null);
  const [busy, setBusy] = useState<'' | 'test' | 'preview' | 'drawer' | 'save' | 'ports'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ image: string; dots: number } | null>(null);

  const loadPrinters = useCallback(() => {
    bridge?.list().then(setPrinters).catch(() => {});
  }, [bridge]);
  const loadPorts = useCallback(() => {
    if (!bridge?.ports) return;
    setBusy('ports');
    bridge.ports().then(setPorts).catch(() => setPorts([])).finally(() => setBusy(''));
  }, [bridge]);
  const needPorts = c?.printMode === 'raster' && c.connection === 'bluetooth' && ports === null;
  useEffect(() => {
    if (needPorts) loadPorts();
  }, [needPorts, loadPorts]);
  useEffect(() => {
    if (!bridge) return;
    bridge.get().then((x) => {
      if (!x) return;
      const { version: _v, ...cfg } = x;
      setC(cfg);
      setSaved(JSON.stringify(cfg));
    });
    loadPrinters();
  }, [bridge, loadPrinters]);

  if (!bridge) {
    return (
      <Card title="ใช้ได้ในแอป Clothing POS เท่านั้น">
        <Text style={s.hint}>
          การตั้งค่าเครื่องพิมพ์ (USB / LAN · ตัดกระดาษ · ลิ้นชักเงิน) เก็บในคอมพิวเตอร์แต่ละเครื่อง — เปิดหน้านี้จากแอป Clothing POS บนเครื่องที่ต่อเครื่องพิมพ์ ·
          เมื่อเปิดผ่านเบราว์เซอร์ ใบเสร็จจะพิมพ์ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์
        </Text>
      </Card>
    );
  }
  if (!c) return <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />;

  const set = (x: Partial<PrinterConfig>) => {
    setC({ ...c, ...x });
    setPreview(null);
    setMsg(null);
  };
  const dirty = JSON.stringify(c) !== saved;
  const raster = c.printMode === 'raster';
  const paper = c.paperWidth ?? shopPaper;
  const wide = width >= 1250;
  const run = async (kind: 'test' | 'preview' | 'drawer') => {
    setBusy(kind);
    setMsg(null);
    try {
      const r = await (kind === 'test' ? bridge.test(c) : kind === 'preview' ? bridge.preview(c) : bridge.testDrawer(c));
      if (kind === 'preview' && r.ok && r.image) setPreview({ image: r.image, dots: r.dots ?? 0 });
      else setMsg(r.ok ? { ok: true, text: kind === 'test' ? 'ส่งงานพิมพ์แล้ว' : 'ส่งคำสั่งเปิดลิ้นชักแล้ว (ไม่เปิด → ลองเปลี่ยนขาสัญญาณ)' } : { ok: false, text: r.error ?? 'ไม่สำเร็จ' });
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    if (raster && c.connection === 'network' && !c.host.trim()) return setMsg({ ok: false, text: 'ใส่ IP เครื่องพิมพ์' });
    if (raster && c.connection === 'usb' && !c.printer) return setMsg({ ok: false, text: 'เลือกเครื่องพิมพ์ใบเสร็จ' });
    if (raster && c.connection === 'bluetooth' && !c.comPort) return setMsg({ ok: false, text: 'เลือกพอร์ต Bluetooth ของเครื่องพิมพ์' });
    setBusy('save');
    try {
      const x = await bridge.save(c);
      if (x) {
        const { version: _v, ...cfg } = x;
        setC(cfg);
        setSaved(JSON.stringify(cfg));
        notify('success', 'บันทึกการตั้งค่าเครื่องพิมพ์แล้ว');
      }
    } finally {
      setBusy('');
    }
  };
  const reset = () => {
    setC(JSON.parse(saved) as PrinterConfig);
    setPreview(null);
    setMsg(null);
  };
  const numIn = (key: 'port' | 'dots' | 'feedTop' | 'feedBottom', max: number) => (
    <Input value={String(c[key])} onChange={(t) => set({ [key]: Math.min(max, Number(t.replace(/\D/g, '')) || 0) } as Partial<PrinterConfig>)} keyboard="number-pad" max={5} />
  );
  const printerOptions = printers.filter((p) => !raster || !/microsoft|onenote|fax|pdf|xps/i.test(p.name));
  const chip = (on: boolean) => [s.segItem, on && s.segOn];

  // ---------- คอลัมน์ซ้าย: ตั้งค่า ----------
  const settings = (
    <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
      <Card title="วิธีพิมพ์ & การเชื่อมต่อ">
        <Grid max={2}>
          <Field label="วิธีพิมพ์" hint={raster ? 'ส่งเป็นรูปภาพตรงเข้าเครื่องพิมพ์ใบเสร็จ — ภาษาไทยถูกทุกตัว ตัดกระดาษ/เปิดลิ้นชักได้' : 'ผ่านไดรเวอร์ Windows — สำหรับเครื่องพิมพ์ที่ไม่รองรับ ESC/POS'}>
            <Seg value={c.printMode} options={[['raster', 'ESC/POS (แนะนำ)'], ['driver', 'ไดรเวอร์ Windows']]} onChange={(x) => set({ printMode: x as PrinterConfig['printMode'] })} />
          </Field>
          {raster ? (
            <Field
              label="การเชื่อมต่อ"
              hint={
                c.connection === 'usb'
                  ? 'สาย USB — ต้องติดตั้งไดรเวอร์ของเครื่องใน Windows แล้ว'
                  : c.connection === 'network'
                    ? 'ต่อผ่านเครือข่าย — ดู IP จากใบที่พิมพ์ตอนกด FEED ค้างขณะเปิดเครื่อง'
                    : 'จับคู่เครื่องพิมพ์ใน Windows ก่อน แล้วเลือกพอร์ต COM ของเครื่องพิมพ์ด้านล่าง'
              }
            >
              <Seg value={c.connection} options={[['usb', 'USB'], ['network', 'LAN / WiFi'], ['bluetooth', 'Bluetooth']]} onChange={(x) => set({ connection: x as PrinterConfig['connection'] })} />
            </Field>
          ) : (
            <Toggle label="พิมพ์ทันทีโดยไม่ถาม" hint="ปิด = แสดงกล่องเลือกเครื่องพิมพ์ทุกครั้ง" value={c.silent} onChange={(x) => set({ silent: x })} />
          )}
        </Grid>
        {raster && c.connection === 'bluetooth' ? (
          <>
            <Field label="พอร์ต Bluetooth (COM)">
              <View style={[s.row, { flexWrap: 'wrap' }]}>
                {(ports ?? []).map((p) => (
                  <Pressable key={p.port} onPress={() => set({ comPort: p.port })} style={chip(c.comPort === p.port)}>
                    <Text style={[s.segText, c.comPort === p.port && { color: '#fff' }]}>
                      {p.bluetooth ? '🔵 ' : ''}{p.port}{p.name && p.name !== p.port ? ` · ${p.name.replace(/\s*\(COM\d+\)$/, '')}` : ''}
                    </Text>
                  </Pressable>
                ))}
                {c.comPort && ports && !ports.some((p) => p.port === c.comPort) ? (
                  <View style={chip(true)}><Text style={[s.segText, { color: '#fff' }]}>{c.comPort} (ไม่พบตอนนี้)</Text></View>
                ) : null}
                <SmallBtn label="ค้นหาพอร์ตใหม่" icon="bluetooth-outline" onPress={loadPorts} busy={busy === 'ports'} />
              </View>
              <Text style={s.hint}>
                ยังไม่มีพอร์ต: Windows → ตั้งค่า → Bluetooth และอุปกรณ์ → เพิ่มอุปกรณ์ → เลือกเครื่องพิมพ์ (รหัสจับคู่มักเป็น 0000 หรือ 1234) → กด "ค้นหาพอร์ตใหม่" ·
                เครื่องเดียวอาจมี 2 พอร์ต — ถ้าพิมพ์ไม่ออก ให้ลองอีกพอร์ต · ใช้กับสาย Serial (RS-232) ได้ด้วย
              </Text>
            </Field>
            <Field label="ความเร็วพอร์ต (baud)" hint="Bluetooth ใช้ค่าใดก็ได้ · สาย Serial ต้องตรงกับเครื่องพิมพ์ (ส่วนใหญ่ 9600 หรือ 115200)">
              <Seg value={c.baud} options={[[9600, '9600'], [19200, '19200'], [38400, '38400'], [115200, '115200']]} onChange={(x) => set({ baud: Number(x) })} />
            </Field>
          </>
        ) : raster && c.connection === 'network' ? (
          <Grid max={3}>
            <Field label="IP เครื่องพิมพ์" hint="ทดสอบด้วยเครื่องพิมพ์จำลอง: 127.0.0.1"><Input value={c.host} onChange={(t) => set({ host: t.trim() })} placeholder="เช่น 192.168.1.50" max={100} /></Field>
            <Field label="พอร์ต" hint="ปกติ 9100">{numIn('port', 65535)}</Field>
          </Grid>
        ) : (
          <Field label="เครื่องพิมพ์ใน Windows">
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              {!raster ? (
                <Pressable onPress={() => set({ printer: '' })} style={chip(c.printer === '')}>
                  <Text style={[s.segText, c.printer === '' && { color: '#fff' }]}>เครื่องหลักของ Windows</Text>
                </Pressable>
              ) : null}
              {printerOptions.map((p) => (
                <Pressable key={p.name} onPress={() => set({ printer: p.name })} style={chip(c.printer === p.name)}>
                  <Text style={[s.segText, c.printer === p.name && { color: '#fff' }]}>{p.displayName}</Text>
                </Pressable>
              ))}
              <SmallBtn label="โหลดรายชื่อใหม่" icon="refresh" onPress={loadPrinters} />
            </View>
            {raster && !printerOptions.length ? <Text style={s.hint}>ยังไม่พบเครื่องพิมพ์ใบเสร็จใน Windows — ต่อสาย USB ติดตั้งไดรเวอร์ แล้วกด "โหลดรายชื่อใหม่" · หรือใช้ LAN / WiFi</Text> : null}
            {c.printer && !printers.some((p) => p.name === c.printer) ? <Text style={[s.hint, { color: colors.danger }]}>ไม่พบ "{c.printer}" — ตรวจสาย/การเปิดเครื่อง</Text> : null}
          </Field>
        )}
      </Card>

      <Card title="กระดาษ & คุณภาพการพิมพ์">
        <Grid max={raster ? 3 : 1}>
          <Field label="ขนาดกระดาษของเครื่องนี้" hint={`"ตามร้าน" = ${shopPaper} มม. (ตั้งที่เมนู ใบเสร็จ)`}>
            <Seg value={c.paperWidth ?? 0} options={[[0, 'ตามร้าน'], [58, '58 มม.'], [80, '80 มม.']]} onChange={(x) => set({ paperWidth: x ? (x as 58 | 80) : null })} />
          </Field>
          {raster ? <Field label="ความกว้างพิมพ์ (จุด)" hint={`0 = อัตโนมัติ (${paper === 58 ? 384 : 576}) · ขอบขวาหาย → ลดทีละ 8`}>{numIn('dots', 1024)}</Field> : null}
          {raster ? (
            <Field label="ความเข้ม" hint="พิมพ์จาง → เลือกเข้มขึ้น">
              <Seg value={c.threshold} options={[[130, 'จาง'], [160, 'ปกติ'], [190, 'เข้ม'], [215, 'เข้มมาก']]} onChange={(x) => set({ threshold: Number(x) })} />
            </Field>
          ) : null}
        </Grid>
        {raster ? (
          <Grid max={3}>
            <Field label="เว้นหัวกระดาษ (มม.)">{numIn('feedTop', 30)}</Field>
            <Field label="เว้นท้ายก่อนตัด (มม.)">{numIn('feedBottom', 50)}</Field>
          </Grid>
        ) : null}
      </Card>

      {raster ? (
        <Card title="ตัดกระดาษ & ลิ้นชักเงิน">
          <Toggle label="ตัดกระดาษหลังพิมพ์" hint="เฉพาะเครื่องที่มีใบมีดตัด · พิมพ์หลายสำเนาจะตัดคั่นแต่ละใบ" value={c.cut} onChange={(x) => set({ cut: x })} />
          <Grid max={2}>
            <Field label="เปิดลิ้นชักเงิน (เสียบสายเข้าเครื่องพิมพ์)" hint="เปิดตอนขายเสร็จ · พิมพ์ใบเสร็จซ้ำจากประวัติจะไม่เปิด">
              <Seg value={c.drawer} options={[['off', 'ไม่เปิด'], ['cash', 'ขายด้วยเงินสด'], ['sale', 'ทุกการขาย']]} onChange={(x) => set({ drawer: x as PrinterConfig['drawer'] })} />
            </Field>
            <Field label="ขาสัญญาณลิ้นชัก" hint="ลิ้นชักไม่เปิด → ลองอีกขา">
              <View style={[s.row, { flexWrap: 'wrap' }]}>
                <Seg value={c.drawerPin} options={[[0, 'ขา 2 (ทั่วไป)'], [1, 'ขา 5']]} onChange={(x) => set({ drawerPin: Number(x) as 0 | 1 })} />
                <SmallBtn label="ทดสอบเปิดลิ้นชัก" icon="cash-outline" onPress={() => run('drawer')} busy={busy === 'drawer'} />
              </View>
            </Field>
          </Grid>
        </Card>
      ) : null}
    </View>
  );

  // ---------- คอลัมน์ขวา: บันทึก ทดสอบ ตัวอย่าง ----------
  const side = (
    <View style={[{ gap: 12 }, wide ? [{ width: 380 }, STICKY] : { width: '100%' }]}>
      <Card title="บันทึก & ทดสอบ">
        <Text style={s.hint}>ค่าในหน้านี้ใช้เฉพาะคอมพิวเตอร์เครื่องนี้ บันทึกแยกจากตั้งค่าร้าน · พิมพ์ทดสอบ/ดูตัวอย่างใช้ค่าที่เลือกอยู่ได้ก่อนบันทึก</Text>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          <SmallBtn label="พิมพ์ทดสอบ" icon="print-outline" onPress={() => run('test')} busy={busy === 'test'} />
          {raster ? <SmallBtn label="ดูตัวอย่าง" icon="eye-outline" onPress={() => run('preview')} busy={busy === 'preview'} /> : null}
        </View>
        {msg ? <Text style={[s.hint, { color: msg.ok ? colors.success : colors.danger }]}>{msg.ok ? '✓ ' : ''}{msg.text}</Text> : null}
        <View style={[s.row, { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }]}>
          <Text style={[s.sub, { flex: 1 }]}>{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'บันทึกแล้ว'}</Text>
          <Pressable style={[s.ghostBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty || busy === 'save'} onPress={reset}>
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
      </Card>
      {raster ? (
        <Card title="ตัวอย่างที่จะพิมพ์">
          {preview ? (
            <View style={s.previewBox}>
              <View style={s.previewPaper}><AutoImage uri={preview.image} width={Math.min(preview.dots, 300)} /></View>
              <Text style={s.hint}>กว้าง {preview.dots} จุด · เส้นประแดง = ตัดกระดาษ</Text>
            </View>
          ) : (
            <Pressable style={s.previewEmpty} onPress={() => run('preview')}>
              {busy === 'preview' ? <ActivityIndicator color={colors.primary} /> : <Icon name="eye-outline" size={26} color={colors.faint} />}
              <Text style={[s.hint, { textAlign: 'center' }]}>กด "ดูตัวอย่าง" เพื่อดูภาพที่ส่งเข้าเครื่องพิมพ์{'\n'}(หน้าทดสอบ ขนาดตามที่ตั้งไว้)</Text>
            </Pressable>
          )}
        </Card>
      ) : null}
      <Pressable onPress={goReceipt}>
        <Text style={[s.hint, { color: colors.primary }]}>หน้าตาใบเสร็จ (ภาษา ข้อความ โลโก้ ขนาดกระดาษของร้าน) ตั้งที่เมนู ใบเสร็จ →</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[{ gap: 12 }, wide ? { flexDirection: 'row', alignItems: 'flex-start' } : null]}>
      {settings}
      {side}
    </View>
  );
}
