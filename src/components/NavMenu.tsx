// เมนูด้านซ้าย / เมนูมือถือ: รายการหน้า (Route) และสิทธิ์ผู้จัดการ
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { LANGS, useT } from '../i18n';
import { can, useSession, type Feature, type Me } from '../session';
import { colors, font, radius } from '../theme';
import { BranchChip } from './BranchPicker';
import { Icon, type IconName } from './Icon';
import { AppVersionChip, UpdateButton } from './UpdateButton';

export type Route =
  | 'sales' | 'dashboard' | 'salesReport' | 'billReport' | 'productReport' | 'taxReport' | 'history' | 'shifts' | 'expenses' | 'promos' | 'staff' | 'stock' | 'skus' | 'shipments' | 'shipmentReport' | 'branches' | 'settings';

/** หน้าไหนต้องมีสิทธิ์อะไร (ตั้งได้ที่ พนักงาน → การจัดการสิทธิ์) */
export const ROUTE_FEATURE: Record<Route, Feature> = {
  sales: 'sales', history: 'history', shifts: 'shifts', expenses: 'expenses', promos: 'promos',
  stock: 'stock', skus: 'stock', shipments: 'shipments', shipmentReport: 'shipments',
  dashboard: 'reports', salesReport: 'reports', billReport: 'reports', productReport: 'reports', taxReport: 'taxReport',
  staff: 'staff', branches: 'branches', settings: 'settings',
};
/** เปิดหน้านี้ได้ไหม */
export const canOpen = (me: Me, r: Route) => can(me, ROUTE_FEATURE[r]);
/** หน้าแรกที่เปิดได้ (ใช้เมื่อถูกพาออกจากหน้าที่ไม่มีสิทธิ์) */
export const firstRoute = (me: Me): Route =>
  (['sales', 'history', 'shifts', 'expenses', 'promos', 'stock', 'shipments', 'dashboard', 'staff', 'settings'] as Route[]).find((r) => canOpen(me, r)) ?? 'sales';

/** หน้าที่อยู่ใต้เมนู "รายงาน" (แสดงตามสิทธิ์ของบทบาท) */
export const REPORT_ROUTES: Route[] = ['dashboard', 'salesReport', 'billReport', 'productReport', 'taxReport'];
// เปิด/ปิดกลุ่มเมนู (รายงาน / สต็อกสินค้า) — จำไว้ระหว่างเปลี่ยนหน้า (แต่ละหน้ามี sidebar ของตัวเอง)
const groupOpen: Partial<Record<string, boolean>> = {};

// ---- ป้ายแจ้งเตือนสต็อก (ใช้ร่วมกันทุกเมนู โหลดครั้งเดียว) ----
let stockBadge = 0;
let badgeLoaded = false;
const badgeListeners = new Set<(n: number) => void>();
/** โหลดจำนวนสินค้าเหลือน้อย/หมดใหม่ แล้วอัปเดตป้ายบนเมนู */
export function refreshStockBadge() {
  badgeLoaded = true;
  api
    .stockAlerts()
    .then((r) => {
      stockBadge = (r.low ?? 0) + (r.out ?? 0);
      badgeListeners.forEach((f) => f(stockBadge));
    })
    .catch(() => {});
}
function useStockBadge() {
  const [n, setN] = useState(stockBadge);
  useEffect(() => {
    badgeListeners.add(setN);
    if (!badgeLoaded) refreshStockBadge();
    return () => {
      badgeListeners.delete(setN);
    };
  }, []);
  return n;
}

interface Item { id: Route | 'report' | 'stockGroup' | 'shipGroup'; label: string; icon: IconName; soon?: boolean; children?: Item[] }
const ITEMS: Item[] = [
  { id: 'sales', label: 'nav.sales', icon: 'storefront-outline' },
  {
    id: 'report', label: 'nav.report', icon: 'stats-chart-outline',
    children: [
      { id: 'dashboard', label: 'nav.dashboard', icon: 'grid-outline' },
      { id: 'salesReport', label: 'nav.salesReport', icon: 'cash-outline' },
      { id: 'billReport', label: 'nav.billReport', icon: 'receipt-outline' },
      { id: 'productReport', label: 'nav.productReport', icon: 'pricetags-outline' },
      { id: 'taxReport', label: 'nav.taxReport', icon: 'document-text-outline' },
    ],
  },
  { id: 'history', label: 'nav.history', icon: 'receipt-outline' },
  { id: 'shifts', label: 'nav.shifts', icon: 'time-outline' },
  { id: 'expenses', label: 'nav.expenses', icon: 'wallet-outline' },
  { id: 'promos', label: 'nav.promos', icon: 'gift-outline' },
  { id: 'staff', label: 'nav.staff', icon: 'people-outline' },
  {
    id: 'stockGroup', label: 'nav.stockGroup', icon: 'shirt-outline',
    children: [
      { id: 'stock', label: 'nav.stock', icon: 'shirt-outline' },
      { id: 'skus', label: 'nav.skus', icon: 'barcode-outline' },
    ],
  },
  {
    id: 'shipGroup', label: 'nav.shipGroup', icon: 'cube-outline',
    children: [
      { id: 'shipments', label: 'nav.shipments', icon: 'scan-outline' },
      { id: 'shipmentReport', label: 'nav.shipmentReport', icon: 'document-text-outline' },
    ],
  },
  { id: 'branches', label: 'nav.branches', icon: 'business-outline' },
  { id: 'settings', label: 'nav.settings', icon: 'settings-outline' },
];

