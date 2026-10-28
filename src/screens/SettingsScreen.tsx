// หน้า ตั้งค่า: เมนูหมวด (ซ้าย) + หน้าของหมวดที่เลือก + ปุ่มบันทึก — แต่ละหมวดอยู่ในโฟลเดอร์ src/settings/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { api, type AdminSettings, type ApiKeyRow } from '../api';
import { setAppSettings, getAppSettings } from '../appSettings';
import { Icon, type IconName } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { ToastView } from '../components/ToastView';
import type { Toast } from '../store/usePos';
import { colors } from '../theme';
import { TaxSection } from '../settings/TaxSection';
import { TabScroller, s } from '../settings/ui';
import { ShopSection } from '../settings/ShopSection';
import { DisplaySection } from '../settings/DisplaySection';
import { StockSection } from '../settings/StockSection';
import { PaymentsSection } from '../settings/PaymentsSection';
import { BarcodeSection } from '../settings/BarcodeSection';
import { LabelsSection } from '../settings/LabelsSection';
import { LabelPrinterSection } from '../settings/LabelPrinterSection';
import { ReceiptSection } from '../settings/ReceiptSection';
import { PrinterSection } from '../settings/PrinterSection';
import { NotifySection } from '../settings/notify/NotifySection';
import { BackupSection } from '../settings/BackupSection';

type SectionId = 'shop' | 'display' | 'stock' | 'payments' | 'tax' | 'barcode' | 'labels' | 'labelPrinter' | 'receipt' | 'printer' | 'notify' | 'backup';

/** หมวดที่บันทึกลงตั้งค่าร้านชุดเดียวกัน (กระดาษบาร์โค้ด → barcode) */
const dataKey = (id: SectionId) => (id === 'labels' ? 'barcode' : id) as keyof AdminSettings;

