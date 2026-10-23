import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { api } from './src/api';
import { useAppSettings } from './src/appSettings';
import { desktop } from './src/desktop';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavDrawer, refreshStockBadge, REPORT_ROUTES, type Route } from './src/components/NavMenu';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ProductReportScreen } from './src/screens/ProductReportScreen';
import { BillReportScreen } from './src/screens/BillReportScreen';
import { SalesReportScreen } from './src/screens/SalesReportScreen';
import { BranchScreen } from './src/screens/BranchScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SkuStockScreen } from './src/screens/SkuStockScreen';
import { StockScreen } from './src/screens/StockScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ShiftScreen } from './src/screens/ShiftScreen';
import { ExpenseScreen } from './src/screens/ExpenseScreen';
import { StaffScreen } from './src/screens/StaffScreen';
import { ShipmentScreen } from './src/screens/ShipmentScreen';
import { auth, SessionContext, type Me } from './src/session';
import { SalesScreen } from './src/screens/SalesScreen';
import { colors } from './src/theme';

/** โหลดฟอนต์ไทย (IBM Plex Sans Thai) บนเว็บ — ถ้าออฟไลน์จะใช้ฟอนต์ระบบแทน */
function useWebFont() {
  useEffect(() => {
    if (Platform.OS !== 'web' || document.getElementById('pos-font')) return;
    const link = document.createElement('link');
    link.id = 'pos-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);
}

/** จำหน้าปัจจุบันไว้ใน URL (#history / #shifts) เพื่อให้กด refresh แล้วอยู่หน้าเดิม */
function useRoute(): [Route, (r: Route) => void] {
  const read = (): Route => {
    if (Platform.OS !== 'web') return 'sales';
    const h = window.location.hash.slice(1);
    const routes: Route[] = ['history', 'shifts', 'expenses', 'staff', 'dashboard', 'salesReport', 'billReport', 'productReport', 'stock', 'skus', 'shipments', 'branches', 'settings'];
    return (routes as string[]).includes(h) ? (h as Route) : 'sales';
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onHash = () => setRoute(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((r: Route) => {
    setRoute(r);
    if (Platform.OS === 'web') window.location.hash = r === 'sales' ? '' : r;
  }, []);
  return [route, go];
}

export default function App() {
  useWebFont();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(() => !!auth.get());

  // ตรวจ token เดิม (refresh หน้าแล้วยังอยู่ในระบบ)
  useEffect(() => {
    auth.onExpired(() => setMe(null));
    if (!auth.get()) return;
    api
      .me()
      .then(setMe)
      .catch(() => auth.set(null))
      .finally(() => setChecking(false));
    return () => auth.onExpired(null);
  }, []);

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    auth.set(null);
    setMe(null);
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="dark" />
        {checking ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : me ? (
          <SessionContext.Provider value={{ me, logout }}>
            {/* key = พนักงาน → เปลี่ยนคนแล้วเริ่มหน้าขายใหม่ (ตะกร้าไม่ปนกัน) */}
            <Main key={me.id} me={me} />
          </SessionContext.Provider>
        ) : (
          <LoginScreen onLogin={setMe} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Main({ me }: { me: Me }) {
  const [route, go] = useRoute();
  const [drawer, setDrawer] = useState(false);
  const [stockVersion, setStockVersion] = useState(0);

  const { shop } = useAppSettings();
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const page: Partial<Record<Route, string>> = {
      history: 'ประวัติการขาย', shifts: 'กะการขาย', expenses: 'ค่าใช้จ่าย', staff: 'พนักงาน', dashboard: 'รายงานรวม', salesReport: 'รายงานยอดขาย', billReport: 'รายงานยอดขายรายบิล', productReport: 'รายงานสินค้า', stock: 'สต็อกสินค้า', skus: 'สต็อกสินค้า (คุณสมบัติ)', shipments: 'ส่งของจากโรงงาน', branches: 'สาขา', settings: 'ตั้งค่า',
    };
    // ชื่อสาขาบนแท็บเบราว์เซอร์ — เปิดหลายสาขาพร้อมกันก็แยกออก
    const branch = shop.branchName || shop.name;
    document.title = [page[route], branch, 'Clothing POS'].filter(Boolean).join(' · ');
  }, [route, shop.branchName, shop.name]);

  // แอปเดสก์ท็อป: หัวหน้าต่าง "Clothing POS - Version: x | ร้าน <ร้าน>, <สาขา> | <IP>"
  useEffect(() => {
    const d = desktop();
    d?.setTitleInfo?.({ shop: shop.name, branch: shop.branchName && shop.branchName !== shop.name ? shop.branchName : '' });
    return () => d?.setTitleInfo?.({ shop: '', branch: '' }); // ออกจากระบบ
  }, [shop.name, shop.branchName]);

  // ป้ายแจ้งเตือนสต็อกบนเมนู: โหลดใหม่เมื่อเปลี่ยนหน้า/สต็อกเปลี่ยน (ขาย คืน แก้บิล)
  useEffect(() => {
    refreshStockBadge();
  }, [route, stockVersion]);

  // หน้าพนักงานเฉพาะผู้จัดการ
  useEffect(() => {
    if ((route === 'staff' || REPORT_ROUTES.includes(route) || route === 'settings' || route === 'branches' || route === 'shipments') && me.role !== 'manager') go('sales');
  }, [route, me.role, go]);

  return (
    <>
      {/* หน้าขายไม่ถูก unmount → ตะกร้าที่ค้างไว้ไม่หายเมื่อสลับไปดูประวัติ */}
      <View style={{ flex: 1, display: route === 'sales' ? 'flex' : 'none' }}>
        <SalesScreen onMenu={() => setDrawer(true)} active={route === 'sales'} stockVersion={stockVersion} />
      </View>
      {route === 'history' ? (
        <HistoryScreen onNavigate={go} onStockChanged={() => setStockVersion((v) => v + 1)} />
      ) : null}
      {route === 'expenses' ? <ExpenseScreen onNavigate={go} onDrawerChanged={() => setStockVersion((v) => v + 1)} /> : null}
      {route === 'shifts' ? <ShiftScreen onNavigate={go} onShiftChanged={() => setStockVersion((v) => v + 1)} /> : null}
      {route === 'staff' && me.role === 'manager' ? <StaffScreen onNavigate={go} /> : null}
      {route === 'dashboard' && me.role === 'manager' ? <DashboardScreen onNavigate={go} /> : null}
      {route === 'salesReport' && me.role === 'manager' ? <SalesReportScreen onNavigate={go} /> : null}
      {route === 'billReport' && me.role === 'manager' ? <BillReportScreen onNavigate={go} /> : null}
      {route === 'productReport' && me.role === 'manager' ? <ProductReportScreen onNavigate={go} /> : null}
      {route === 'stock' ? <StockScreen onNavigate={go} onStockChanged={() => setStockVersion((v) => v + 1)} /> : null}
      {route === 'settings' && me.role === 'manager' ? <SettingsScreen onNavigate={go} onSettingsChanged={() => setStockVersion((v) => v + 1)} /> : null}
      {route === 'branches' && me.role === 'manager' ? <BranchScreen onNavigate={go} /> : null}
      {route === 'shipments' && me.role === 'manager' ? <ShipmentScreen onNavigate={go} onStockChanged={() => setStockVersion((v) => v + 1)} /> : null}
      {route === 'skus' ? <SkuStockScreen onNavigate={go} onStockChanged={() => setStockVersion((v) => v + 1)} /> : null}
      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route={route} onNavigate={go} />
    </>
  );
}
