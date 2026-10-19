import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { api, BASE, imageSrc, type AdminSettings, type ApiKeyRow, type NotifyEventInfo, type NotifyEventKey } from '../api';
import { FlexCard } from '../components/notify/FlexCard';
import { QrView } from '../components/QrView';
import { SHAPE_RATIO, type FooterBlock, type ImageShape } from '../appSettings';
import { ProductCard } from '../components/ProductCard';
import { makeVariants } from '../imageVariants';
import type { Product, Variant } from '../types';
import { defaultLabel, RECEIPT_DEFAULT_TEXT, RECEIPT_LABELS, receiptText, type ReceiptLang } from '../receiptText';
import { setAppSettings } from '../appSettings';
import { Icon, type IconName } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { Sheet } from '../components/Sheet';
import { Barcode } from '../components/stock/Barcode';
import { resizeToDataUrl } from '../components/stock/ImagePicker';
import { ToastView } from '../components/ToastView';
import { baht, thaiDateTime } from '../format';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import { desktop, type PrinterConfig } from '../desktop';
import { DEFAULT_LABEL_PROFILE, type LabelProfile } from '../appSettings';
import { LABEL_PRESETS, profileSummary, resolveSymbology, SAMPLE_LABEL, symbologyLabel } from '../labels';
import { SYMBOLOGIES, type Symbology } from '../barcodeEncode';
import { LabelPreview } from '../components/stock/LabelPreview';

type SectionId = 'shop' | 'display' | 'stock' | 'payments' | 'barcode' | 'labels' | 'receipt' | 'printer' | 'notify';
/** หมวดที่บันทึกลงตั้งค่าร้านชุดเดียวกัน (กระดาษบาร์โค้ด → barcode) */
const dataKey = (id: SectionId) => (id === 'labels' ? 'barcode' : id) as keyof AdminSettings;
/** sub = เมนูย่อย (แสดงเยื้องใต้เมนูก่อนหน้า) · local = เก็บในเครื่องนี้ ไม่ใช่ตั้งค่าร้าน (มีปุ่มบันทึกของตัวเอง) */
const SECTIONS: { id: SectionId; label: string; icon: IconName; desc: string; sub?: boolean; local?: boolean }[] = [
  { id: 'shop', label: 'ข้อมูลร้าน', icon: 'storefront-outline', desc: 'ชื่อร้าน เลขผู้เสียภาษี ที่อยู่/เบอร์ค่าเริ่มต้น' },
  { id: 'display', label: 'การแสดงผลหน้าขาย', icon: 'grid-outline', desc: 'มุมมองสินค้า รูปทรง/คุณภาพรูป ตัวอักษร การแสดงสต็อก' },
  { id: 'stock', label: 'สต็อก', icon: 'cube-outline', desc: 'จุดแจ้งเตือนสินค้าเหลือน้อย · รูปแบบรหัส SKU' },
  { id: 'payments', label: 'วิธีชำระเงิน & ค่าธรรมเนียม', icon: 'wallet-outline', desc: 'เปิด/ปิดวิธีชำระ ตั้งชื่อ ค่าธรรมเนียม % / บาท' },
  { id: 'barcode', label: 'บาร์โค้ด', icon: 'barcode-outline', desc: 'ประเภทบาร์โค้ด · สร้างบาร์โค้ดอัตโนมัติ' },
  { id: 'labels', label: 'กระดาษบาร์โค้ด', icon: 'pricetags-outline', desc: 'โปรไฟล์ป้าย · ขนาดสติ๊กเกอร์/ดวงต่อแถว · ขนาดบาร์โค้ด · ข้อมูลและตัวอักษรบนป้าย' },
  { id: 'receipt', label: 'ใบเสร็จ', icon: 'receipt-outline', desc: 'ภาษา (ไทย / English) · แก้คำในบิล · ขนาดกระดาษ · ข้อความหัว/ท้าย' },
  { id: 'printer', label: 'ตั้งค่าเครื่องพิมพ์ใบเสร็จ', icon: 'print-outline', desc: 'เครื่องพิมพ์ของคอมพิวเตอร์เครื่องนี้ · USB / LAN / Bluetooth · ขนาดกระดาษ · ตัดกระดาษ · ลิ้นชักเงิน', local: true },
  { id: 'notify', label: 'การแจ้งเตือน & API', icon: 'notifications-outline', desc: 'LINE (การ์ดปรับแต่งได้) · WhatsApp · Webhook · เหตุการณ์ที่ต้องการแจ้ง · API key' },
];

const SCOPE_LABEL = { read: 'อ่านอย่างเดียว', write: 'อ่าน + เขียน', sync: 'เชื่อมสาขา' } as const;

interface Props {
  onNavigate: (r: Route) => void;
  onSettingsChanged: () => void;
}