interface MenuProps {
  route: Route;
  onNavigate: (r: Route) => void;
  /** ช่องค้นหาด้านบนเมนู (หน้าประวัติการขายใช้ค้นหาบิล) */
  header?: ReactNode;
}

/** เมนูที่บทบาทนี้เห็น (กลุ่มเมนูเหลือเฉพาะลูกที่เปิดได้) */
function visibleItems(me: Me): Item[] {
  return ITEMS.flatMap((it) => {
    if (!it.children) return canOpen(me, it.id as Route) ? [it] : [];
    const children = it.children.filter((c) => canOpen(me, c.id as Route));
    return children.length ? [{ ...it, children }] : [];
  });
}

/** รายการเมนู + ส่วนท้าย ใช้ร่วมกันทั้ง sidebar และ drawer */
export function NavMenu({ route, onNavigate, header }: MenuProps) {
  const { me, logout } = useSession();
  const { t, lang, setLang } = useT();
  const badge = useStockBadge();
  // กลุ่มเมนูย่อย: ถ้ายังไม่เคยกดเปิด/ปิด → เปิดอยู่เมื่อหน้าปัจจุบันอยู่ในกลุ่มนั้น
  const [, rerender] = useState(0);
  const isOpen = (it: Item) => groupOpen[it.id] ?? !!it.children?.some((c) => c.id === route);
  const toggle = (it: Item) => {
    groupOpen[it.id] = !isOpen(it);
    rerender((n) => n + 1);
  };
  const stockBadgeView = (on: boolean) =>
    badge > 0 ? (
      <View style={[s.badge, on && { backgroundColor: '#fff' }]} accessibilityLabel={`สินค้าเหลือน้อยหรือหมด ${badge} รายการ`}>
        <Text style={[s.badgeText, on && { color: colors.danger }]}>{badge > 99 ? '99+' : badge}</Text>
      </View>
    ) : null;
  return (
    <View style={s.menu}>
      <BranchChip block />
      {header}
      {/* รายการเมนูเลื่อนขึ้น-ลงได้เมื่อยาวเกินจอ (เช่น เปิดเมนูย่อยหลายกลุ่ม) — ส่วนผู้ใช้/ท้ายเมนูอยู่กับที่ด้านล่าง */}
      <ScrollView style={s.items} contentContainerStyle={{ gap: 8 }} showsVerticalScrollIndicator>
        {visibleItems(me).map((it) => {
          if (it.children) {
            const expanded = isOpen(it);
            const inGroup = it.children.some((c) => c.id === route);
            return (
              <View key={it.id} style={{ gap: 6 }}>
                <Pressable
                  onPress={() => toggle(it)}
                  style={({ hovered }: { hovered?: boolean }) => [s.item, inGroup && s.groupOn, hovered && !inGroup && s.itemHover]}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${t(it.label)} — ${expanded ? 'ย่อ' : 'แสดง'}เมนูย่อย`}
                >
                  <Icon name={it.icon} size={19} color={inGroup ? colors.primary : colors.text} />
                  <Text style={[s.itemText, inGroup && { color: colors.primary, fontWeight: '600' }]}>{t(it.label)}</Text>
                  {it.id === 'stockGroup' && !expanded ? stockBadgeView(false) : null}
                  <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={inGroup ? colors.primary : colors.sub} />
                </Pressable>
                {expanded ? (
                  <View style={s.sub}>
                    {it.children.map((c) => {
                      const on = c.id === route;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => onNavigate(c.id as Route)}
                          style={({ hovered }: { hovered?: boolean }) => [s.subItem, on && s.itemOn, hovered && !on && s.itemHover]}
                          accessibilityRole="link"
                          accessibilityState={{ selected: on }}
                        >
                          <Icon name={c.icon} size={17} color={on ? '#fff' : colors.sub} />
                          <Text style={[s.itemText, on && { color: '#fff' }]} numberOfLines={1}>{t(c.label)}</Text>
                          {c.id === 'stock' ? stockBadgeView(on) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          }
          const on = it.id === route;
          return (
            <Pressable
              key={it.id}
              disabled={it.soon}
              onPress={() => onNavigate(it.id as Route)}
              style={({ hovered }: { hovered?: boolean }) => [s.item, on && s.itemOn, hovered && !on && !it.soon && s.itemHover]}
              accessibilityRole="link"
              accessibilityState={{ selected: on, disabled: it.soon }}
            >
              <Icon name={it.icon} size={19} color={on ? '#fff' : it.soon ? colors.faint : colors.text} />
              <Text style={[s.itemText, on && { color: '#fff' }, it.soon && { color: colors.faint }]}>{t(it.label)}</Text>
              {it.soon ? <Text style={s.soon}>เร็ว ๆ นี้</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {/* สลับภาษา — เฉพาะเครื่องนี้ ไม่กระทบเครื่องอื่นหรือสาขาอื่น */}
      <View style={s.langRow}>
        <Icon name="language-outline" size={15} color={colors.sub} />
        {LANGS.map((l) => (
          <Pressable
            key={l.id}
            onPress={() => setLang(l.id)}
            style={[s.langBtn, lang === l.id && s.langOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: lang === l.id }}
            accessibilityLabel={l.label}
          >
            <Text style={[s.langText, lang === l.id && { color: '#fff', fontWeight: '700' }]}>{l.short}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.user}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{me.name.slice(0, 1)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.userName} numberOfLines={1}>{me.name}</Text>
          <Text style={s.userRole}>{t(`role.${me.role}`)}</Text>
        </View>
        <Pressable
          onPress={logout}
          style={({ hovered }: { hovered?: boolean }) => [s.logout, hovered && { backgroundColor: colors.dangerSoft }]}
          accessibilityLabel="ออกจากระบบ"
        >
          <Icon name="log-out-outline" size={18} color={colors.danger} />
          <Text style={s.logoutText}>{t('nav.logout')}</Text>
        </Pressable>
      </View>
      <UpdateButton block />
      <View style={s.footer}>
        <View style={s.footRow}>
          <Text style={s.footChip}>v0.4</Text>
          <AppVersionChip style={s.footChip} />
        </View>
      </View>
    </View>
  );
}

export function Sidebar(props: MenuProps & { width?: number }) {
  return (
    <View style={[s.sidebar, { width: props.width ?? 240 }]}>
      <NavMenu {...props} />
    </View>
  );
}

export function NavDrawer({ visible, onClose, ...props }: MenuProps & { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.drawer}>
          <View style={s.drawerHead}>
            <Text style={s.drawerTitle}>เมนู</Text>
            <Pressable onPress={onClose} style={s.close} accessibilityLabel="ปิดเมนู">
              <Icon name="close" size={20} color={colors.sub} />
            </Pressable>
          </View>
          <NavMenu
            {...props}
            onNavigate={(r) => {
              onClose();
              props.onNavigate(r);
            }}
          />
        </View>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="ปิดเมนู" />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sidebar: { backgroundColor: colors.panel, borderRadius: radius.xl, padding: 12, minHeight: 0, overflow: 'hidden' },
  menu: { flex: 1, gap: 12, minHeight: 0 },
  // flexGrow 1 = ดันส่วนผู้ใช้ลงล่างสุด · flexShrink + minHeight 0 = หดแล้วเลื่อนได้แทนการล้นทะลุจอ
  items: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, marginHorizontal: -4, paddingHorizontal: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.surface },
  itemOn: { backgroundColor: colors.primary },
  itemHover: { backgroundColor: '#EDF0F5' },
  groupOn: { backgroundColor: colors.primarySoft },
  sub: { gap: 6, marginLeft: 18, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: colors.line },
  subItem: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  itemText: { fontFamily: font, fontSize: 14, color: colors.text, flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: font, fontSize: 11, fontWeight: '700', color: '#fff' },
  soon: { fontFamily: font, fontSize: 10, color: colors.faint },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface },
  langRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingBottom: 2 },
  langBtn: { paddingHorizontal: 10, height: 26, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  langOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  langText: { fontFamily: font, fontSize: 11.5, color: colors.sub, fontWeight: '600' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font, fontSize: 15, fontWeight: '700', color: '#fff' },
  userName: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  userRole: { fontFamily: font, fontSize: 11, color: colors.sub },
  logout: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 34, borderRadius: radius.pill },
  logoutText: { fontFamily: font, fontSize: 12, color: colors.danger, fontWeight: '600' },
  footer: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, gap: 4 },
  brand: { fontFamily: font, fontSize: 16, fontWeight: '700', color: colors.primary, fontStyle: 'italic' },
  brandSub: { fontFamily: font, fontSize: 11, color: colors.sub },
  tagline: { fontFamily: font, fontSize: 11, color: colors.sub, lineHeight: 16 },
  footRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  footChip: { fontFamily: font, fontSize: 10, color: colors.sub, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  backdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(17,24,39,0.42)' },
  drawer: { width: 290, maxWidth: '86%', backgroundColor: colors.panel, padding: 14, gap: 10, minHeight: 0 },
  drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  drawerTitle: { fontFamily: font, fontSize: 18, fontWeight: '600', color: colors.text },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
