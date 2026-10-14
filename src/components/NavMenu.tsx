import { Credit } from './Credit';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { useSession } from '../session';
import { colors, font, radius } from '../theme';
import { BranchChip } from './BranchPicker';
import { Icon, type IconName } from './Icon';
import { AppVersionChip, UpdateButton } from './UpdateButton';

export type Route = 'sales' | 'dashboard' | 'history' | 'shifts' | 'expenses' | 'staff' | 'stock' | 'skus' | 'shipments' | 'branches' | 'settings';

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

const ITEMS: { id: Route | 'stock' | 'report'; label: string; icon: IconName; soon?: boolean; manager?: boolean }[] = [
  { id: 'sales', label: 'หน้าขาย', icon: 'storefront-outline' },
  { id: 'dashboard', label: 'รายงาน', icon: 'stats-chart-outline', manager: true },
  { id: 'history', label: 'ประวัติการขาย', icon: 'receipt-outline' },
  { id: 'shifts', label: 'กะการขาย', icon: 'time-outline' },
  { id: 'expenses', label: 'ค่าใช้จ่าย / ลิ้นชัก', icon: 'wallet-outline' },
  { id: 'staff', label: 'พนักงาน', icon: 'people-outline', manager: true },
  { id: 'stock', label: 'สต็อกสินค้า', icon: 'shirt-outline' },
  { id: 'skus', label: 'สต็อกสินค้า (คุณสมบัติ)', icon: 'barcode-outline' },
  { id: 'shipments', label: 'ส่งของจากโรงงาน', icon: 'cube-outline', manager: true },
  { id: 'branches', label: 'สาขา', icon: 'business-outline', manager: true },
  { id: 'settings', label: 'ตั้งค่า', icon: 'settings-outline', manager: true },
];

interface MenuProps {
  route: Route;
  onNavigate: (r: Route) => void;
  /** ช่องค้นหาด้านบนเมนู (หน้าประวัติการขายใช้ค้นหาบิล) */
  header?: ReactNode;
}

/** รายการเมนู + ส่วนท้าย ใช้ร่วมกันทั้ง sidebar และ drawer */
export function NavMenu({ route, onNavigate, header }: MenuProps) {
  const { me, logout } = useSession();
  const badge = useStockBadge();
  return (
    <View style={s.menu}>
      <BranchChip block />
      {header}
      <View style={{ gap: 8 }}>
        {ITEMS.filter((it) => !it.manager || me.role === 'manager').map((it) => {
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
              <Text style={[s.itemText, on && { color: '#fff' }, it.soon && { color: colors.faint }]}>{it.label}</Text>
              {it.soon ? <Text style={s.soon}>เร็ว ๆ นี้</Text> : null}
              {it.id === 'stock' && badge > 0 ? (
                <View style={[s.badge, on && { backgroundColor: '#fff' }]} accessibilityLabel={`สินค้าเหลือน้อยหรือหมด ${badge} รายการ`}>
                  <Text style={[s.badgeText, on && { color: colors.danger }]}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <View style={s.user}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{me.name.slice(0, 1)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.userName} numberOfLines={1}>{me.name}</Text>
          <Text style={s.userRole}>{me.role === 'manager' ? 'ผู้จัดการ' : 'พนักงานขาย'}</Text>
        </View>
        <Pressable
          onPress={logout}
          style={({ hovered }: { hovered?: boolean }) => [s.logout, hovered && { backgroundColor: colors.dangerSoft }]}
          accessibilityLabel="ออกจากระบบ"
        >
          <Icon name="log-out-outline" size={18} color={colors.danger} />
          <Text style={s.logoutText}>ออก</Text>
        </Pressable>
      </View>
      <UpdateButton block />
      <View style={s.footer}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={s.brand}>Clothing POS</Text>
          <Text style={s.brandSub}>• ระบบขายหน้าร้าน</Text>
        </View>
        <Text style={s.tagline}>ขายง่าย เปลี่ยนไซซ์ได้ สต็อกตรงทุกชิ้น</Text>
        <View style={s.footRow}>
          <Text style={s.footChip}>© 2026</Text>
          <Text style={s.footChip}>v0.4</Text>
          <AppVersionChip style={s.footChip} />
        </View>
        <Credit />
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
  sidebar: { backgroundColor: colors.panel, borderRadius: radius.xl, padding: 12 },
  menu: { flex: 1, gap: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.surface },
  itemOn: { backgroundColor: colors.primary },
  itemHover: { backgroundColor: '#EDF0F5' },
  itemText: { fontFamily: font, fontSize: 14, color: colors.text, flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: font, fontSize: 11, fontWeight: '700', color: '#fff' },
  soon: { fontFamily: font, fontSize: 10, color: colors.faint },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface },
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
  drawer: { width: 290, maxWidth: '86%', backgroundColor: colors.panel, padding: 14, gap: 10 },
  drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  drawerTitle: { fontFamily: font, fontSize: 18, fontWeight: '600', color: colors.text },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