/** หน้าตั้งค่า (ผู้จัดการ) */
export function SettingsScreen({ onNavigate, onSettingsChanged }: Props) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const twoPane = width >= 900;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [section, setSection] = useState<SectionId>(() => {
    try {
      let v = globalThis.localStorage?.getItem('pos.settingsTab') as SectionId | 'api' | null;
      if (v === 'api') v = 'notify';
      return v && SECTIONS.some((s) => s.id === v) ? v : 'shop';
    } catch {
      return 'shop';
    }
  });
  const [saved, setSaved] = useState<AdminSettings | null>(null);
  const [draft, setDraft] = useState<AdminSettings | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);

  const load = useCallback(async () => {
    try {
      const r = await api.settings();
      setSaved(r.settings);
      setDraft(structuredClone(r.settings));
      setKeys(r.keys);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem('pos.settingsTab', section);
    } catch {
      /* ignore */
    }
  }, [section]);

  const dk = dataKey(section);
  const dirty = useMemo(() => !!draft && !!saved && dk in draft && JSON.stringify(draft[dk]) !== JSON.stringify(saved[dk]), [draft, saved, dk]);

  const patch = <K extends keyof AdminSettings>(k: K, v: Partial<AdminSettings[K]>) => setDraft((d) => (d ? { ...d, [k]: { ...d[k], ...v } } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await api.saveSettings(dk, draft[dk]);
      setSaved(r.settings);
      setDraft((d) => (d ? { ...d, [dk]: structuredClone(r.settings[dk]) } : d));
      // ให้หน้าขาย/ใบเสร็จเปลี่ยนตามทันที
      const s = r.settings;
      setAppSettings({ shop: s.shop, display: s.display, payments: s.payments, receipt: s.receipt, barcode: { symbology: s.barcode.symbology, labelProfiles: s.barcode.labelProfiles, labelProfile: s.barcode.labelProfile }, stock: { lowStockDefault: s.stock.lowStockDefault, allowNegative: s.stock.allowNegative } });
      onSettingsChanged();
      notify('success', `บันทึก "${SECTIONS.find((x) => x.id === section)!.label}" แล้ว`);
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // เปิด/ปิด API บันทึกทันที (ไม่ต้องกดบันทึก)
  const saveApiEnabled = async (enabled: boolean) => {
    try {
      const r = await api.saveSettings('api', { enabled });
      setSaved((x) => (x ? { ...x, api: r.settings.api } : x));
      setDraft((d) => (d ? { ...d, api: r.settings.api } : d));
      notify('success', enabled ? 'เปิดใช้ API แล้ว' : 'ปิด API แล้ว');
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  const cur = SECTIONS.find((x) => x.id === section)!;

  const nav = (
    <View style={twoPane ? s.navCol : s.navRow}>
      {SECTIONS.map((it) => {
        const on = it.id === section;
        return (
          <Pressable
            key={it.id}
            onPress={() => {
              if (dirty) notify('info', 'มีการแก้ไขที่ยังไม่บันทึกในหมวดเดิม — เปลี่ยนหมวดแล้ว ค่าที่แก้ยังอยู่จนกว่าจะออกจากหน้านี้');
              setSection(it.id);
            }}
            style={({ hovered }: { hovered?: boolean }) => [twoPane ? s.navItem : s.navChip, twoPane && it.sub && s.navSub, on && s.navOn, hovered && !on && { backgroundColor: '#EEF1F6' }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            {twoPane && it.sub ? <Icon name="return-down-forward-outline" size={14} color={on ? '#fff' : colors.faint} /> : null}
            <Icon name={it.icon} size={it.sub ? 16 : 18} color={on ? '#fff' : colors.text} />
            <Text style={[s.navText, on && { color: '#fff', fontWeight: '600' }]} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="settings" onNavigate={onNavigate} /> : null}
      <View style={[s.main, mobile && { padding: 10 }]}>
        <View style={s.header}>
          <View style={[s.row, { flexShrink: 1 }]}>
            <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <View style={{ flexShrink: 1 }}>
              <Text style={s.title}>ตั้งค่า</Text>
              <Text style={s.sub} numberOfLines={1}>ตั้งค่าร้าน หน้าขาย สต็อก การชำระเงิน ใบเสร็จ การแจ้งเตือน และ API</Text>
            </View>
          </View>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
        {!draft ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : (
          <View style={[{ flex: 1, minHeight: 0, gap: 12 }, twoPane && { flexDirection: 'row' }]}>
            {twoPane ? <View style={{ width: 250 }}>{nav}</View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>{nav}</ScrollView>}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={s.secHead}>
                <Icon name={cur.icon} size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={s.secTitle}>{cur.label}</Text>
                  <Text style={s.sub}>{cur.desc}</Text>
                </View>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 90, gap: 12 }}>
                {section === 'shop' ? <ShopSection v={draft.shop} set={(v) => patch('shop', v)} goBranches={() => onNavigate('branches')} /> : null}
                {section === 'display' ? <DisplaySection v={draft.display} set={(v) => patch('display', v)} /> : null}
                {section === 'stock' ? (
                  <StockSection v={draft.stock} set={(v) => patch('stock', v)} openBranches={() => onNavigate('branches')} />
                ) : null}
                {section === 'payments' ? <PaymentsSection v={draft.payments} set={(v) => patch('payments', v)} /> : null}
                {section === 'barcode' ? <BarcodeSection v={draft.barcode} set={(v) => patch('barcode', v)} stock={draft.stock} goStock={() => setSection('stock')} goLabels={() => setSection('labels')} /> : null}
                {section === 'labels' ? <LabelsSection v={draft.barcode} set={(v) => patch('barcode', v)} /> : null}
                {section === 'receipt' ? <ReceiptSection v={draft.receipt} shop={draft.shop} vat={draft.payments.vat} set={(v) => patch('receipt', v)} goPrinter={() => setSection('printer')} /> : null}
                {section === 'printer' ? <PrinterSection shopPaper={draft.receipt.paperWidth} notify={notify} goReceipt={() => setSection('receipt')} /> : null}
                {section === 'notify' ? (
                  <NotifySection
                    v={draft.notify} set={(v) => patch('notify', v)} dirty={dirty} notify={notify}
                    keys={keys} setKeys={setKeys} apiEnabled={draft.api.enabled} setApiEnabled={saveApiEnabled}
                  />
                ) : null}
              </ScrollView>
              {cur.local ? null : (
              <View style={s.saveBar}>
                <Text style={[s.sub, { flex: 1 }]} numberOfLines={2}>{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'บันทึกแล้ว'}</Text>
                <Pressable style={[s.ghostBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty || saving} onPress={() => saved && setDraft((d) => (d ? { ...d, [dk]: structuredClone(saved[dk]) } : d))}>
                  <Text style={s.ghostText}>ยกเลิก</Text>
                </Pressable>
                <Pressable style={[s.primaryBtn, (!dirty || saving) && { opacity: 0.45 }]} disabled={!dirty || saving} onPress={save}>
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Icon name="save-outline" size={16} color="#fff" />
                      <Text style={s.primaryText}>บันทึก</Text>
                    </>
                  )}
                </Pressable>
              </View>
              )}
            </View>
          </View>
        )}
      </View>
      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="settings" onNavigate={onNavigate} />
      <ToastView toast={toast} onDone={() => setToast(null)} />
    </View>
  );
}

// ======================= หมวดต่าง ๆ =======================
type Upd<T> = (v: Partial<T>) => void;
type Notify = (kind: Toast['kind'], text: string) => void;

function ShopSection({ v, set, goBranches }: { v: AdminSettings['shop']; set: Upd<AdminSettings['shop']>; goBranches: () => void }) {
  return (
    <Card>
      <Grid>
        <Field label="ชื่อร้าน *" hint="แสดงบนหัวใบเสร็จทุกสาขา"><Input value={v.name} onChange={(t) => set({ name: t })} placeholder="เช่น ร้านเสื้อผ้า ABC" max={80} /></Field>
        <Field label="เลขประจำตัวผู้เสียภาษี" hint="พิมพ์บนใบเสร็จ/ใบกำกับภาษีอย่างย่อ"><Input value={v.taxId} onChange={(t) => set({ taxId: t.replace(/[^0-9]/g, '') })} placeholder="13 หลัก" max={13} /></Field>
        <Field label="เบอร์โทร (ค่าเริ่มต้น)" hint="ใช้เมื่อสาขาไม่ได้ใส่เบอร์ของตัวเอง"><Input value={v.phone} onChange={(t) => set({ phone: t })} placeholder="02-xxx-xxxx" max={40} /></Field>
      </Grid>
      <Field label="ที่อยู่ (ค่าเริ่มต้น)" hint="ใช้เมื่อสาขาไม่ได้ใส่ที่อยู่ของตัวเอง"><Input value={v.address} onChange={(t) => set({ address: t })} placeholder="ที่อยู่ร้าน" max={300} multiline /></Field>
      <Text style={s.sub}>
        ชื่อสาขา รหัสสาขา ที่อยู่ เบอร์โทร รูป และ VAT ของแต่ละสาขา ตั้งที่เมนู <Text style={s.link} onPress={goBranches}>สาขา</Text>
      </Text>
    </Card>
  );
}

/** สินค้าตัวอย่างสำหรับพรีวิวการ์ด (ไม่ได้มาจากฐานข้อมูล) */
const PREVIEW_PRODUCT: Product = { id: -1, sku: 'TS-001', name: 'เสื้อยืดคอกลม Cotton 100%', categoryId: 'tops', price: 290, art: 'tshirt', tint: '#9CC3E6', imageUrl: null };
const PREVIEW_VARIANTS: Variant[] = ['S', 'M', 'L'].flatMap((size, i) => [
  { id: -10 - i, productId: -1, sku: `TS-001-${size}-W`, size, color: 'ขาว', colorHex: '#F4F4F2', extra: '', stock: 8 - i, price: 290 },
  { id: -20 - i, productId: -1, sku: `TS-001-${size}-N`, size, color: 'กรม', colorHex: '#24345C', extra: '', stock: 5 + i, price: 290 },
]);

function ShapeIcon({ shape, on }: { shape: ImageShape; on: boolean }) {
  const r = SHAPE_RATIO[shape];
  const h = 22;
  return <View style={{ width: Math.round(h * r), height: h, borderRadius: 3, borderWidth: 2, borderColor: on ? '#fff' : colors.sub }} />;
}

function DisplaySection({ v, set }: { v: AdminSettings['display']; set: Upd<AdminSettings['display']> }) {
  const [thumbs, setThumbs] = useState<{ busy: boolean; done: number; total: number; msg: string }>({ busy: false, done: 0, total: 0, msg: '' });

  // รูปเดิมที่อัปโหลดก่อนมีระบบรูปย่อ → ย่อในเบราว์เซอร์นี้แล้วส่งกลับไปเก็บ
  const makeThumbs = async () => {
    setThumbs({ busy: true, done: 0, total: 0, msg: 'กำลังตรวจรูปสินค้า…' });
    try {
      const { urls } = await api.uploadsMissingVariants();
      if (!urls.length) return setThumbs({ busy: false, done: 0, total: 0, msg: 'รูปสินค้าทุกรูปมีรูปย่อครบแล้ว' });
      let ok = 0;
      for (const [i, url] of urls.entries()) {
        setThumbs({ busy: true, done: i, total: urls.length, msg: '' });
        try {
          await api.saveUploadVariants(url, await makeVariants(imageSrc(url)));
          ok++;
        } catch {
          /* ข้ามรูปที่เสีย */
        }
      }
      setThumbs({ busy: false, done: ok, total: urls.length, msg: `สร้างรูปย่อแล้ว ${ok} จาก ${urls.length} รูป` });
    } catch (e) {
      setThumbs({ busy: false, done: 0, total: 0, msg: (e as Error).message });
    }
  };

  const qualityHint = {
    high: 'คมชัดที่สุด (รูปเต็ม ~900px) — เหมาะกับเน็ตเร็ว/จอใหญ่',
    medium: 'สมดุล (~480px) — ชัดพอสำหรับการ์ดสินค้า โหลดเร็วกว่าเกือบ 3 เท่า',
    low: 'เร็วที่สุด (~240px) — เหมาะกับเน็ตมือถือ/เครื่องรุ่นเก่า รูปอาจไม่คมบนจอใหญ่',
  }[v.imageQuality];

  return (
    <>
      <Card title="มุมมองหน้าขาย">
        <Grid max={3}>
        <Field label="มุมมองสินค้าเริ่มต้น" hint="ทุกเครื่องจะเปลี่ยนตามเมื่อบันทึก (พนักงานยังสลับเองได้ที่หน้าขาย)">
          <Seg value={v.defaultView} options={[[5, '5×5'], [4, '4×4'], [3, '3×3']]} onChange={(x) => set({ defaultView: x as 3 | 4 | 5 })} />
        </Field>
        <Field label="ประเภทการขายเริ่มต้น">
          <Seg value={v.defaultOrderType} options={[['หน้าร้าน', 'หน้าร้าน'], ['ออนไลน์ (รับที่ร้าน)', 'ออนไลน์ (รับที่ร้าน)'], ['จัดส่ง', 'จัดส่ง']]} onChange={(x) => set({ defaultOrderType: String(x) })} />
        </Field>
        </Grid>
      </Card>

      <Card title="รูปสินค้าและการ์ดสินค้า">
        <View style={[s.row, { gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }]}>
          <View style={{ flex: 1, minWidth: 260, gap: 12 }}>
            <Grid max={3}>
            <Field label="รูปทรงกรอบรูป">
              <View style={s.seg}>
                {([['square', 'จัตุรัส 1:1'], ['portrait', 'แนวตั้ง 3:4'], ['landscape', 'แนวนอน 4:3']] as [ImageShape, string][]).map(([k, l]) => {
                  const on = v.imageShape === k;
                  return (
                    <Pressable key={k} onPress={() => set({ imageShape: k })} style={[s.segItem, on && s.segOn, { flexDirection: 'row', gap: 6, alignItems: 'center' }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                      <ShapeIcon shape={k} on={on} />
                      <Text style={[s.segText, on && { color: '#fff', fontWeight: '600' }]}>{l}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>
            <Field label="การจัดรูปในกรอบ" hint={v.imageFit === 'cover' ? 'เต็มกรอบ: รูปเต็มพื้นที่ ขอบรูปบางส่วนอาจถูกตัด' : 'พอดีกรอบ: เห็นรูปครบทั้งภาพ คงสัดส่วนเดิม อาจมีขอบว่าง'}>
              <Seg value={v.imageFit} options={[['cover', 'เต็มกรอบ'], ['contain', 'พอดีกรอบ (เห็นทั้งรูป)']]} onChange={(x) => set({ imageFit: x as 'cover' | 'contain' })} />
            </Field>
            <Field label="คุณภาพรูป" hint={qualityHint}>
              <Seg value={v.imageQuality} options={[['high', 'ชัด'], ['medium', 'ปานกลาง'], ['low', 'ต่ำ (เร็ว)']]} onChange={(x) => set({ imageQuality: x as AdminSettings['display']['imageQuality'] })} />
            </Field>
            <Field label="ขนาดตัวอักษรบนการ์ด">
              <Seg value={v.fontSize} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => set({ fontSize: x as AdminSettings['display']['fontSize'] })} />
            </Field>
            <Field label="ขนาดวงกลมสี" hint="ใหญ่ขึ้น = กดง่ายบนแท็บเล็ต/มือถือ">
              <Seg value={v.swatchSize} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => set({ swatchSize: x as AdminSettings['display']['swatchSize'] })} />
            </Field>
            <Field label="ขนาดปุ่มไซซ์ / ตัวเลือก" hint="ปุ่มใหญ่อาจขึ้นบรรทัดใหม่เมื่อการ์ดแคบ (เช่นมุมมอง 5×5)">
              <Seg value={v.optionSize} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => set({ optionSize: x as AdminSettings['display']['optionSize'] })} />
            </Field>
            </Grid>
            <Grid max={3}>
            <Toggle label="แสดงรูปสินค้า" hint="ปิด = ใช้ไอคอนเสื้อผ้าแทน (โหลดเร็วที่สุด)" value={v.showImages} onChange={(x) => set({ showImages: x })} />
            <Toggle label="แสดงรหัสสินค้า (SKU)" hint="ใต้ชื่อสินค้า — เปลี่ยนตามสี/ไซซ์ที่เลือก" value={v.showSku} onChange={(x) => set({ showSku: x })} />
            <Toggle label="แสดงป้ายหมวดหมู่บนรูป" value={v.showCategoryTag} onChange={(x) => set({ showCategoryTag: x })} />
            <Toggle label="แสดงจำนวนคงเหลือบนการ์ดสินค้า" hint="ปิด = แสดงแค่ “พร้อมขาย” (ไม่ให้ลูกค้าเห็นจำนวน)" value={v.showStock} onChange={(x) => set({ showStock: x })} />
            <Toggle label="ซ่อนสินค้าที่หมดทุกตัวเลือก" hint="สินค้าที่สต็อกรวมเป็น 0 จะไม่แสดงในหน้าขาย" value={v.hideOutOfStock} onChange={(x) => set({ hideOutOfStock: x })} />
            </Grid>
          </View>
          <View style={{ width: 210, gap: 6 }}>
            <Text style={s.label}>ตัวอย่างการ์ด</Text>
            <ProductCard
              product={PREVIEW_PRODUCT} categoryName="เสื้อยืด & โปโล" variants={PREVIEW_VARIANTS} cartQty={new Map()}
              width={210} onAdd={() => undefined} onOpen={() => undefined} display={v}
            />
            <Text style={s.hint}>ตัวอย่างใช้ไอคอนแทนรูปจริง — รูปทรงกรอบ ตัวอักษร และข้อมูลที่แสดงตรงกับหน้าขาย</Text>
          </View>
        </View>
        <View style={[s.row, { gap: 10, flexWrap: 'wrap', marginTop: 6 }]}>
          <SmallBtn label="สร้างรูปย่อให้รูปเดิม" icon="images-outline" onPress={makeThumbs} busy={thumbs.busy} />
          <Text style={[s.hint, { flex: 1, minWidth: 200 }]}>
            {thumbs.busy && thumbs.total ? `กำลังย่อรูป ${thumbs.done + 1} / ${thumbs.total}…` : thumbs.msg || 'รูปที่อัปโหลดก่อนหน้านี้ยังไม่มีรูปขนาดกลาง/เล็ก กดครั้งเดียวเพื่อให้ตั้งค่าคุณภาพรูปมีผลกับทุกรูป (รูปใหม่สร้างให้อัตโนมัติ)'}
          </Text>
        </View>
      </Card>

      <Card title="ตะกร้าและการสแกน">
        <Grid max={3}>
        <Toggle label="แสดงรูปสินค้าในตะกร้า" hint="ใช้รูปขนาดเล็กเสมอ ไม่กระทบความเร็ว" value={v.cartImages} onChange={(x) => set({ cartImages: x })} />
        <Toggle label="เสียงบี๊บเมื่อสแกนบาร์โค้ด" hint="เสียงสูง = เจอสินค้า · เสียงต่ำ = ไม่พบรหัส" value={v.scanBeep} onChange={(x) => set({ scanBeep: x })} />
        </Grid>
      </Card>
    </>
  );
}

function StockSection({ v, set, openBranches }: { v: AdminSettings['stock']; set: Upd<AdminSettings['stock']>; openBranches: () => void }) {
  const example = `TS-001${v.skuSeparator}${'1'.padStart(v.skuDigits, '0')}`;
  return (
    <>
      <Card title="สต็อก">
        <Grid>
          <Field label="จุดแจ้งเตือนเหลือน้อย (ค่าเริ่มต้นของสินค้าใหม่)" hint="ชิ้นต่อ SKU · ปรับรายสินค้าได้ในหน้าแก้ไขสินค้า">
            <Input value={String(v.lowStockDefault)} onChange={(t) => set({ lowStockDefault: Number(t.replace(/[^0-9]/g, '') || 0) })} keyboard="number-pad" max={4} />
          </Field>
          <Field label="รูปแบบรหัส SKU อัตโนมัติ" hint={`ตัวอย่าง: ${example}`}>
            <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
              <Seg value={v.skuSeparator} options={[['-', 'ขีด -'], ['', 'ไม่มี'], ['.', 'จุด .'], ['_', '_']]} onChange={(x) => set({ skuSeparator: x as AdminSettings['stock']['skuSeparator'] })} />
              <Seg value={v.skuDigits} options={[[3, '3 หลัก'], [4, '4 หลัก'], [5, '5 หลัก'], [6, '6 หลัก']]} onChange={(x) => set({ skuDigits: Number(x) })} />
            </View>
          </Field>
        </Grid>
        <Toggle
          label="ขายได้แม้สต็อกหมด (สต็อกติดลบได้)"
          hint={v.allowNegative
            ? 'เปิดอยู่: ขายสินค้าที่สต็อกเป็น 0 ได้ ยอดจะติดลบไปเรื่อย ๆ · เมื่อเพิ่มสต็อกด้วยคำสั่งพิเศษ ระบบหักกับยอดติดลบให้ เช่น เหลือ −8 เพิ่ม 10 → เหลือ 2'
            : 'ปิดอยู่: ขายได้ไม่เกินจำนวนในสต็อก (สินค้าที่เหลือ 0 จะขายไม่ได้)'}
          value={v.allowNegative}
          onChange={(x) => set({ allowNegative: x })}
        />
      </Card>
      <Text style={s.sub}>
        การเพิ่มสาขาและเชื่อมข้อมูลสินค้าหลายร้าน อยู่ที่เมนู <Text style={s.link} onPress={openBranches}>สาขา</Text>
      </Text>
    </>
  );
}

/** สาขาหลัก: รายชื่อสาขาย่อย + ปุ่มเพิ่มสาขา (สร้าง key เชื่อมสาขาให้อัตโนมัติ) */
function PaymentsSection({ v, set }: { v: AdminSettings['payments']; set: Upd<AdminSettings['payments']> }) {
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
        {v.methods.map((m, i) => (
          <View key={m.id} style={[s.payRow, !m.enabled && { opacity: 0.55 }]}>
            <View style={[s.row, { gap: 10 }]}>
              <Icon name={ICON[m.id]} size={22} color={colors.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Input value={m.label} onChange={(t) => upd(m.id, { label: t })} max={40} />
              </View>
              <Pressable onPress={() => move(i, -1)} disabled={i === 0} style={s.arrow} accessibilityLabel={`เลื่อน ${m.label} ขึ้น`}>
                <Icon name="chevron-up" size={16} color={i === 0 ? colors.line : colors.text} />
              </Pressable>
              <Pressable onPress={() => move(i, 1)} disabled={i === v.methods.length - 1} style={s.arrow} accessibilityLabel={`เลื่อน ${m.label} ลง`}>
                <Icon name="chevron-down" size={16} color={i === v.methods.length - 1 ? colors.line : colors.text} />
              </Pressable>
              <Switch value={m.enabled} onChange={(x) => upd(m.id, { enabled: x })} label={`เปิดใช้ ${m.label}`} />
            </View>
            <View style={[s.row, { gap: 10, flexWrap: 'wrap', marginTop: 8 }]}>
              <Text style={s.sub}>ค่าธรรมเนียม</Text>
              <View style={s.unitBox}>
                <Input value={String(m.feePercent)} onChange={(t) => upd(m.id, { feePercent: Number(t.replace(/[^0-9.]/g, '')) || 0 })} keyboard="decimal-pad" max={5} compact />
                <Text style={s.unit}>%</Text>
              </View>
              <Text style={s.sub}>+</Text>
              <View style={s.unitBox}>
                <Input value={String(m.feeFixed)} onChange={(t) => upd(m.id, { feeFixed: Number(t.replace(/[^0-9.]/g, '')) || 0 })} keyboard="decimal-pad" max={6} compact />
                <Text style={s.unit}>บาท/บิล</Text>
              </View>
              {m.feePercent || m.feeFixed ? (
                <Text style={s.sub}>
                  เช่น สินค้า ฿1,000 → ค่าธรรมเนียม {baht((1000 * m.feePercent) / 100 + m.feeFixed)}
                  {v.feePayer === 'customer' ? ` · ลูกค้าจ่าย ${baht(1000 + (1000 * m.feePercent) / 100 + m.feeFixed)}` : ' (ร้านจ่าย)'}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </Card>
      <Card title="ภาษีมูลค่าเพิ่ม (VAT)">
        <Text style={s.sub}>เปิด/ปิด VAT ตั้งแยกแต่ละสาขา (เมนู สาขา → “จดทะเบียนภาษีมูลค่าเพิ่มหรือไม่?”) · อัตรา VAT ใช้ร่วมกันทุกสาขา</Text>
        {true ? (
          <Field label="อัตรา VAT (%)" hint="ราคาสินค้ารวม VAT แล้ว — ยอดที่ลูกค้าจ่ายไม่เปลี่ยน ระบบคำนวณ VAT ที่รวมอยู่ในราคาเพื่อแสดงในตะกร้า/ใบเสร็จ/รายงาน · บิลเก่าคงอัตราเดิม">
            <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
              <View style={s.unitBox}>
                <Input value={String(v.vat.rate)} onChange={(t) => set({ vat: { ...v.vat, rate: Number(t.replace(/[^0-9.]/g, '')) || 0 } })} keyboard="decimal-pad" max={5} compact />
                <Text style={s.unit}>%</Text>
              </View>
              <Seg value={v.vat.rate} options={[[7, '7%'], [10, '10%'], [0, '0%']]} onChange={(x) => set({ vat: { ...v.vat, rate: Number(x) } })} />
              <Text style={s.sub}>เช่น ยอด ฿1,070 → VAT {baht((1070 * v.vat.rate) / (100 + v.vat.rate))}</Text>
            </View>
          </Field>
        ) : null}
      </Card>
      <Card title="พร้อมเพย์">
        <Field label="หมายเลขพร้อมเพย์ของร้าน" hint="เบอร์มือถือ 10 หลัก หรือเลขบัตร/เลขผู้เสียภาษี 13 หลัก — แสดงในหน้าชำระเงิน">
          <Input value={v.promptpayId} onChange={(t) => set({ promptpayId: t.replace(/[^0-9]/g, '') })} keyboard="number-pad" max={15} placeholder="08xxxxxxxx" />
        </Field>
      </Card>
    </>
  );
}

function BarcodeSection({ v, set, stock, goStock, goLabels }: { v: AdminSettings['barcode']; set: Upd<AdminSettings['barcode']>; stock: AdminSettings['stock']; goStock: () => void; goLabels: () => void }) {
  const sample = v.symbology === 'ean13' ? '8850001234560' : `TS-001${stock.skuSeparator}${'1'.padStart(stock.skuDigits, '0')}`;
  return (
    <>
      <Card title="ประเภทบาร์โค้ด">
        <Seg value={v.symbology} options={[['code128', 'Code 128 (ตัวเลข+ตัวอักษร)'], ['ean13', 'EAN-13 (ตัวเลข 13 หลัก)']]} onChange={(x) => set({ symbology: x as 'code128' | 'ean13' })} />
        <Text style={s.sub}>
          Code 128 ใช้ได้กับทุกรหัส · EAN-13 ใช้กับรหัสตัวเลข 13 หลักที่ถูกต้อง (ถ้ารหัสไม่ใช่ EAN-13 ระบบจะแสดงเป็น Code 128 ให้อัตโนมัติ) · เครื่องสแกนทั่วไปอ่านได้ทั้งสองแบบ
        </Text>
        <View style={s.preview}>
          <Barcode value={sample} />
        </View>
      </Card>
      <Card title="สร้างบาร์โค้ดอัตโนมัติ (สำหรับ SKU ใหม่)">
        <Seg value={v.autoAssign} options={[['none', 'ไม่สร้าง (กำหนดเอง)'], ['sku', 'ใช้รหัส SKU'], ['ean13', 'สุ่ม EAN-13']]} onChange={(x) => set({ autoAssign: x as 'none' | 'sku' | 'ean13' })} />
        {v.autoAssign === 'ean13' ? (
          <Field label="ตัวเลขนำหน้า EAN-13" hint="รหัสใช้ภายในร้านควรขึ้นต้นด้วย 2 (ไม่ชนกับบาร์โค้ดสินค้าจากโรงงาน)">
            <Input value={v.ean13Prefix} onChange={(t) => set({ ean13Prefix: t.replace(/[^0-9]/g, '') })} keyboard="number-pad" max={6} />
          </Field>
        ) : null}
        <Text style={s.sub}>
          รูปแบบรหัส SKU (ตัวคั่น/จำนวนหลัก) ตั้งได้ที่ <Text style={s.link} onPress={goStock}>สต็อก & เชื่อมสาขา</Text>
        </Text>
      </Card>
      <Pressable style={({ hovered }: { hovered?: boolean }) => [s.linkCard, hovered && { backgroundColor: '#E3EBFF' }]} onPress={goLabels} accessibilityRole="link">
        <Icon name="pricetags-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.linkTitle}>กระดาษบาร์โค้ด (ป้ายติดสินค้า)</Text>
          <Text style={s.hint}>ขนาดสติ๊กเกอร์ · ดวงต่อแถว · ขนาดบาร์โค้ด · ชื่อ/ราคา/รหัสบนป้าย · หลายโปรไฟล์</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={colors.primary} />
      </Pressable>
    </>
  );
}

function ReceiptSection({ v, shop, vat, set, goPrinter }: { v: AdminSettings['receipt']; shop: AdminSettings['shop']; vat: AdminSettings['payments']['vat']; set: Upd<AdminSettings['receipt']>; goPrinter: () => void }) {
  const fs = v.fontSize === 'small' ? 11 : v.fontSize === 'large' ? 14 : 12;
  const { t, pay, date } = receiptText(v);
  const [showLabels, setShowLabels] = useState(false);
  const paperPx = v.paperWidth === 58 ? 210 : 290;
  const blocks = v.footerBlocks;
  const setBlock = (i: number, x: Partial<FooterBlock>) => set({ footerBlocks: blocks.map((b, j) => (j === i ? { ...b, ...x } : b)) });
  const moveBlock = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    set({ footerBlocks: next });
  };
  const addBlock = (type: FooterBlock['type']) =>
    set({
      footerBlocks: [
        ...blocks,
        type === 'qr'
          ? { type, text: 'https://', caption: v.language === 'th' ? 'สแกนเพื่อเข้าเว็บไซต์' : 'Scan for website', size: 'small', align: 'center', bold: false, width: 45 }
          : type === 'image'
            ? { type, text: '', caption: '', size: 'small', align: 'center', bold: false, width: 60 }
            : { type, text: '', caption: '', size: 'small', align: 'center', bold: false, width: 60 },
      ],
    });
  const P = ({ children, size = fs, bold, center, color }: { children: ReactNode; size?: number; bold?: boolean; center?: boolean; color?: string }) => (
    <Text style={[s.pText, { fontSize: size }, bold && { fontWeight: '700' }, center && s.pc, color ? { color } : null]}>{children}</Text>
  );
  const PRow = ({ l, r, size = fs, bold }: { l: string; r: string; size?: number; bold?: boolean }) => (
    <View style={s.pRow}>
      <View style={{ flex: 1 }}><P size={size} bold={bold}>{l}</P></View>
      <P size={size} bold={bold}>{r}</P>
    </View>
  );
  const vatAmt = (580 * vat.rate) / (100 + vat.rate);
  const preview = (
    <View style={[s.paper, { width: paperPx }]}>
      {v.logoUrl ? (
        <View style={{ alignItems: 'center', marginBottom: 2 }}>
          <AutoImage uri={imageSrc(v.logoUrl)} width={(paperPx - 24) * (v.logoWidth / 100)} />
        </View>
      ) : null}
      {!v.logoUrl || v.showShopName ? <P size={fs + 4} bold center>{v.shopName.trim() || shop.name}</P> : null}
      {shop.branchName ? <P center>{shop.branchName}</P> : null}
      {shop.address ? <P size={fs - 1} center>{shop.address}</P> : null}
      {shop.phone ? <P size={fs - 1} center>{t('tel')} {shop.phone}</P> : null}
      {shop.taxId ? <P size={fs - 1} center>{t('taxId')} {shop.taxId}</P> : null}
      {v.header ? <P center>{v.header}</P> : null}
      {v.title ? <P bold center>{v.title}</P> : null}
      <View style={s.dash} />
      <P>{t('orderNo')}: INV-261011-0001</P>
      <P>{t('date')}: {date(new Date())}</P>
      {v.showCustomer ? <P>{t('customer')}: คุณสมใจ</P> : null}
      {v.showSalesperson ? <P>{t('staff')}: มายด์</P> : null}
      <View style={s.dash} />
      <View style={[s.pRow, { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#000', paddingBottom: 3, marginBottom: 3 }]}>
        <View style={{ flex: 1 }}><P bold>{t('colItem')}</P></View>
        <View style={{ width: 44, alignItems: 'center' }}><P bold>{t('colQty')}</P></View>
        <P bold>{t('colAmount')}</P>
      </View>
      <View style={s.pRow}>
        <View style={{ flex: 1 }}>
          <P>เสื้อยืดคอกลม Cotton</P>
          <P size={fs - 1} color="#555">ดำ / M{v.showSku ? ' · TS-001-0002' : ''} · @290.00</P>
        </View>
        <View style={{ width: 44, alignItems: 'center' }}><P>2</P></View>
        <P>580.00</P>
      </View>
      <View style={s.dash} />
      <PRow l={t('subtotal')} r="580.00" />
      <PRow l={t('total')} r="580.00" size={fs + 3} bold />
      {v.showVat && vat.enabled && vat.rate > 0 ? <PRow l={`VAT ${vat.rate}% ${t('vatIncluded')}`} r={vatAmt.toFixed(2)} size={fs - 1} /> : null}
      <PRow l={`${t('paidBy')} ${pay('cash')}`} r="600.00" />
      <PRow l={t('change')} r="20.00" />
      <View style={s.dash} />
      {v.footer ? <P center>{v.footer}</P> : null}
      {v.footerBlocks.map((b, i) => {
        const bs = b.size === 'small' ? fs - 1 : b.size === 'large' ? fs + 3 : fs;
        const ai = b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center';
        const w = (paperPx - 24) * (b.width / 100);
        const cap = b.caption.trim() ? <Text style={[s.pText, { fontSize: bs, textAlign: b.align }, b.bold && { fontWeight: '700' }]}>{b.caption}</Text> : null;
        return (
          <View key={i} style={{ alignItems: ai, marginTop: 6, gap: 2 }}>
            {b.type === 'text' ? <Text style={[s.pText, { fontSize: bs, textAlign: b.align, alignSelf: 'stretch' }, b.bold && { fontWeight: '700' }]}>{b.text}</Text> : null}
            {b.type === 'qr' ? <>{cap}<QrView value={b.text} size={w} /></> : null}
            {b.type === 'image' ? <>{b.text ? <AutoImage uri={imageSrc(b.text)} width={w} /> : null}{cap}</> : null}
          </View>
        );
      })}
      {v.showOrderBarcode ? <Barcode value="INV-261011-0001" height={32} maxWidth={v.paperWidth === 58 ? 180 : 240} /> : null}
    </View>
  );
  // เปลี่ยนภาษา: หัวเรื่อง/ท้ายบิลที่ยังเป็นค่าเริ่มต้น → เปลี่ยนตามภาษาให้ด้วย
  const setLang = (lang: ReceiptLang) => {
    const defs = Object.values(RECEIPT_DEFAULT_TEXT);
    const next: Partial<AdminSettings['receipt']> = { language: lang };
    if (!v.title.trim() || defs.some((d) => d.title === v.title)) next.title = RECEIPT_DEFAULT_TEXT[lang].title;
    if (!v.footer.trim() || defs.some((d) => d.footer === v.footer)) next.footer = RECEIPT_DEFAULT_TEXT[lang].footer;
    set(next);
  };
  const ownCount = Object.values(v.labels).filter((x) => x.trim()).length;
  return (
    <View style={[{ gap: 12 }, Platform.OS === 'web' && { flexDirection: 'row', flexWrap: 'wrap' }]}>
      <View style={{ flex: 1, minWidth: 300, gap: 12 }}>
        <Pressable style={({ hovered }: { hovered?: boolean }) => [s.linkCard, hovered && { backgroundColor: '#E3EBFF' }]} onPress={goPrinter} accessibilityRole="link">
          <Icon name="print-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.linkTitle}>ตั้งค่าเครื่องพิมพ์ใบเสร็จ</Text>
            <Text style={s.hint}>เลือกเครื่องพิมพ์ของคอมพิวเตอร์เครื่องนี้ · USB / LAN · ตัดกระดาษ · ลิ้นชักเงิน · พิมพ์ทดสอบ</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
        <Card title="ภาษาของใบเสร็จ">
          <Seg value={v.language} options={[['th', 'ไทย'], ['en', 'English'], ['both', 'ไทย + English']]} onChange={(x) => setLang(x as ReceiptLang)} />
          <Text style={s.hint}>
            เปลี่ยนคำในบิลทั้งหมด (เลขที่ วันที่ ยอดสุทธิ เงินทอน วิธีชำระ ฯลฯ) และรูปแบบวันที่ · หัวเรื่อง/ข้อความท้ายบิลที่ยังเป็นค่าเริ่มต้นจะเปลี่ยนตามให้ ·
            ชื่อสินค้า สี/ไซซ์ และที่อยู่สาขา แสดงตามที่บันทึกไว้
          </Text>
        </Card>
        <Card title="กระดาษ & ตัวอักษร">
          <Field label="ขนาดกระดาษ"><Seg value={v.paperWidth} options={[[58, '58 มม.'], [80, '80 มม.']]} onChange={(x) => set({ paperWidth: x as 58 | 80 })} /></Field>
          <Field label="ขนาดตัวอักษร"><Seg value={v.fontSize} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => set({ fontSize: x as 'small' | 'medium' | 'large' })} /></Field>
          <Field label="จำนวนสำเนาต่อการพิมพ์"><Seg value={v.copies} options={[[1, '1 ใบ'], [2, '2 ใบ'], [3, '3 ใบ']]} onChange={(x) => set({ copies: Number(x) })} /></Field>
        </Card>
        <Card title="ข้อความ">
          <Field label="ชื่อร้านบนใบเสร็จ" hint={`เว้นว่าง = ใช้ชื่อร้าน "${shop.name}" · ใส่ชื่อภาษาอังกฤษได้ เช่น ABC Clothing`}>
            <Input value={v.shopName} onChange={(x) => set({ shopName: x })} placeholder={shop.name} max={80} />
          </Field>
          <Field label="หัวเรื่อง"><Input value={v.title} onChange={(x) => set({ title: x })} max={80} /></Field>
          <Field label="ข้อความหัวใบเสร็จ" hint="เช่น โปรโมชั่น หรือ Line/IG ร้าน"><Input value={v.header} onChange={(x) => set({ header: x })} max={500} multiline /></Field>
          <Field label="ข้อความท้ายใบเสร็จ" hint="เช่น เงื่อนไขการเปลี่ยนสินค้า"><Input value={v.footer} onChange={(x) => set({ footer: x })} max={500} multiline /></Field>
        </Card>
        <Card title="โลโก้หัวบิล">
          <View style={[s.row, { gap: 12, flexWrap: 'wrap' }]}>
            <View style={[s.logoBox]}>
              {v.logoUrl ? <AutoImage uri={imageSrc(v.logoUrl)} width={110} maxHeight={64} /> : <Icon name="image-outline" size={26} color={colors.faint} />}
            </View>
            <View style={{ gap: 8 }}>
              <View style={s.row}>
                <UploadBtn label={v.logoUrl ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'} onDone={(url) => set({ logoUrl: url })} />
                {v.logoUrl ? <SmallBtn label="ลบ" icon="trash-outline" onPress={() => set({ logoUrl: '' })} /> : null}
              </View>
              <Text style={s.hint}>JPG / PNG · แนะนำโลโก้พื้นขาว ตัวอักษรดำ (เครื่องพิมพ์ความร้อนพิมพ์เป็นขาว-ดำ)</Text>
            </View>
          </View>
          {v.logoUrl ? (
            <>
              <Field label={`ขนาดโลโก้ ${v.logoWidth}% ของความกว้างกระดาษ`}>
                <Stepper value={v.logoWidth} min={15} max={100} step={5} presets={[30, 45, 60, 80, 100]} onChange={(x) => set({ logoWidth: x })} />
              </Field>
              <Toggle label="แสดงชื่อร้านใต้โลโก้" hint="ปิดได้ถ้าโลโก้มีชื่อร้านอยู่แล้ว" value={v.showShopName} onChange={(x) => set({ showShopName: x })} />
            </>
          ) : null}
        </Card>
        <Card title="ส่วนท้ายบิล (เพิ่มเอง)">
          <Text style={s.hint}>ต่อจาก “ข้อความท้ายใบเสร็จ” · เพิ่มข้อความ, QR code (เว็บไซต์ / LINE OA / IG) หรือรูปภาพ · เรียงลำดับได้ สูงสุด 12 ส่วน</Text>
          {blocks.map((b, i) => (
            <View key={i} style={s.blockBox}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <View style={s.row}>
                  <Icon name={b.type === 'qr' ? 'qr-code-outline' : b.type === 'image' ? 'image-outline' : 'text-outline'} size={16} color={colors.primary} />
                  <Text style={s.b}>{i + 1}. {b.type === 'qr' ? 'QR code' : b.type === 'image' ? 'รูปภาพ' : 'ข้อความ'}</Text>
                </View>
                <View style={s.row}>
                  <Pressable onPress={() => moveBlock(i, -1)} style={s.arrow} disabled={i === 0} accessibilityLabel="เลื่อนขึ้น"><Icon name="chevron-up" size={16} color={i === 0 ? colors.line : colors.text} /></Pressable>
                  <Pressable onPress={() => moveBlock(i, 1)} style={s.arrow} disabled={i === blocks.length - 1} accessibilityLabel="เลื่อนลง"><Icon name="chevron-down" size={16} color={i === blocks.length - 1 ? colors.line : colors.text} /></Pressable>
                  <Pressable onPress={() => set({ footerBlocks: blocks.filter((_, j) => j !== i) })} style={s.arrow} accessibilityLabel="ลบส่วนนี้"><Icon name="trash-outline" size={15} color={colors.danger} /></Pressable>
                </View>
              </View>
              {b.type === 'text' ? (
                <Input value={b.text} onChange={(x) => setBlock(i, { text: x })} placeholder="เช่น Thank you for supporting us! ติดตามเราได้ที่ IG @shop" max={1000} multiline />
              ) : null}
              {b.type === 'qr' ? (
                <>
                  <Field label="ลิงก์หรือข้อความใน QR"><Input value={b.text} onChange={(x) => setBlock(i, { text: x.trim() })} placeholder="https://www.yourshop.com" max={500} /></Field>
                  <Field label="ข้อความเหนือ QR"><Input value={b.caption} onChange={(x) => setBlock(i, { caption: x })} placeholder="เช่น Scan for website" max={200} /></Field>
                </>
              ) : null}
              {b.type === 'image' ? (
                <>
                  <View style={[s.row, { flexWrap: 'wrap' }]}>
                    {b.text ? <AutoImage uri={imageSrc(b.text)} width={80} maxHeight={60} /> : null}
                    <UploadBtn label={b.text ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'} onDone={(url) => setBlock(i, { text: url })} />
                  </View>
                  <Field label="ข้อความใต้รูป"><Input value={b.caption} onChange={(x) => setBlock(i, { caption: x })} placeholder="ไม่บังคับ" max={200} /></Field>
                </>
              ) : null}
              <View style={[s.row, { flexWrap: 'wrap', gap: 10 }]}>
                <Seg value={b.align} options={[['left', 'ชิดซ้าย'], ['center', 'กึ่งกลาง'], ['right', 'ชิดขวา']]} onChange={(x) => setBlock(i, { align: x as FooterBlock['align'] })} />
                <Seg value={b.size} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => setBlock(i, { size: x as FooterBlock['size'] })} />
                <Pressable style={s.row} onPress={() => setBlock(i, { bold: !b.bold })}>
                  <Icon name={b.bold ? 'checkbox' : 'square-outline'} size={18} color={b.bold ? colors.primary : colors.faint} />
                  <Text style={s.hint}>ตัวหนา</Text>
                </Pressable>
              </View>
              {b.type !== 'text' ? (
                <Field label={`ขนาด ${b.width}% ของความกว้างกระดาษ`}>
                  <Stepper value={b.width} min={15} max={100} step={5} presets={b.type === 'qr' ? [30, 40, 50, 65] : [40, 60, 80, 100]} onChange={(x) => setBlock(i, { width: x })} />
                </Field>
              ) : null}
            </View>
          ))}
          {blocks.length < 12 ? (
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              <SmallBtn label="ข้อความ" icon="add" onPress={() => addBlock('text')} />
              <SmallBtn label="QR code" icon="qr-code-outline" onPress={() => addBlock('qr')} />
              <SmallBtn label="รูปภาพ" icon="image-outline" onPress={() => addBlock('image')} />
            </View>
          ) : null}
        </Card>
        <Card title="แก้ไขคำในบิล">
          <Pressable style={[s.row, { justifyContent: 'space-between' }]} onPress={() => setShowLabels((o) => !o)}>
            <Text style={[s.sub, { flex: 1 }]}>
              แก้ทุกคำที่พิมพ์ในบิลได้เอง ช่องที่เว้นว่างใช้คำตามภาษาที่เลือก{ownCount ? ` · แก้เองแล้ว ${ownCount} คำ` : ''}
            </Text>
            <SmallBtn label={showLabels ? 'ซ่อน' : 'แก้ไขคำ'} icon={showLabels ? 'chevron-up' : 'create-outline'} onPress={() => setShowLabels((o) => !o)} />
          </Pressable>
          {showLabels ? (
            <>
              {RECEIPT_LABELS.map(([key, name]) => {
                const def = defaultLabel(key, v.language);
                const own = v.labels[key] ?? '';
                return (
                  <View key={key} style={s.labelRow}>
                    <Text style={[s.toggleLabel, { width: 150 }]} numberOfLines={2}>{name}</Text>
                    <View style={{ flex: 1, minWidth: 160 }}>
                      <Input value={own} onChange={(x) => set({ labels: { ...v.labels, [key]: x } })} placeholder={def || '(ใช้ชื่อในวิธีชำระเงิน)'} max={60} />
                    </View>
                    {own ? (
                      <Pressable onPress={() => { const l = { ...v.labels }; delete l[key]; set({ labels: l }); }} style={s.arrow} accessibilityLabel={`คืนค่า ${name}`}>
                        <Icon name="refresh-outline" size={15} color={colors.sub} />
                      </Pressable>
                    ) : <View style={{ width: 30 }} />}
                  </View>
                );
              })}
              <View style={[s.row, { justifyContent: 'flex-end' }]}>
                <SmallBtn label="คืนค่าเริ่มต้นทุกคำ" icon="refresh-outline" disabled={!ownCount} onPress={() => set({ labels: {} })} />
              </View>
            </>
          ) : null}
        </Card>
        <Card title="ข้อมูลที่แสดง">
          <Toggle label="ชื่อลูกค้า" value={v.showCustomer} onChange={(x) => set({ showCustomer: x })} />
          <Toggle label="พนักงานขาย" value={v.showSalesperson} onChange={(x) => set({ showSalesperson: x })} />
          <Toggle label="รหัส SKU ของสินค้า" value={v.showSku} onChange={(x) => set({ showSku: x })} />
          <Toggle label="บรรทัด VAT" hint="อัตรา VAT ตั้งที่ วิธีชำระเงิน & ค่าธรรมเนียม" value={v.showVat} onChange={(x) => set({ showVat: x })} />
          <Toggle label="บาร์โค้ดเลขที่บิล" hint="สแกนเพื่อค้นหาบิลในหน้าประวัติการขาย" value={v.showOrderBarcode} onChange={(x) => set({ showOrderBarcode: x })} />
          <Toggle label="พิมพ์อัตโนมัติหลังขาย" hint="ต้องอนุญาตป๊อปอัปในเบราว์เซอร์" value={v.autoPrint} onChange={(x) => set({ autoPrint: x })} />
        </Card>
      </View>
      <View style={[{ alignItems: 'center', gap: 6, minWidth: 300 }, Platform.OS === 'web' && ({ position: 'sticky', top: 0, alignSelf: 'flex-start' } as object)]}>
        <Text style={s.sub}>ตัวอย่างใบเสร็จ</Text>
        {preview}
      </View>
    </View>
  );
}

// ======================= การแจ้งเตือน & API =======================
type NotifyTab = 'channels' | 'events' | 'design' | 'api';
const NOTIFY_TABS: { id: NotifyTab; label: string; icon: IconName }[] = [
  { id: 'channels', label: 'ช่องทาง', icon: 'git-network-outline' },
  { id: 'events', label: 'เหตุการณ์', icon: 'notifications-outline' },
  { id: 'design', label: 'ออกแบบการ์ด LINE', icon: 'color-palette-outline' },
  { id: 'api', label: 'API key', icon: 'key-outline' },
];
const EMOJIS = ['🛍️', '💰', '🧾', '🚫', '✏️', '📦', '⛔', '🔓', '🔒', '💵', '📊', '🎉', '⚠️', '✅', '🔔', '⭐'];
const SWATCHES = ['#2F6BFF', '#06C755', '#1F9D63', '#0E9AA7', '#6B4EFF', '#D23B7E', '#E5484D', '#C62828', '#D98200', '#F5A524', '#1B1F27', '#64748B'];
type FocusField = { f: 'title' | 'subtitle' | 'footer' | 'itemsTitle' } | { f: 'label' | 'value'; i: number };

function NotifySection({ v, set, dirty, notify, keys, setKeys, apiEnabled, setApiEnabled }: {
  v: AdminSettings['notify']; set: Upd<AdminSettings['notify']>; dirty: boolean; notify: Notify;
  keys: ApiKeyRow[]; setKeys: (k: ApiKeyRow[]) => void; apiEnabled: boolean; setApiEnabled: (x: boolean) => Promise<void>;
}) {
  const [tab, setTab] = useState<NotifyTab>(() => {
    try {
      const t = globalThis.localStorage?.getItem('pos.notifyTab') as NotifyTab | null;
      return t && NOTIFY_TABS.some((x) => x.id === t) ? t : 'channels';
    } catch {
      return 'channels';
    }
  });
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem('pos.notifyTab', tab);
    } catch {
      /* ignore */
    }
  }, [tab]);
  const [catalog, setCatalog] = useState<NotifyEventInfo[]>([]);
  useEffect(() => {
    api.notifyCatalog().then(setCatalog).catch((e) => notify('error', (e as Error).message));
  }, [notify]);

  const [testing, setTesting] = useState<string | null>(null);
  const test = async (ch: 'line' | 'whatsapp' | 'webhook', event?: NotifyEventKey) => {
    if (dirty) return notify('info', 'กรุณากด “บันทึก” ก่อนทดสอบส่ง');
    setTesting(ch + (event ?? ''));
    try {
      const r = await api.testNotify(ch, event);
      notify(
        r.ok ? 'success' : 'error',
        r.ok ? (ch === 'webhook' ? `Webhook ตอบกลับ HTTP ${r.status}` : 'ส่งตัวอย่างแล้ว — ตรวจสอบในแอป') : `ส่งไม่สำเร็จ: ${r.body || `HTTP ${r.status}`}`,
      );
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const lineOn = v.line.enabled && !!v.line.token && !!v.line.to;
  const waOn = v.whatsapp.enabled && !!v.whatsapp.token && !!v.whatsapp.phoneNumberId && !!v.whatsapp.to;
  const hookOn = v.webhook.enabled && !!v.webhook.url;
  const activeEvents = catalog.filter((e) => v.events[e.key]?.on).length;

  return (
    <>
      <View style={s.summary}>
        <StatusPill icon="chatbubble-ellipses-outline" label="LINE" on={lineOn} />
        <StatusPill icon="logo-whatsapp" label="WhatsApp" on={waOn} />
        <StatusPill icon="flash-outline" label="Webhook" on={hookOn} />
        <StatusPill icon="key-outline" label={`API ${apiEnabled ? 'เปิด' : 'ปิด'}`} on={apiEnabled} />
        <Text style={[s.sub, { marginLeft: 'auto' }]}>แจ้งเตือน {activeEvents}/{catalog.length || 9} เหตุการณ์</Text>
      </View>
      <View style={s.tabs}>
        {NOTIFY_TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={[s.tab, on && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Icon name={t.icon} size={16} color={on ? colors.primary : colors.sub} />
              <Text style={[s.tabText, on && { color: colors.primary, fontWeight: '700' }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'channels' ? <ChannelsTab v={v} set={set} test={test} testing={testing} /> : null}
      {tab === 'events' ? <EventsTab v={v} set={set} catalog={catalog} lineOn={lineOn} waOn={waOn} hookOn={hookOn} goChannels={() => setTab('channels')} /> : null}
      {tab === 'design' ? <DesignTab v={v} set={set} catalog={catalog} test={test} testing={testing} lineOn={lineOn} /> : null}
      {tab === 'api' ? <ApiTab keys={keys} setKeys={setKeys} enabled={apiEnabled} setEnabled={setApiEnabled} notify={notify} /> : null}
    </>
  );
}

function StatusPill({ icon, label, on }: { icon: IconName; label: string; on: boolean }) {
  return (
    <View style={[s.pill, on ? { backgroundColor: colors.successSoft } : { backgroundColor: colors.surface }]}>
      <Icon name={icon} size={14} color={on ? colors.success : colors.faint} />
      <Text style={[s.pillText, { color: on ? colors.success : colors.sub }]}>{label}</Text>
      <View style={[s.dot, { width: 7, height: 7, backgroundColor: on ? colors.success : colors.line }]} />
    </View>
  );
}

type TestFn = (ch: 'line' | 'whatsapp' | 'webhook', event?: NotifyEventKey) => void;

function ChannelsTab({ v, set, test, testing }: { v: AdminSettings['notify']; set: Upd<AdminSettings['notify']>; test: TestFn; testing: string | null }) {
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

function ChannelChip({ label, value, onChange, ready }: { label: string; value: boolean; onChange: (x: boolean) => void; ready: boolean }) {
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

function EventsTab({ v, set, catalog, lineOn, waOn, hookOn, goChannels }: {
  v: AdminSettings['notify']; set: Upd<AdminSettings['notify']>; catalog: NotifyEventInfo[]; lineOn: boolean; waOn: boolean; hookOn: boolean; goChannels: () => void;
}) {
  const setEv = (k: NotifyEventKey, x: Partial<AdminSettings['notify']['events'][NotifyEventKey]>) => set({ events: { ...v.events, [k]: { ...v.events[k], ...x } } });
  const opt = v.options;
  const missing = [!lineOn && 'LINE', !waOn && 'WhatsApp', !hookOn && 'Webhook'].filter(Boolean) as string[];
  return (
    <Card title="แจ้งเตือนเมื่อ…">
      {missing.length ? (
        <Pressable onPress={goChannels} style={[s.infoBox, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          <Icon name="information-circle-outline" size={18} color={colors.sub} />
          <Text style={[s.sub, { flex: 1 }]}>ยังไม่ได้ตั้งค่า {missing.join(', ')} — ช่องทางที่ยังไม่ตั้งจะไม่ถูกส่ง (สีส้ม) · แตะเพื่อไปตั้งค่า</Text>
        </Pressable>
      ) : null}
      {catalog.map((e) => {
        const ev = v.events[e.key];
        if (!ev) return null;
        const tpl = v.templates[e.key];
        return (
          <View key={e.key} style={[s.evRow, !ev.on && { opacity: 0.6 }]}>
            <View style={[s.evIcon, { backgroundColor: (tpl?.color || v.style.color) + '1A' }]}>
              <Text style={{ fontSize: 18 }}>{tpl?.emoji || '🔔'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 180, gap: 6 }}>
              <View>
                <Text style={s.toggleLabel}>{e.label} <Text style={[s.hint, s.code]}>{e.name}</Text></Text>
                <Text style={s.hint}>{e.desc}</Text>
              </View>
              {ev.on ? (
                <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                  <ChannelChip label="LINE" value={ev.line} ready={lineOn} onChange={(x) => setEv(e.key, { line: x })} />
                  <ChannelChip label="WhatsApp" value={ev.whatsapp} ready={waOn} onChange={(x) => setEv(e.key, { whatsapp: x })} />
                  <ChannelChip label="Webhook" value={ev.webhook} ready={hookOn} onChange={(x) => setEv(e.key, { webhook: x })} />
                </View>
              ) : null}
              {ev.on && e.key === 'sale' ? (
                <View style={[s.row, { flexWrap: 'wrap' }]}>
                  <Text style={s.hint}>แจ้งเฉพาะบิลตั้งแต่</Text>
                  <Input compact value={String(opt.saleMin || '')} placeholder="0" onChange={(t) => set({ options: { ...opt, saleMin: Number(t.replace(/[^0-9]/g, '')) || 0 } })} keyboard="number-pad" max={8} />
                  <Text style={s.hint}>บาท (0 = ทุกบิล)</Text>
                </View>
              ) : null}
              {ev.on && e.key === 'shiftClose' ? (
                <Pressable style={[s.row, { alignSelf: 'flex-start' }]} onPress={() => set({ options: { ...opt, shiftMismatchOnly: !opt.shiftMismatchOnly } })}>
                  <Icon name={opt.shiftMismatchOnly ? 'checkbox' : 'square-outline'} size={18} color={opt.shiftMismatchOnly ? colors.primary : colors.faint} />
                  <Text style={s.hint}>แจ้งเฉพาะเมื่อเงินขาด/เกิน</Text>
                </Pressable>
              ) : null}
              {ev.on && e.key === 'daily' ? (
                <View style={[s.row, { flexWrap: 'wrap' }]}>
                  <Text style={s.hint}>ส่งทุกวันเวลา</Text>
                  <Input compact value={opt.dailyTime} placeholder="21:00" onChange={(t) => set({ options: { ...opt, dailyTime: t.replace(/[^0-9:]/g, '').slice(0, 5) } })} max={5} />
                  <Text style={s.hint}>น. (รูปแบบ 24 ชม. เช่น 21:30)</Text>
                </View>
              ) : null}
            </View>
            <Switch value={ev.on} onChange={(x) => setEv(e.key, { on: x })} label={e.label} />
          </View>
        );
      })}
    </Card>
  );
}

function DesignTab({ v, set, catalog, test, testing, lineOn }: {
  v: AdminSettings['notify']; set: Upd<AdminSettings['notify']>; catalog: NotifyEventInfo[]; test: TestFn; testing: string | null; lineOn: boolean;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 1250;
  const [key, setKey] = useState<NotifyEventKey>('sale');
  const [focus, setFocus] = useState<FocusField>({ f: 'title' });
  const info = catalog.find((e) => e.key === key);
  const tpl = v.templates[key];
  const st = v.style;
  if (!info || !tpl) return <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />;

  const setTpl = (x: Partial<typeof tpl>) => set({ templates: { ...v.templates, [key]: { ...tpl, ...x } } });
  const setStyle = (x: Partial<typeof st>) => set({ style: { ...st, ...x } });
  const setLine = (i: number, x: Partial<{ label: string; value: string }>) => setTpl({ lines: tpl.lines.map((l, j) => (j === i ? { ...l, ...x } : l)) });
  const moveLine = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= tpl.lines.length) return;
    const lines = [...tpl.lines];
    [lines[i], lines[j]] = [lines[j], lines[i]];
    setTpl({ lines });
  };
  const insert = (ph: string) => {
    const token = `{${ph}}`;
    if (focus.f === 'label' || focus.f === 'value') {
      const l = tpl.lines[focus.i];
      if (l) return setLine(focus.i, { [focus.f]: (l[focus.f] + token).slice(0, focus.f === 'label' ? 60 : 200) });
      return setTpl({ title: tpl.title + token });
    }
    setTpl({ [focus.f]: (tpl[focus.f] + token).slice(0, 160) } as Partial<typeof tpl>);
  };
  const vars = { ...info.sample, time: info.sample.time || '' };
  const focusName = focus.f === 'title' ? 'หัวเรื่อง' : focus.f === 'subtitle' ? 'บรรทัดรอง' : focus.f === 'footer' ? 'ท้ายการ์ด' : focus.f === 'itemsTitle' ? 'หัวข้อรายการ' : `บรรทัดที่ ${'i' in focus ? focus.i + 1 : ''}`;
  const isDefault = JSON.stringify(tpl) === JSON.stringify(info.defaultTemplate);

  const preview = (
    <View style={{ gap: 8 }}>
      <FlexCard tpl={tpl} style={st} vars={vars} items={info.hasItems ? info.sampleItems : []} />
      <Text style={[s.hint, { textAlign: 'center' }]}>ตัวอย่างด้วยข้อมูลสมมุติ · ข้อความจริงใช้ข้อมูลจากบิล/กะ/สินค้า</Text>
      <SmallBtn
        label={lineOn ? `ส่งตัวอย่าง “${info.label}” ไป LINE` : 'ตั้งค่า LINE ก่อนส่งตัวอย่าง'}
        icon="paper-plane-outline"
        busy={testing === 'line' + key}
        disabled={!lineOn}
        onPress={() => test('line', key)}
      />
    </View>
  );

  return (
    <>
      <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
        {catalog.map((e) => {
          const on = e.key === key;
          return (
            <Pressable key={e.key} onPress={() => { setKey(e.key); setFocus({ f: 'title' }); }} style={[s.evChip, on && s.evChipOn]}>
              <Text style={{ fontSize: 14 }}>{v.templates[e.key]?.emoji || '🔔'}</Text>
              <Text style={[s.chText, on && { color: '#fff', fontWeight: '700' }]}>{e.label}</Text>
              {!v.events[e.key]?.on ? <Text style={[s.hint, on && { color: '#DCE6FF' }]}>(ปิด)</Text> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={[{ gap: 12 }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <Card title={`ข้อความในการ์ด: ${info.label}`}>
            <View style={s.phBox}>
              <Text style={s.hint}>แตะตัวแปรเพื่อแทรกลงใน <Text style={{ fontWeight: '700', color: colors.primary }}>{focusName}</Text> (ช่องที่เลือกล่าสุด) — ตัวแปรจะถูกแทนด้วยข้อมูลจริงตอนส่ง</Text>
              <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                {info.placeholders.map(([k, label]) => (
                  <Pressable key={k} onPress={() => insert(k)} style={s.phChip} accessibilityLabel={`แทรก ${label}`}>
                    <Text style={s.phText}>{label}</Text>
                    <Text style={[s.code, { fontSize: 10, color: colors.sub }]}>{`{${k}}`}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Field label="ไอคอน (อีโมจิ)">
              <View style={[s.row, { flexWrap: 'wrap', gap: 4 }]}>
                <Input compact value={tpl.emoji} onChange={(t) => setTpl({ emoji: t })} max={8} />
                {EMOJIS.map((e) => (
                  <Pressable key={e} onPress={() => setTpl({ emoji: e })} style={[s.emoji, tpl.emoji === e && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}>
                    <Text style={{ fontSize: 16 }}>{e}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setTpl({ emoji: '' })} style={s.emoji}><Text style={s.hint}>ไม่มี</Text></Pressable>
              </View>
            </Field>
            <Grid>
              <Field label="หัวเรื่อง">
                <Input value={tpl.title} onChange={(t) => setTpl({ title: t })} onFocus={() => setFocus({ f: 'title' })} max={120} />
              </Field>
              <Field label="บรรทัดรอง (ใต้หัวเรื่อง)">
                <Input value={tpl.subtitle} onChange={(t) => setTpl({ subtitle: t })} onFocus={() => setFocus({ f: 'subtitle' })} placeholder="เว้นว่าง = ไม่แสดง" max={120} />
              </Field>
            </Grid>
            <Field label="สีหัวการ์ด" hint="“สีหลัก” = ใช้สีหลักของร้าน (ตั้งด้านล่าง)">
              <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                <Pressable onPress={() => setTpl({ color: '' })} style={[s.swatchAuto, !tpl.color && s.swatchOn]}>
                  <View style={[s.swatchDot, { backgroundColor: st.color }]} />
                  <Text style={s.hint}>สีหลัก</Text>
                </Pressable>
                {SWATCHES.map((c) => (
                  <Pressable key={c} onPress={() => setTpl({ color: c })} style={[s.swatch, { backgroundColor: c }, tpl.color === c && s.swatchOn]} accessibilityLabel={c} />
                ))}
                <ColorInput value={tpl.color} onChange={(c) => setTpl({ color: c })} />
              </View>
            </Field>

            <View style={{ gap: 6 }}>
              <Text style={s.label}>บรรทัดข้อมูล (ชื่อ : ค่า)</Text>
              {tpl.lines.map((l, i) => (
                <View key={i} style={s.lineEdit}>
                  <View style={{ width: 130, flexGrow: 1 }}>
                    <Input value={l.label} onChange={(t) => setLine(i, { label: t })} onFocus={() => setFocus({ f: 'label', i })} placeholder="ชื่อ" max={60} />
                  </View>
                  <View style={{ flex: 2, minWidth: 140 }}>
                    <Input value={l.value} onChange={(t) => setLine(i, { value: t })} onFocus={() => setFocus({ f: 'value', i })} placeholder="ค่า เช่น {total}" max={200} />
                  </View>
                  <View style={s.row}>
                    <Pressable onPress={() => moveLine(i, -1)} style={s.arrow} disabled={i === 0} accessibilityLabel="เลื่อนขึ้น"><Icon name="chevron-up" size={16} color={i === 0 ? colors.line : colors.text} /></Pressable>
                    <Pressable onPress={() => moveLine(i, 1)} style={s.arrow} disabled={i === tpl.lines.length - 1} accessibilityLabel="เลื่อนลง"><Icon name="chevron-down" size={16} color={i === tpl.lines.length - 1 ? colors.line : colors.text} /></Pressable>
                    <Pressable onPress={() => setTpl({ lines: tpl.lines.filter((_, j) => j !== i) })} style={s.arrow} accessibilityLabel="ลบบรรทัด"><Icon name="trash-outline" size={15} color={colors.danger} /></Pressable>
                  </View>
                </View>
              ))}
              {tpl.lines.length < 12 ? (
                <View style={[s.row, { justifyContent: 'flex-start' }]}>
                  <SmallBtn label="เพิ่มบรรทัด" icon="add" onPress={() => { setTpl({ lines: [...tpl.lines, { label: '', value: '' }] }); setFocus({ f: 'label', i: tpl.lines.length }); }} />
                </View>
              ) : null}
            </View>

            {info.hasItems ? (
              <View style={{ gap: 8 }}>
                <Toggle label="แสดงรายการ" hint={key === 'daily' ? 'ยอดขายแยกตามสาขา' : key === 'sale' ? 'สินค้าในบิล (สูงสุด 12 รายการ)' : 'รายการสินค้า/SKU'} value={tpl.showItems} onChange={(x) => setTpl({ showItems: x })} />
                {tpl.showItems ? (
                  <Field label="หัวข้อรายการ">
                    <Input value={tpl.itemsTitle} onChange={(t) => setTpl({ itemsTitle: t })} onFocus={() => setFocus({ f: 'itemsTitle' })} max={60} />
                  </Field>
                ) : null}
              </View>
            ) : null}
            <Field label="ข้อความท้ายการ์ด">
              <Input value={tpl.footer} onChange={(t) => setTpl({ footer: t })} onFocus={() => setFocus({ f: 'footer' })} placeholder="เว้นว่าง = ไม่แสดง" max={160} />
            </Field>
            <View style={[s.row, { justifyContent: 'flex-end' }]}>
              <SmallBtn label="คืนค่าเริ่มต้นของการ์ดนี้" icon="refresh-outline" disabled={isDefault} onPress={() => setTpl(structuredClone(info.defaultTemplate))} />
            </View>
          </Card>

          {!wide ? preview : null}

          <Card title="รูปแบบร่วมของทุกการ์ด">
            <Field label="สีหลักของร้าน">
              <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                {SWATCHES.map((c) => (
                  <Pressable key={c} onPress={() => setStyle({ color: c })} style={[s.swatch, { backgroundColor: c }, st.color === c && s.swatchOn]} accessibilityLabel={c} />
                ))}
                <ColorInput value={st.color} onChange={(c) => c && setStyle({ color: c })} />
              </View>
            </Field>
            <Field label="ขนาดการ์ด">
              <Seg value={st.size} options={[['kilo', 'เล็ก'], ['mega', 'กลาง'], ['giga', 'ใหญ่']]} onChange={(x) => setStyle({ size: x as 'kilo' | 'mega' | 'giga' })} />
            </Field>
            <Field label="โลโก้ร้าน (URL รูป https)" hint="รูปต้องเปิดได้จากอินเทอร์เน็ต เช่น ลิงก์รูปจาก Facebook/LINE OA หรือ https://<ngrok>/uploads/… · เว้นว่าง = ไม่แสดง">
              <Input value={st.logoUrl} onChange={(t) => setStyle({ logoUrl: t.trim() })} placeholder="https://…/logo.png" max={500} />
            </Field>
            <Grid>
              <Field label="ปุ่มท้ายการ์ด" hint="เว้นว่าง = ไม่มีปุ่ม">
                <Input value={st.buttonLabel} onChange={(t) => setStyle({ buttonLabel: t })} placeholder="เช่น เปิดระบบ POS" max={40} />
              </Field>
              <Field label="ลิงก์ของปุ่ม" hint="เช่น เว็บไซต์หรือ LINE OA ของร้าน">
                <Input value={st.buttonUrl} onChange={(t) => setStyle({ buttonUrl: t.trim() })} placeholder="https://" max={500} />
              </Field>
            </Grid>
          </Card>
        </View>
        {wide ? <View style={{ width: 400, gap: 8, position: 'sticky' as 'relative', top: 0 }}>{preview}</View> : null}
      </View>
    </>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  return (
    <View style={[s.row, { gap: 4 }]}>
      <View style={[s.swatchDot, { width: 22, height: 22, backgroundColor: /^#[0-9a-fA-F]{6}$/.test(t) ? t : '#fff', borderWidth: 1, borderColor: colors.line }]} />
      <TextInput
        value={t}
        onChangeText={(x) => {
          const c = ('#' + x.replace(/[^0-9a-fA-F]/g, '')).slice(0, 7);
          setT(c);
          if (/^#[0-9a-fA-F]{6}$/.test(c)) onChange(c.toUpperCase());
        }}
        placeholder="#RRGGBB"
        placeholderTextColor={colors.faint}
        maxLength={7}
        autoCapitalize="characters"
        style={[s.input, { width: 96, height: 34, fontSize: 12 }]}
      />
    </View>
  );
}

function ApiTab({ keys, setKeys, enabled, setEnabled, notify }: {
  keys: ApiKeyRow[]; setKeys: (k: ApiKeyRow[]) => void; enabled: boolean; setEnabled: (x: boolean) => Promise<void>; notify: Notify;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<ApiKeyRow | null>(null);
  const origin = BASE || (Platform.OS === 'web' ? globalThis.location?.origin ?? '' : '');
  const list = keys.filter((k) => k.scope !== 'sync');

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createKey(name.trim(), scope);
      setCreated({ name: r.name, key: r.key });
      setKeys([{ id: r.id, name: r.name, prefix: r.prefix, scope: r.scope, createdAt: new Date().toISOString() }, ...keys]);
      setName('');
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doRevoke = async () => {
    if (!revoke) return;
    try {
      await api.revokeKey(revoke.id);
      setKeys(keys.filter((k) => k.id !== revoke.id));
      notify('success', `ยกเลิก key "${revoke.name}" แล้ว`);
    } catch (e) {
      notify('error', (e as Error).message);
    }
    setRevoke(null);
  };
  const copy = (t: string) => {
    try {
      navigator.clipboard?.writeText(t).then(() => notify('success', 'คัดลอกแล้ว'));
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <Card title="API สำหรับระบบภายนอก">
        <Toggle label="อนุญาตให้ระบบภายนอกเชื่อมต่อด้วย API key" hint="บันทึกทันทีเมื่อกด · ใช้ดึงยอดขาย/สต็อก ไปทำรายงาน หรือให้ระบบอื่นเรียกดูข้อมูล" value={enabled} onChange={(x) => void setEnabled(x)} />
        <Text style={s.p}>ส่ง key ใน header: <Text style={s.code}>X-API-Key: pos_…</Text> (หรือ Authorization: Bearer pos_…) · เลือกสาขาด้วย <Text style={s.code}>X-Branch: B02</Text> (ไม่ส่ง = สาขาหลัก)</Text>
        <Text style={s.p}>Base URL: <Text selectable style={s.code}>{origin}/api</Text></Text>
      </Card>

      <Card title="API keys">
        <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Input value={name} onChange={setName} placeholder="ชื่อ เช่น Google Sheets, เว็บไซต์, n8n" max={60} />
          </View>
          <Seg value={scope} options={[['read', SCOPE_LABEL.read], ['write', SCOPE_LABEL.write]]} onChange={(x) => setScope(x as 'read' | 'write')} />
          <SmallBtn label="สร้าง key" icon="key-outline" busy={busy} disabled={!name.trim()} onPress={create} />
        </View>
        {list.length === 0 ? <Text style={s.sub}>ยังไม่มี API key</Text> : null}
        {list.map((k) => (
          <View key={k.id} style={s.keyRow}>
            <Icon name="key-outline" size={16} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.b} numberOfLines={1}>{k.name} <Text style={s.sub}>· {SCOPE_LABEL[k.scope]}</Text></Text>
              <Text style={s.sub} numberOfLines={1}>{k.prefix}… · สร้าง {k.createdAt ? thaiDateTime(k.createdAt.replace('T', ' ').slice(0, 19)) : '-'} · ใช้ล่าสุด {k.lastUsedAt ? thaiDateTime(k.lastUsedAt) : 'ยังไม่เคย'}</Text>
            </View>
            <Pressable onPress={() => setRevoke(k)} style={s.revoke} accessibilityLabel={`ยกเลิก key ${k.name}`}>
              <Text style={{ fontFamily: font, fontSize: 12, color: colors.danger }}>ยกเลิก</Text>
            </Pressable>
          </View>
        ))}
      </Card>

      <Card title="API ที่ใช้บ่อย">
        {[
          ['GET', '/api/dashboard?from=&to=', 'รายงานยอดขาย'],
          ['GET', '/api/history?from=&to=', 'ประวัติการขาย'],
          ['GET', '/api/stock/alerts', 'สินค้าใกล้หมด / หมด'],
          ['GET', '/api/stock/skus?q=&page=', 'สินค้า + SKU + สต็อก'],
          ['POST', '/api/stock/command', 'เช็ค/เพิ่ม/ปรับสต็อก { mode, lines:[{code,qty}], apply }'],
          ['POST', '/api/orders', 'สร้างบิลขาย (ต้องเปิดกะ)'],
        ].map(([m, p, d]) => (
          <View key={p} style={s.apiRow}>
            <Text style={[s.method, m === 'POST' && { backgroundColor: '#FFF4E0', color: '#B26A00' }]}>{m}</Text>
            <Text style={[s.code, { flexShrink: 1 }]} selectable>{p}</Text>
            <Text style={[s.sub, { flex: 1, minWidth: 140 }]}>{d}</Text>
          </View>
        ))}
        <Text style={s.sub}>ดูรายการ API ทั้งหมดได้ในไฟล์ README.md ของโปรเจกต์</Text>
      </Card>

      <Sheet visible={!!created} onClose={() => setCreated(null)} title={`API key: ${created?.name ?? ''}`} width={520}
        footer={
          <Pressable style={[s.primaryBtn, { flexGrow: 1, justifyContent: 'center' }]} onPress={() => created && copy(created.key)}>
            <Icon name="copy-outline" size={16} color="#fff" />
            <Text style={s.primaryText}>คัดลอก key</Text>
          </Pressable>
        }
      >
        <View style={{ gap: 8 }}>
          <Text selectable style={[s.code, { padding: 10, backgroundColor: colors.surface, borderRadius: radius.sm }]}>{created?.key}</Text>
          <Text style={[s.p, { color: '#8A5300' }]}>⚠️ key จะแสดงครั้งนี้ครั้งเดียว กรุณาคัดลอกเก็บไว้ (ระบบเก็บเฉพาะค่าที่เข้ารหัสแล้ว)</Text>
        </View>
      </Sheet>
      <Sheet visible={!!revoke} onClose={() => setRevoke(null)} title={`ยกเลิก key "${revoke?.name ?? ''}"?`} width={420}
        footer={
          <View style={[s.row, { flex: 1, justifyContent: 'flex-end' }]}>
            <Pressable style={s.ghostBtn} onPress={() => setRevoke(null)}><Text style={s.ghostText}>ไม่ใช่</Text></Pressable>
            <Pressable style={[s.primaryBtn, { backgroundColor: colors.danger }]} onPress={doRevoke}><Text style={s.primaryText}>ยกเลิก key</Text></Pressable>
          </View>
        }
      >
        <Text style={s.p}>ระบบที่ใช้ key นี้จะเชื่อมต่อไม่ได้ทันที</Text>
      </Sheet>
    </>
  );
}

/** รูปที่สูงตามสัดส่วนจริง */
function AutoImage({ uri, width, maxHeight }: { uri: string; width: number; maxHeight?: number }) {
  const [ratio, setRatio] = useState(3);
  useEffect(() => {
    let alive = true;
    Image.getSize?.(uri, (w, h) => alive && h > 0 && setRatio(w / h), () => {});
    return () => {
      alive = false;
    };
  }, [uri]);
  let w = width;
  let h = width / ratio;
  if (maxHeight && h > maxHeight) {
    h = maxHeight;
    w = maxHeight * ratio;
  }
  return <Image source={{ uri }} style={{ width: w, height: h }} resizeMode="contain" />;
}

/**
 * กระดาษบาร์โค้ด — โปรไฟล์ป้ายติดสินค้า (ขนาดกระดาษ ดวงต่อแถว บาร์โค้ด ข้อความ) ใช้ตอนพิมพ์ป้ายในหน้าสต็อก
 * บันทึกในตั้งค่าร้าน (ทุกเครื่อง/ทุกสาขาใช้ร่วมกัน)
 */
function LabelsSection({ v, set }: { v: AdminSettings['barcode']; set: Upd<AdminSettings['barcode']> }) {
  const profiles = v.labelProfiles?.length ? v.labelProfiles : [DEFAULT_LABEL_PROFILE];
  const [selId, setSelId] = useState(v.labelProfile || profiles[0].id);
  const p = profiles.find((x) => x.id === selId) ?? profiles[0];
  const { width } = useWindowDimensions();
  const wide = width >= 1250;
  const upd = (x: Partial<LabelProfile>) => set({ labelProfiles: profiles.map((q) => (q.id === p.id ? { ...q, ...x } : q)) });
  const add = (base?: LabelProfile) => {
    if (profiles.length >= 12) return;
    const id = `p${Date.now().toString(36)}`;
    const np: LabelProfile = { ...(base ?? DEFAULT_LABEL_PROFILE), id, name: base ? `${base.name} (สำเนา)`.slice(0, 40) : `โปรไฟล์ ${profiles.length + 1}` };
    set({ labelProfiles: [...profiles, np] });
    setSelId(id);
  };
  const remove = () => {
    if (profiles.length <= 1) return;
    const rest = profiles.filter((q) => q.id !== p.id);
    set({ labelProfiles: rest, labelProfile: v.labelProfile === p.id ? rest[0].id : v.labelProfile });
    setSelId(rest[0].id);
  };
  const isDefault = (v.labelProfile || profiles[0].id) === p.id;
  // ตัวอย่างใช้รหัสที่เข้ากับประเภทบาร์โค้ด (EAN/UPC ต้องเป็นตัวเลข)
  const SAMPLE_CODES: Partial<Record<Symbology, string>> = { ean13: '8850001234568', ean8: '96385074', upca: '036000291452', code39: 'AC-004-90' };
  const sample = { ...SAMPLE_LABEL, code: SAMPLE_CODES[resolveSymbology(p.symbology)] ?? SAMPLE_LABEL.code };
  const rollWidth = p.marginLeft + p.cols * p.width + (p.cols - 1) * p.gapX;
  const a4 = p.paper === 'a4';

  const settings = (
    <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
      <Card title="โปรไฟล์">
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {profiles.map((q) => {
            const on = q.id === p.id;
            const def = (v.labelProfile || profiles[0].id) === q.id;
            return (
              <Pressable key={q.id} onPress={() => setSelId(q.id)} style={[s.profileChip, on && s.profileOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={[s.profileName, on && { color: colors.primary }]} numberOfLines={1}>{def ? '★ ' : ''}{q.name}</Text>
                <Text style={s.hint} numberOfLines={1}>{profileSummary(q)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          <SmallBtn label="เพิ่มโปรไฟล์" icon="add" onPress={() => add()} disabled={profiles.length >= 12} />
          <SmallBtn label="ทำสำเนา" icon="copy-outline" onPress={() => add(p)} disabled={profiles.length >= 12} />
          <SmallBtn label={isDefault ? 'ค่าเริ่มต้นอยู่แล้ว' : 'ตั้งเป็นค่าเริ่มต้น'} icon="star-outline" onPress={() => set({ labelProfile: p.id })} disabled={isDefault} />
          <SmallBtn label="ลบโปรไฟล์นี้" icon="trash-outline" onPress={remove} disabled={profiles.length <= 1} />
        </View>
        <Field label="ชื่อโปรไฟล์" hint="★ = โปรไฟล์ที่เลือกไว้ก่อนเมื่อพิมพ์ป้าย (แต่ละเครื่องจำโปรไฟล์ที่ใช้ล่าสุด)">
          <Input value={p.name} onChange={(t) => upd({ name: t })} max={40} placeholder="เช่น สติ๊กเกอร์ม้วน 50×30" />
        </Field>
      </Card>

      <Card title="ขนาดกระดาษ">
        <Field label="แบบสำเร็จรูป" hint="กดเพื่อกรอกขนาด จำนวนดวง และขนาดตัวอักษรที่เหมาะสมให้ แล้วปรับต่อได้">
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            {LABEL_PRESETS.map((x) => (
              <Pressable key={x.id} onPress={() => upd(x.apply)} style={({ hovered }: { hovered?: boolean }) => [s.presetChip, hovered && { borderColor: colors.primary }]}>
                <Text style={s.presetT}>{x.label}</Text>
                <Text style={s.hint}>{x.hint}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
        <Field label="ชนิดกระดาษ">
          <Seg value={p.paper} options={[['roll', 'สติ๊กเกอร์ม้วน (เครื่องพิมพ์ป้าย)'], ['a4', 'กระดาษสติ๊กเกอร์ A4']]} onChange={(x) => upd({ paper: x as LabelProfile['paper'], cols: x === 'a4' ? Math.max(p.cols, 2) : Math.min(p.cols, 4), rows: x === 'a4' ? Math.max(p.rows, 5) : 1 })} />
        </Field>
        <Grid max={4}>
          <Field label="กว้างต่อดวง (มม.)"><NumStep value={p.width} min={10} max={210} step={1} onChange={(n) => upd({ width: n })} /></Field>
          <Field label="สูงต่อดวง (มม.)"><NumStep value={p.height} min={8} max={297} step={1} onChange={(n) => upd({ height: n })} /></Field>
          <Field label="ดวงต่อแถว"><NumStep value={p.cols} min={1} max={a4 ? 8 : 4} step={1} onChange={(n) => upd({ cols: n })} /></Field>
          {a4 ? <Field label="แถวต่อแผ่น"><NumStep value={p.rows} min={1} max={30} step={1} onChange={(n) => upd({ rows: n })} /></Field> : null}
        </Grid>
        <Grid max={4}>
          {p.cols > 1 ? <Field label="ห่างระหว่างดวง (มม.)"><NumStep value={p.gapX} min={0} max={20} step={0.5} onChange={(n) => upd({ gapX: n })} /></Field> : null}
          {a4 ? <Field label="ห่างระหว่างแถว (มม.)"><NumStep value={p.gapY} min={0} max={20} step={0.5} onChange={(n) => upd({ gapY: n })} /></Field> : null}
          <Field label="ขอบซ้าย (มม.)"><NumStep value={p.marginLeft} min={0} max={30} step={0.5} onChange={(n) => upd({ marginLeft: n })} /></Field>
          <Field label="ขอบบน (มม.)"><NumStep value={p.marginTop} min={0} max={30} step={0.5} onChange={(n) => upd({ marginTop: n })} /></Field>
          <Field label="ขอบในดวง (มม.)"><NumStep value={p.padding} min={0} max={6} step={0.2} onChange={(n) => upd({ padding: n })} /></Field>
        </Grid>
        <Text style={s.hint}>
          {a4
            ? `แผ่น A4 · ${p.cols} × ${p.rows} = ${p.cols * p.rows} ดวง/แผ่น`
            : `ความกว้างม้วนรวม ${Math.round(rollWidth * 10) / 10} มม. · ตั้งขนาดกระดาษในเครื่องพิมพ์ป้ายเป็น ${Math.round(rollWidth * 10) / 10} × ${p.height} มม.`}
        </Text>
      </Card>

      <Card title="บาร์โค้ด">
        <Field label="ประเภท" hint="รหัสที่ใช้กับประเภทที่เลือกไม่ได้ (เช่น มีตัวอักษรแต่เลือก EAN-13) จะพิมพ์เป็น Code 128 อัตโนมัติแทน — สแกนขายได้เหมือนเดิม">
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            {([{ id: 'auto', label: 'ตามตั้งค่าร้าน', hint: 'ตามเมนู บาร์โค้ด' }, ...SYMBOLOGIES] as { id: Symbology; label: string; hint: string }[]).map((x) => {
              const on = p.symbology === x.id;
              return (
                <Pressable key={x.id} onPress={() => upd({ symbology: x.id })} style={({ hovered }: { hovered?: boolean }) => [s.presetChip, on && s.profileOn, hovered && !on && { borderColor: colors.primary }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Text style={[s.presetT, on && { color: colors.primary }]}>{x.label}</Text>
                  <Text style={s.hint}>{x.hint}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
        <Grid max={4}>
          <Field label="ความสูงบาร์โค้ด (มม.)"><NumStep value={p.barHeight} min={3} max={60} step={0.5} onChange={(n) => upd({ barHeight: n })} /></Field>
          <Field label="ความหนาแท่ง (มม.)" hint="0 = ยืดตามความกว้าง % · เครื่องพิมพ์ 203 dpi แนะนำ 0.25 ขึ้นไป">
            <NumStep value={p.barModule ?? 0} min={0} max={1} step={0.05} onChange={(n) => upd({ barModule: n })} />
          </Field>
          <Field label="ความกว้างบาร์โค้ด (% ของดวง)" hint={(p.barModule ?? 0) > 0 ? 'ไม่ใช้ เมื่อตั้งความหนาแท่ง' : undefined}><NumStep value={p.barWidth} min={30} max={100} step={5} onChange={(n) => upd({ barWidth: n })} /></Field>
          <Field label="ระยะห่างบาร์โค้ด/ตัวหนังสือ (มม.)"><NumStep value={p.textGap} min={0} max={10} step={0.5} onChange={(n) => upd({ textGap: n })} /></Field>
        </Grid>
      </Card>

      <Card title="รูปแบบป้าย">
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {([
            ['standard', 'มาตรฐาน', 'ชื่อ · สี/ไซซ์ + ราคา · บาร์โค้ด · รหัส'],
            ['classic', 'แบบเดิม', 'ชื่อ + สี/ไซซ์ · บาร์โค้ด · รหัสตัวหนา · ราคาล่างสุด'],
            ['compact', 'บาร์โค้ดอย่างเดียว', 'บาร์โค้ด · รหัส (ป้ายเล็ก)'],
          ] as const).map(([id, label, hint]) => {
            const on = (p.layout ?? 'standard') === id;
            return (
              <Pressable key={id} onPress={() => upd({ layout: id })} style={({ hovered }: { hovered?: boolean }) => [s.profileChip, on && s.profileOn, hovered && !on && { borderColor: colors.primary }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={[s.profileName, on && { color: colors.primary }]}>{label}</Text>
                <Text style={s.hint}>{hint}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card title="ข้อความบนป้าย">
        <Grid max={4}>
          <Toggle label="แสดงรหัส" value={p.showCode} onChange={(x) => upd({ showCode: x })} />
          <Toggle label="ชื่อสินค้า" value={p.showName} onChange={(x) => upd({ showName: x })} />
          <Toggle label="สี / ไซซ์" value={p.showVariant} onChange={(x) => upd({ showVariant: x })} />
          <Toggle label="ราคา" value={p.showPrice} onChange={(x) => upd({ showPrice: x })} />
          <Toggle label="ชื่อร้าน" value={p.showShop} onChange={(x) => upd({ showShop: x })} />
          <Toggle label="ตัวหนา" value={p.bold} onChange={(x) => upd({ bold: x })} />
          <Toggle label="ตัวเอียง" value={p.italic} onChange={(x) => upd({ italic: x })} />
        </Grid>
        <Field label="ตำแหน่งของตัวอักษร">
          <Seg value={p.align} options={[['left', 'ชิดซ้าย'], ['center', 'กึ่งกลาง'], ['right', 'ชิดขวา']]} onChange={(x) => upd({ align: x as LabelProfile['align'] })} />
        </Field>
        <Grid max={3}>
          <Field label="ขนาดรหัส (pt)"><NumStep value={p.codeSize} min={4} max={20} step={0.5} onChange={(n) => upd({ codeSize: n })} /></Field>
          <Field label="ขนาดชื่อ (pt)"><NumStep value={p.nameSize} min={4} max={20} step={0.5} onChange={(n) => upd({ nameSize: n })} /></Field>
          <Field label="ขนาดราคา (pt)"><NumStep value={p.priceSize} min={4} max={24} step={0.5} onChange={(n) => upd({ priceSize: n })} /></Field>
        </Grid>
      </Card>
    </View>
  );

  const side = (
    <View style={[{ gap: 12 }, wide ? [{ width: 380 }, STICKY] : { width: '100%' }]}>
      <Card title="ตัวอย่างป้าย">
        <View style={s.previewBox}>
          <LabelPreview profile={p} sample={sample} maxWidth={wide ? 340 : 520} />
        </View>
        <Text style={s.hint}>{p.name} · {profileSummary(p)} · {symbologyLabel(resolveSymbology(p.symbology))}</Text>
        <Text style={s.hint}>
          ตัวอย่างใช้รูปแบบเดียวกับตอนพิมพ์จริง · พิมพ์ป้ายได้ที่หน้า สต็อกสินค้า → ปุ่มพิมพ์บาร์โค้ด · ในหน้าต่างพิมพ์ เลือกเครื่องพิมพ์ป้าย ขนาดกระดาษให้ตรง และระยะขอบ: ไม่มี
        </Text>
      </Card>
    </View>
  );

  return (
    <View style={[{ gap: 12 }, wide ? { flexDirection: 'row', alignItems: 'flex-start' } : null]}>
      {settings}
      {side}
    </View>
  );
}

/** ช่องตัวเลข + ปุ่ม − / + (รองรับทศนิยมตาม step) */
function NumStep({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const k = 10 ** dec;
  const fmt = (n: number) => String(Math.round(n * k) / k);
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (n: number) => onChange(Math.max(min, Math.min(max, Math.round(n * k) / k)));
  return (
    <View style={s.row}>
      <Pressable style={s.arrow} onPress={() => commit(value - step)} accessibilityLabel="ลด"><Icon name="remove" size={16} color={colors.text} /></Pressable>
      <TextInput
        value={text}
        onChangeText={(t) => setText(t.replace(dec ? /[^0-9.]/g : /[^0-9]/g, '').slice(0, 6))}
        onBlur={() => (text.trim() === '' || !Number.isFinite(Number(text)) ? setText(fmt(value)) : commit(Number(text)))}
        onSubmitEditing={() => Number.isFinite(Number(text)) && commit(Number(text))}
        keyboardType={dec ? 'decimal-pad' : 'number-pad'}
        selectTextOnFocus
        style={[s.input, { width: 72, textAlign: 'center', paddingHorizontal: 4 }]}
      />
      <Pressable style={s.arrow} onPress={() => commit(value + step)} accessibilityLabel="เพิ่ม"><Icon name="add" size={16} color={colors.text} /></Pressable>
    </View>
  );
}

/**
 * ตั้งค่าเครื่องพิมพ์ใบเสร็จของ "เครื่องนี้" — เก็บในแอปเดสก์ท็อป (แต่ละเครื่อง/สาขาตั้งไม่เหมือนกันได้)
 * บันทึกแยกจากตั้งค่าร้าน (ปุ่มบันทึกในการ์ดด้านขวา) · เปิดผ่านเบราว์เซอร์จะไม่มีส่วนนี้
 */
function PrinterSection({ shopPaper, notify, goReceipt }: { shopPaper: 58 | 80; notify: (k: Toast['kind'], t: string) => void; goReceipt: () => void }) {
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

/** ปุ่มอัปโหลดรูป (ย่ออัตโนมัติ) */
function UploadBtn({ label, onDone }: { label: string; onDone: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const pick = () => {
    if (Platform.OS !== 'web') return;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png,image/webp';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      setBusy(true);
      try {
        onDone((await api.upload(await resizeToDataUrl(f, 800))).url);
      } catch (e) {
        globalThis.alert?.((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    inp.click();
  };
  return <SmallBtn label={label} icon="cloud-upload-outline" busy={busy} onPress={pick} />;
}

/** ปรับขนาด: − ค่า + และปุ่มลัด */
function Stepper({ value, min, max, step, presets, onChange }: { value: number; min: number; max: number; step: number; presets: number[]; onChange: (v: number) => void }) {
  const clamp = (x: number) => Math.max(min, Math.min(max, x));
  return (
    <View style={[s.row, { flexWrap: 'wrap' }]}>
      <Pressable style={s.arrow} onPress={() => onChange(clamp(value - step))} accessibilityLabel="เล็กลง"><Icon name="remove" size={16} color={colors.text} /></Pressable>
      <Text style={[s.b, { minWidth: 44, textAlign: 'center' }]}>{value}%</Text>
      <Pressable style={s.arrow} onPress={() => onChange(clamp(value + step))} accessibilityLabel="ใหญ่ขึ้น"><Icon name="add" size={16} color={colors.text} /></Pressable>
      <Seg value={value} options={presets.map((p) => [p, `${p}%`] as [number, string])} onChange={(x) => onChange(Number(x))} />
    </View>
  );
}

// ======================= ชิ้นส่วนฟอร์ม =======================
/** คอลัมน์ขวา (ตัวอย่าง / บันทึก) ติดอยู่ด้านบนขณะเลื่อนเนื้อหาฝั่งซ้าย — position: sticky ใช้ได้บนเว็บ */
const STICKY = { position: 'sticky', top: 0, alignSelf: 'flex-start' } as unknown as ViewStyle;

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}
/** กริดฟอร์ม: max = จำนวนคอลัมน์สูงสุด (วัดความกว้างจริง → จอแคบลดเหลือ 2 / 1 คอลัมน์) */
function Grid({ children, max }: { children: ReactNode; max?: number }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const [w, setW] = useState(0);
  if (!max) {
    return (
      <View style={s.grid}>
        {items.map((c, i) => (
          <View key={i} style={s.gridItem}>{c}</View>
        ))}
      </View>
    );
  }
  const GAP = 12;
  const MIN = 220;
  const cols = w ? Math.max(1, Math.min(max, Math.floor((w + GAP) / (MIN + GAP)))) : max;
  const itemW = w ? (w - GAP * (cols - 1)) / cols : undefined;
  return (
    <View style={s.grid} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {items.map((c, i) => (
        <View key={i} style={itemW ? { width: itemW, minWidth: 0 } : s.gridItem}>{c}</View>
      ))}
    </View>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}
function Input({ value, onChange, placeholder, max, multiline, keyboard, secure, compact, onFocus }: {
  value: string; onChange: (t: string) => void; placeholder?: string; max?: number; multiline?: boolean;
  keyboard?: 'number-pad' | 'decimal-pad'; secure?: boolean; compact?: boolean; onFocus?: () => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      onFocus={onFocus}
      placeholder={placeholder}
      placeholderTextColor={colors.faint}
      maxLength={max}
      multiline={multiline}
      keyboardType={keyboard}
      secureTextEntry={secure}
      autoCapitalize="none"
      style={[s.input, multiline && { height: 72, paddingTop: 10, textAlignVertical: 'top' }, compact && { width: 70, textAlign: 'center' }]}
    />
  );
}
function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[s.track, value && s.trackOn]} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label}>
      <View style={[s.knob, value && { transform: [{ translateX: 18 }] }]} />
    </Pressable>
  );
}
function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable style={s.toggleRow} onPress={() => onChange(!value)}>
      <View style={{ flex: 1 }}>
        <Text style={s.toggleLabel}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onChange={onChange} label={label} />
    </Pressable>
  );
}
function Seg({ value, options, onChange }: { value: string | number; options: [string | number, string][]; onChange: (v: string | number) => void }) {
  return (
    <View style={s.seg}>
      {options.map(([v, l]) => {
        const on = v === value;
        return (
          <Pressable key={String(v)} onPress={() => onChange(v)} style={[s.segItem, on && s.segOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
            <Text style={[s.segText, on && { color: '#fff', fontWeight: '600' }]}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function SmallBtn({ label, icon, onPress, busy, disabled }: { label: string; icon: IconName; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={[s.smallBtn, (disabled || busy) && { opacity: 0.5 }]} onPress={onPress} disabled={disabled || busy} accessibilityLabel={label}>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name={icon} size={15} color={colors.primary} />}
      <Text style={s.smallBtnText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  shopPhoto: { width: 96, height: 72, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  sub: { fontFamily: font, fontSize: 12, color: colors.sub, lineHeight: 18 },
  error: { fontFamily: font, color: colors.danger },
  navCol: { gap: 6 },
  navRow: { flexDirection: 'row', gap: 6 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  navSub: { height: 40, marginLeft: 18, paddingHorizontal: 10, gap: 8 },
  navChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surface },
  navOn: { backgroundColor: colors.primary },
  navText: { fontFamily: font, fontSize: 13, color: colors.text, flexShrink: 1 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  secTitle: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, gap: 12, backgroundColor: '#fff' },
  cardTitle: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  field: { gap: 6, minWidth: 0 },
  gridItem: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
  label: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  hint: { fontFamily: font, fontSize: 11, color: colors.sub, lineHeight: 16 },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  toggleLabel: { fontFamily: font, fontSize: 14, color: colors.text },
  track: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.line, padding: 3 },
  trackOn: { backgroundColor: colors.success },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  segOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText: { fontFamily: font, fontSize: 12, color: colors.text },
  p: { fontFamily: font, fontSize: 13, color: colors.text, lineHeight: 20 },
  b: { fontFamily: font, fontWeight: '700', color: colors.text },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  code: { fontFamily: Platform.select({ web: 'ui-monospace, Menlo, Consolas, monospace', default: undefined }), fontSize: 12, color: colors.text },
  infoBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, gap: 4 },
  payRow: { borderTopWidth: 1, borderTopColor: '#F2F4F7', paddingTop: 12 },
  arrow: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  unitBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unit: { fontFamily: font, fontSize: 12, color: colors.sub },
  preview: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  paper: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, padding: 12, gap: 3, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  pText: { fontFamily: font, color: '#111' },
  pc: { textAlign: 'center' },
  pRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  dash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#999', marginVertical: 4 },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  dot: { width: 10, height: 10, borderRadius: 5 },
  copyBox: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  revoke: { paddingHorizontal: 10, height: 30, borderRadius: radius.pill, borderWidth: 1, borderColor: '#F3C4C6', justifyContent: 'center' },
  apiRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingVertical: 4 },
  method: { fontFamily: font, fontSize: 10, fontWeight: '700', color: colors.success, backgroundColor: colors.successSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  logoBox: { width: 130, height: 76, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  blockBox: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 10, gap: 8, backgroundColor: colors.surface },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  summary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 10, borderRadius: radius.pill },
  pillText: { fontFamily: font, fontSize: 12, fontWeight: '600' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.primary },
  tabText: { fontFamily: font, fontSize: 13, color: colors.sub },
  evRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F2F4F7', flexWrap: 'wrap' },
  evIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  chText: { fontFamily: font, fontSize: 12, color: colors.text },
  evChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  evChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  phBox: { backgroundColor: '#F4F7FF', borderRadius: radius.md, padding: 10, gap: 8, borderWidth: 1, borderColor: '#DCE6FF' },
  phChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 9, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9D8FF' },
  phText: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '600' },
  emoji: { minWidth: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#fff' },
  swatchOn: { borderColor: colors.text, boxShadow: '0 0 0 2px #fff inset' } as object,
  swatchAuto: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 8, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.line },
  swatchDot: { width: 16, height: 16, borderRadius: 8 },
  lineEdit: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  previewBox: { gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: '#ECECE8', alignItems: 'center' },
  previewPaper: { backgroundColor: '#fff', padding: 6 },
  previewEmpty: { alignItems: 'center', justifyContent: 'center', gap: 8, height: 160, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.surface },
  profileChip: { minWidth: 150, maxWidth: 240, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', gap: 2 },
  profileOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  profileName: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  presetChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  presetT: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: '#D5E1FF', backgroundColor: colors.primarySoft },
  linkTitle: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.primary },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  smallBtnText: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '600' },
  saveBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.line },
  ghostBtn: { height: 44, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  ghostText: { fontFamily: font, fontSize: 14, color: colors.text },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.primary },
  primaryText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '700' },
});