/** sub = เมนูย่อย (แสดงเยื้องใต้เมนูก่อนหน้า) · local = เก็บในเครื่องนี้ ไม่ใช่ตั้งค่าร้าน (มีปุ่มบันทึกของตัวเอง) */
export const SECTIONS: { id: SectionId; label: string; icon: IconName; desc: string; sub?: boolean; local?: boolean }[] = [
  { id: 'shop', label: 'ข้อมูลร้าน', icon: 'storefront-outline', desc: 'ชื่อร้าน เลขผู้เสียภาษี ที่อยู่/เบอร์ค่าเริ่มต้น' },
  { id: 'display', label: 'การแสดงผลหน้าขาย', icon: 'grid-outline', desc: 'มุมมองสินค้า รูปทรง/คุณภาพรูป ตัวอักษร การแสดงสต็อก' },
  { id: 'stock', label: 'สต็อก', icon: 'cube-outline', desc: 'จุดแจ้งเตือนสินค้าเหลือน้อย · รูปแบบรหัส SKU' },
  { id: 'payments', label: 'วิธีชำระเงิน & ค่าธรรมเนียม', icon: 'wallet-outline', desc: 'เปิด/ปิดวิธีชำระ ตั้งชื่อ ค่าธรรมเนียม % / บาท' },
  { id: 'tax', label: 'ภาษี (VAT)', icon: 'document-text-outline', desc: 'ไม่บังคับ — ตั้งเมื่อร้านจด VAT: เลขผู้เสียภาษี · สำนักงานใหญ่/สาขาที่ · อัตรา VAT (วันเริ่ม/สิ้นสุด) · หมายเลขเครื่อง POS · ห้ามแก้ไขบิล', local: true },
  { id: 'barcode', label: 'บาร์โค้ด', icon: 'barcode-outline', desc: 'ประเภทบาร์โค้ด · สร้างบาร์โค้ดอัตโนมัติ' },
  { id: 'labels', label: 'กระดาษบาร์โค้ด', icon: 'pricetags-outline', desc: 'หน้าตาป้าย: โปรไฟล์ · ขนาดสติ๊กเกอร์/ดวงต่อแถว · ขนาดบาร์โค้ด · ข้อมูลและตัวอักษรบนป้าย · รูปแบบป้าย' },
  { id: 'labelPrinter', label: 'ตั้งค่าเครื่องพิมพ์บาร์โค้ด', icon: 'print-outline', desc: 'เครื่องพิมพ์ป้ายบาร์โค้ดของคอมพิวเตอร์เครื่องนี้ (แยกจากเครื่องพิมพ์ใบเสร็จ) · พิมพ์ทันทีไม่ถาม · ขนาดกระดาษในไดรเวอร์ · ทดสอบพิมพ์ป้าย', local: true },
  { id: 'receipt', label: 'ใบเสร็จ', icon: 'receipt-outline', desc: 'ภาษา (ไทย / English) · แก้คำในบิล · ขนาดกระดาษ · ข้อความหัว/ท้าย' },
  { id: 'printer', label: 'ตั้งค่าเครื่องพิมพ์ใบเสร็จ', icon: 'print-outline', desc: 'เครื่องพิมพ์ของคอมพิวเตอร์เครื่องนี้ · USB / LAN / Bluetooth · ขนาดกระดาษ · ตัดกระดาษ · ลิ้นชักเงิน', local: true },
  { id: 'backup', label: 'สำรอง & กู้คืนข้อมูล', icon: 'cloud-download-outline', desc: 'ดาวน์โหลดไฟล์สำรอง (.db) ทั้งร้าน / รายสาขา · กู้คืนจากไฟล์ เลือกสาขาที่จะกู้ได้', local: true },
  { id: 'notify', label: 'การแจ้งเตือน & API', icon: 'notifications-outline', desc: 'LINE (การ์ดปรับแต่งได้) · WhatsApp · Webhook · เหตุการณ์ที่ต้องการแจ้ง · API key' },
];

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
      setAppSettings({ shop: s.shop, display: s.display, payments: { ...s.payments, vat: getAppSettings().payments.vat }, receipt: s.receipt, barcode: { symbology: s.barcode.symbology, labelProfiles: s.barcode.labelProfiles, labelProfile: s.barcode.labelProfile }, stock: { lowStockDefault: s.stock.lowStockDefault, allowNegative: s.stock.allowNegative } });
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

  // จอแคบ: แถบแท็บแนวนอน — ลากด้วยเมาส์ / หมุนล้อเมาส์ / กดลูกศร เพื่อเลื่อน (ลากแล้วไม่นับเป็นการกดแท็บ)
  const dragRef = useRef<() => boolean>(() => false);
  const nav = (
    <View style={twoPane ? s.navCol : s.navRow}>
      {SECTIONS.map((it) => {
        const on = it.id === section;
        return (
          <Pressable
            key={it.id}
            onPress={() => {
              if (!twoPane && dragRef.current()) return;
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
            {twoPane ? <View style={{ width: 250 }}>{nav}</View> : <TabScroller active={section} dragRef={dragRef}>{nav}</TabScroller>}
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
                {section === 'payments' ? <PaymentsSection v={draft.payments} set={(v) => patch('payments', v)} goTax={() => setSection('tax')} /> : null}
                {section === 'tax' ? <TaxSection notify={notify} onChanged={() => { load(); onSettingsChanged(); }} /> : null}
                {section === 'barcode' ? <BarcodeSection v={draft.barcode} set={(v) => patch('barcode', v)} stock={draft.stock} goStock={() => setSection('stock')} goLabels={() => setSection('labels')} /> : null}
                {section === 'labels' ? <LabelsSection v={draft.barcode} set={(v) => patch('barcode', v)} goLabelPrinter={() => setSection('labelPrinter')} /> : null}
                {section === 'labelPrinter' ? <LabelPrinterSection barcode={draft.barcode} notify={notify} goLabels={() => setSection('labels')} /> : null}
                {section === 'receipt' ? <ReceiptSection v={draft.receipt} shop={draft.shop} vat={draft.payments.vat} set={(v) => patch('receipt', v)} goPrinter={() => setSection('printer')} /> : null}
                {section === 'printer' ? <PrinterSection shopPaper={draft.receipt.paperWidth} notify={notify} goReceipt={() => setSection('receipt')} /> : null}
                {section === 'backup' ? <BackupSection notify={notify} onChanged={onSettingsChanged} /> : null}
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
