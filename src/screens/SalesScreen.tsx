import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { CartPanel } from '../components/CartPanel';
import { CategoryTabs } from '../components/CategoryTabs';
import { Icon } from '../components/Icon';
import { OrdersModal } from '../components/OrdersModal';
import { HeldBillsSheet } from '../components/HeldBills';
import { PaymentModal } from '../components/PaymentModal';
import { ProductCard } from '../components/ProductCard';
import { ResizeHandle } from '../components/ResizeHandle';
import { ReceiptView } from '../components/ReceiptView';
import { Sheet } from '../components/Sheet';
import { ToastView } from '../components/ToastView';
import { TopBar } from '../components/TopBar';
import { VariantModal } from '../components/VariantModal';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { CloseShiftDialog } from '../components/shift/CloseShiftDialog';
import { OpenShiftDialog } from '../components/shift/OpenShiftDialog';
import { api } from '../api';
import { auth, useSession } from '../session';
import { CART_MIN, GRID_GAP, maxCartW, useCartWidth, useDefaultViewMode, useResponsive, useViewMode } from '../layout';
import { beep, useAppSettings } from '../appSettings';
import { baht } from '../format';
import { printReceipt } from '../print';
import { desktop } from '../desktop';
import { hasThai, inModal, isEditable, thaiToEn } from '../scanInput';
import { usePos } from '../store/usePos';
import { colors, font, radius } from '../theme';
import type { Order, PaymentMethod, Product, Shift } from '../types';

function confirmAction(message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onYes();
  } else {
    Alert.alert('ยืนยัน', message, [{ text: 'ยกเลิก', style: 'cancel' }, { text: 'ตกลง', onPress: onYes }]);
  }
}

interface Props {
  onMenu: () => void;
  /** หน้าขายกำลังแสดงอยู่ */
  active: boolean;
  /** เพิ่มขึ้นเมื่อมีการแก้ไข/ยกเลิกบิล → โหลดสต็อกใหม่ */
  stockVersion: number;
}

export function SalesScreen({ onMenu, active, stockVersion }: Props) {
  const pos = usePos();
  const firstStock = useRef(stockVersion);
  useEffect(() => {
    if (active && stockVersion !== firstStock.current) {
      firstStock.current = stockVersion;
      pos.reload();
    }
  }, [active, stockVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const [viewMode, setViewMode] = useViewMode();
  const settings = useAppSettings();
  useDefaultViewMode(settings.display.defaultView, setViewMode);
  // ลากขอบซ้ายของตะกร้าเพื่อปรับความกว้าง (จำไว้ในเครื่องนี้)
  const [cartWidth, setCartWidth] = useCartWidth();
  const L = useResponsive(viewMode, cartWidth);
  const wide = L.sideCart;
  const mobile = L.device === 'mobile';

  const [category, setCategory] = useState('all');
  const [query, setQueryState] = useState('');
  // ค่าล่าสุดของช่องค้นหา (อัปเดตทันที ไม่รอ render) — ตัวดักแป้นสแกนต่อท้ายจากค่านี้ ตัวอักษรจึงไม่หาย
  const queryRef = useRef('');
  const setQuery = useCallback((v: string) => {
    queryRef.current = v;
    setQueryState(v);
  }, []);
  const deferredQuery = useDeferredValue(query);
  const [picked, setPicked] = useState<Product | null>(null);
  const [payOpen, setPayOpen] = useState<null | 'select' | 'checkout'>(null);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [needShift, setNeedShift] = useState(false);
  const [closing, setClosing] = useState<Shift | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const { me, logout } = useSession();

  // พนักงานขายเริ่มต้น = ผู้ที่เข้าสู่ระบบ
  useEffect(() => {
    if (!pos.salesperson) pos.setSalesperson(me.name);
  }, [me.name, pos.salesperson]); // eslint-disable-line react-hooks/exhaustive-deps

  // เข้าสู่ระบบแล้วยังไม่ได้เปิดกะ → เด้งให้แจงเงินตั้งต้นทันที (ครั้งเดียวต่อการเข้าสู่ระบบ · กด "ข้ามไปก่อน" ได้)
  const [welcome, setWelcome] = useState(false);
  const promptKey = `pos.shiftPrompt.${(auth.get() ?? '').slice(-12)}`;
  useEffect(() => {
    if (!active || !pos.data || pos.data.shift) return;
    try {
      if (globalThis.sessionStorage?.getItem(promptKey)) return;
      globalThis.sessionStorage?.setItem(promptKey, '1');
    } catch {
      /* ignore */
    }
    setWelcome(true);
  }, [active, pos.data, promptKey]);

  /** ปุ่ม ปิดกะทำงาน / เปิดกะ ข้างปุ่มยกเลิกรายการ */
  const onShiftButton = async () => {
    if (!pos.data?.shift) return setNeedShift(true);
    try {
      const r = await api.currentShift();
      if (r.shift) setClosing(r.shift);
      else {
        pos.reload();
        setNeedShift(true);
      }
    } catch (e) {
      pos.notify('error', (e as Error).message);
    }
  };
  const searchRef = useRef<TextInput>(null);

  const { data, index } = pos;

  const catName = useMemo(() => new Map(data?.categories.map((c) => [c.id, c.name]) ?? []), [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = deferredQuery.trim().toLowerCase();
    const hideOut = settings.display.hideOutOfStock;
    return data.products.filter(
      (p) =>
        (category === 'all' || p.categoryId === category) &&
        (!hideOut || (index.stockByProduct.get(p.id) ?? 0) > 0) &&
        (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q)),
    );
  }, [data, category, deferredQuery, settings.display.hideOutOfStock, index]);

  const cartQty = useMemo(() => new Map(pos.cart.map((l) => [l.variantId, l.qty])), [pos.cart]);
  const inCartByVariant = useCallback((id: number) => pos.cart.find((l) => l.variantId === id)?.qty ?? 0, [pos.cart]);


  const onPick = useCallback((p: Product) => setPicked(p), []);
  const onAdd = useCallback((variantId: number) => pos.addToCart(variantId, 1), [pos.addToCart]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSearchSubmit = () => submitCode(queryRef.current);
  /** สแกน/พิมพ์รหัสแล้วกด Enter — ถ้าแป้นพิมพ์เป็นภาษาไทยอยู่ ลองแปลงเป็นตัวอักษรอังกฤษให้ */
  const submitCode = (raw: string, scanned = false) => {
    let r = pos.addBySku(raw);
    if (!r && hasThai(raw)) r = pos.addBySku(thaiToEn(raw));
    if (scanned) {
      // สแกนจากเครื่องสแกน: ไม่แตะช่องค้นหา/การ์ดสินค้าเลย (หน้าจอไม่กระพริบ)
      if (!raw.trim()) return;
      beep(!!r && r !== 'full');
      if (r && r !== 'added' && r !== 'full') onPick(r); // บาร์โค้ดหลัก → เปิดเลือกสี/ไซซ์
      else if (!r) pos.notify('error', `ไม่พบสินค้า รหัส "${raw.trim()}"`);
      return;
    }
    if (raw.trim()) beep((!!r && r !== 'full') || filtered.length === 1);
    if (r === 'added' || r === 'full') {
      setQuery('');
    } else if (r) {
      setQuery('');
      onPick(r); // บาร์โค้ดหลัก → เปิดเลือกสี/ไซซ์
    } else if (filtered.length === 1) onPick(filtered[0]);
    else if (raw.trim() && !/\s/.test(raw.trim())) {
      // รหัสที่สแกนไม่พบ และไม่ตรงกับชื่อสินค้าใด → แจ้ง แล้วล้างช่อง (สแกนชิ้นต่อไปได้เลย ไม่ต่อท้ายรหัสเก่า)
      const key = raw.trim().toLowerCase();
      const nameHit = data?.products.some((p) => p.name.toLowerCase().includes(key));
      if (!nameHit) {
        pos.notify('error', `ไม่พบสินค้า รหัส "${raw.trim()}"`);
        setQuery('');
      }
    }
  };

  // สแกนได้ทันทีโดยไม่ต้องคลิกช่องค้นหา: กดแป้น/สแกนตอนที่ไม่ได้พิมพ์อยู่ในช่องอื่น → ส่งเข้าช่องค้นหา
  const submitRef = useRef(submitCode);
  submitRef.current = submitCode;
  useEffect(() => {
    if (Platform.OS !== 'web' || !active || typeof window === 'undefined') return;
    // เครื่องสแกนส่งตัวอักษรรัว ๆ (ห่างกันไม่กี่ ms) แล้วตามด้วย Enter → เก็บไว้ใน buffer แยก ไม่ใส่ช่องค้นหา
    // การ์ดสินค้าจึงไม่ถูกกรอง/รีเฟรชระหว่างสแกน · ถ้าหยุดพิมพ์เกิน 60ms (คนพิมพ์เอง) ค่อยย้ายลงช่องค้นหา
    let buf = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!buf) return;
      setQuery(queryRef.current + buf);
      buf = '';
    };
    const isSearch = (t: EventTarget | null) => (t as HTMLElement | null)?.id === 'pos-search';
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const search = isSearch(e.target);
      if (!search && (isEditable(e.target) || inModal(e.target) || inModal(document.activeElement))) return;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'Enter') {
        if (buf) {
          stop();
          const code = buf;
          buf = '';
          if (timer) clearTimeout(timer);
          timer = undefined;
          submitRef.current(code, true);
          return;
        }
        if (!queryRef.current.trim()) return;
        stop();
        submitRef.current(queryRef.current);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Escape') {
        flush();
        if (search && e.key === 'Backspace') return; // ลบในช่องค้นหาตามปกติ
        if (!queryRef.current) return;
        stop();
        setQuery(e.key === 'Escape' ? '' : queryRef.current.slice(0, -1));
        return;
      }
    };
    // ตัวอักษร: รับจาก keypress (ไม่ใช่ keydown) เพราะเครื่องสแกนบางรุ่นส่งเป็นรหัส Alt+ตัวเลข (Alt+4+9 = "1")
    // ซึ่ง keydown เห็นแค่ปุ่ม Alt/ตัวเลขบนแป้นตัวเลข — ตัวอักษรจริงมาถึงตอน keypress / beforeinput
    const take = (e: Event, ch: string, target: EventTarget | null) => {
      const search = isSearch(target);
      if (!search && (isEditable(target) || inModal(target) || inModal(document.activeElement))) return;
      if (ch === ' ' && !queryRef.current && !buf) return;
      if (search) {
        const el = target as HTMLInputElement;
        if (el.selectionStart !== el.selectionEnd || el.selectionEnd !== el.value.length) {
          flush(); // กำลังแก้กลางข้อความ / เลือกข้อความอยู่ → ให้ช่องพิมพ์จัดการเอง
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
      buf += ch;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 60);
    };
    const onPress = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.key === 'Enter' || e.key.length !== 1) return;
      take(e, e.key, e.target);
    };
    // สำรอง: ถ้าตัวอักษรหลุดมาถึงช่องค้นหาโดยไม่ผ่าน keypress
    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.defaultPrevented || ie.inputType !== 'insertText' || !ie.data || !isSearch(ie.target)) return;
      if ([...ie.data].length !== 1) return;
      take(ie, ie.data, ie.target);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keypress', onPress, true);
    window.addEventListener('beforeinput', onBeforeInput, true);
    // คอมพิวเตอร์ (มีเมาส์): หลังคลิก ดึงโฟกัสกลับไปที่ช่องค้นหา เมื่อไม่ได้คลิกช่องพิมพ์อื่นและไม่มีหน้าต่างเปิดทับ
    // (แท็บเล็ต/มือถือไม่ทำ เพื่อไม่ให้คีย์บอร์ดบนจอเด้งขึ้นเอง — ใช้การดักแป้นด้านบนแทน)
    const finePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    const refocus = () => {
      const el = document.activeElement;
      if (isEditable(el) || document.querySelector('[role="dialog"]')) return;
      searchRef.current?.focus();
    };
    const onPointerUp = () => setTimeout(refocus, 0);
    if (finePointer) {
      refocus();
      window.addEventListener('pointerup', onPointerUp, true);
    }
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keypress', onPress, true);
      window.removeEventListener('beforeinput', onBeforeInput, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      if (timer) clearTimeout(timer);
    };
  }, [active]);

  const doPlace = async (pay?: { method: PaymentMethod; cashReceived?: number }) => {
    // ต้องเปิดกะก่อนขาย (เงินสดจะถูกลงบัญชีลิ้นชักของกะ)
    if (!pos.data?.shift) {
      setPayOpen(null);
      setNeedShift(true);
      return;
    }
    let order: Awaited<ReturnType<typeof pos.placeOrder>> = null;
    try {
      order = await pos.placeOrder(pay);
    } catch {
      setPayOpen(null);
      setNeedShift(true);
      return;
    }
    if (order) {
      setPayOpen(null);
      setCartOpen(false);
      setReceipt(order);
      // แอปเดสก์ท็อป: เปิดลิ้นชักเงินตามตั้งค่าเครื่องนี้ (เปิดเฉพาะตอนขาย ไม่เปิดตอนพิมพ์ซ้ำ)
      desktop()?.openDrawer?.({ cash: order.paymentMethod === 'cash' });
      if (settings.receipt.autoPrint) printReceipt(order); // ตั้งค่า → ใบเสร็จ → พิมพ์อัตโนมัติ
    }
  };

  const onPlace = () => {
    if (!pos.data?.shift) setNeedShift(true);
    else if (!pos.payment) setPayOpen('checkout');
    else doPlace();
  };

  // ---------- loading / error ----------
  if (!data) {
    return (
      <View style={[s.root, s.center]}>
        {pos.loadError ? (
          <>
            <Icon name="cloud-offline-outline" size={40} color={colors.sub} />
            <Text style={s.loadText}>{pos.loadError}</Text>
            <Pressable style={s.retry} onPress={pos.reload}>
              <Text style={s.retryText}>ลองใหม่</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator size="large" color={colors.primary} />
        )}
      </View>
    );
  }

  const cartPanel = (
    <CartPanel pos={pos} onPayment={() => setPayOpen('select')} onPlace={onPlace} />
  );

  return (
    <View style={s.root}>
      <View style={[s.layout, { padding: L.pad, gap: 14 }]}>
        {/* ---------- left: catalogue ---------- */}
        <View style={[s.left, mobile && { gap: 10 }]}>
          <TopBar
            onMenu={onMenu}
            onCloseOrder={() => confirmAction('ยกเลิกรายการขายปัจจุบันทั้งหมด?', pos.resetOrder)}
            onRefresh={() => { pos.reload(); pos.notify('success', 'อัปเดตข้อมูลสินค้าแล้ว'); }}
            canClose={pos.cart.length > 0 || !!pos.customerName}
            compact={L.width < 700}
            shiftOpen={!!data.shift}
            onShift={onShiftButton}
            heldCount={pos.held.length}
            canHold={pos.cart.length > 0}
            onHeld={() => setHeldOpen(true)}
          />
          <CategoryTabs
            categories={data.categories}
            counts={index.countByCategory}
            total={data.products.length}
            active={category}
            onChange={setCategory}
            compact={mobile}
          />
          <View style={s.searchRow}>
          <View style={s.search}>
            <TextInput
              ref={searchRef}
              nativeID="pos-search"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={onSearchSubmit}
              blurOnSubmit={false} // สแกนเสร็จ (Enter) โฟกัสยังอยู่ที่ช่องค้นหา → สแกนชิ้นต่อไปได้เลย
              placeholder="ค้นหาสินค้า หรือสแกนบาร์โค้ด / รหัส SKU…"
              placeholderTextColor={colors.faint}
              style={s.searchInput}
              autoFocus={Platform.OS === 'web'}
              returnKeyType="search"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} style={{ marginRight: 4 }} accessibilityLabel="ล้างคำค้นหา">
                <Icon name="close-circle" size={18} color={colors.faint} />
              </Pressable>
            ) : null}
            <View style={s.searchIcon}>
              <Icon name="search" size={18} />
            </View>
          </View>
          {!mobile ? <ViewModeToggle value={viewMode} maxCols={L.maxCols} onChange={setViewMode} /> : null}
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 80 }}
            keyboardShouldPersistTaps="handled"
          >
            {filtered.length === 0 ? (
              <View style={s.noResult}>
                <Icon name="search-outline" size={30} color={colors.faint} />
                <Text style={s.loadText}>ไม่พบสินค้า “{query}”</Text>
              </View>
            ) : (
              // กริดแบบเปอร์เซ็นต์: ไม่ต้องวัดขนาดหน้าจอ → ไม่มีช่องว่างเหลือด้านขวา
              <View style={s.grid}>
                {filtered.map((p) => (
                  <View key={p.id} style={{ width: `${100 / L.cols}%`, padding: GRID_GAP / 2 }}>
                    <ProductCard
                      product={p}
                      categoryName={catName.get(p.categoryId) ?? ''}
                      variants={index.variantsByProduct.get(p.id) ?? []}
                      cartQty={cartQty}
                      width={L.cardW}
                      onAdd={onAdd}
                      onOpen={onPick}
                      display={settings.display}
                      allowNegative={settings.stock.allowNegative}
                    />
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          <Pressable style={s.track} onPress={() => setOrdersOpen(true)}>
            <Text style={s.trackText}>รายการขาย</Text>
            <View style={s.trackPlus}>
              <Icon name="time-outline" size={14} color={colors.primary} />
            </View>
          </Pressable>
        </View>

        {/* ---------- right: current order ---------- */}
        {wide ? (
          <View style={{ width: L.cartW }}>
            <ResizeHandle
              width={L.cartW}
              onResize={(w) => setCartWidth(Math.round(Math.min(maxCartW(L.width), Math.max(CART_MIN, w))))}
              onReset={() => setCartWidth(null)}
            />
            {cartPanel}
          </View>
        ) : null}
      </View>

      {/* จอแคบ (แท็บเล็ตแนวตั้ง/มือถือ): แถบตะกร้าด้านล่าง */}
      {!wide ? (
        <Pressable style={s.cartBar} onPress={() => setCartOpen(true)}>
          <View style={s.cartCount}>
            <Text style={s.cartCountText}>{pos.itemCount}</Text>
          </View>
          <Text style={s.cartBarText}>ดูรายการขาย</Text>
          <Text style={s.cartBarTotal}>{baht(pos.totals.total)}</Text>
        </Pressable>
      ) : null}
      {!wide ? (
        <Modal visible={cartOpen} animationType="slide" onRequestClose={() => setCartOpen(false)}>
          <View style={{ flex: 1, backgroundColor: colors.bg, padding: 10 }}>
            <Pressable style={s.backBtn} onPress={() => setCartOpen(false)}>
              <Icon name="chevron-back" size={18} />
              <Text style={s.backText}>กลับไปเลือกสินค้า</Text>
            </Pressable>
            {cartPanel}
          </View>
        </Modal>
      ) : null}

      <VariantModal
        product={picked}
        variants={picked ? index.variantsByProduct.get(picked.id) ?? [] : []}
        inCartQty={inCartByVariant}
        onClose={() => setPicked(null)}
        onAdd={(id, qty) => {
          pos.addToCart(id, qty);
          setPicked(null);
        }}
      />

      <PaymentModal
        visible={payOpen !== null}
        mode={payOpen ?? 'select'}
        total={pos.totals.goods}
        initial={pos.payment}
        onClose={() => setPayOpen(null)}
        onConfirm={(p) => {
          pos.setPayment(p);
          if (payOpen === 'checkout') doPlace(p);
          else setPayOpen(null);
        }}
      />

      <Sheet
        visible={!!receipt}
        onClose={() => setReceipt(null)}
        width={440}
        footer={
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={[s.btn, s.btnGhost]} onPress={() => receipt && printReceipt(receipt)}>
              <Icon name="print-outline" size={18} color={colors.text} />
              <Text style={s.btnGhostText}>พิมพ์ใบเสร็จ</Text>
            </Pressable>
            <Pressable style={[s.btn, s.btnPrimary]} onPress={() => { setReceipt(null); searchRef.current?.focus(); }}>
              <Text style={s.btnPrimaryText}>ขายรายการถัดไป</Text>
            </Pressable>
          </View>
        }
      >
        {receipt ? (
          <View>
            <View style={s.successHead}>
              <View style={s.successIcon}>
                <Icon name="checkmark" size={30} color="#fff" />
              </View>
              <Text style={s.successTitle}>บันทึกการขายสำเร็จ</Text>
              <Text style={s.successNo}>{receipt.orderNo}</Text>
              {receipt.changeDue ? <Text style={s.change}>เงินทอน {baht(receipt.changeDue)}</Text> : null}
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
              <ReceiptView order={receipt} compact />
            </ScrollView>
          </View>
        ) : null}
      </Sheet>

      <OrdersModal visible={ordersOpen} onClose={() => setOrdersOpen(false)} />
      <HeldBillsSheet visible={heldOpen} onClose={() => setHeldOpen(false)} pos={pos} />
      {closing ? (
        <CloseShiftDialog
          visible
          shift={closing}
          onClose={() => setClosing(null)}
          onClosed={() => {
            setClosing(null);
            pos.reload();
          }}
          onLogout={logout}
        />
      ) : null}
      <OpenShiftDialog
        visible={welcome && !needShift}
        onClose={() => setWelcome(false)}
        onSkip={() => setWelcome(false)}
        onOpened={(sh) => {
          setWelcome(false);
          pos.reload();
          pos.notify('success', `เปิดกะ #${sh.shiftNo} แล้ว · เงินตั้งต้น ${baht(sh.openingCash)} · เริ่มขายได้เลย`);
        }}
      />
      <OpenShiftDialog
        visible={needShift}
        hint="ยังไม่ได้เปิดกะ — กรุณาเปิดกะและนับเงินตั้งต้นในลิ้นชักก่อนเริ่มขาย รายการในตะกร้ายังอยู่ครบ"
        onClose={() => setNeedShift(false)}
        onOpened={(sh) => {
          setNeedShift(false);
          pos.reload();
          pos.notify('success', `เปิดกะ #${sh.shiftNo} แล้ว · กดยืนยันการขายได้เลย`);
        }}
      />
      <ToastView toast={pos.toast} onDone={pos.clearToast} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadText: { fontFamily: font, color: colors.sub, fontSize: 14, marginTop: 6 },
  retry: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.pill, marginTop: 6 },
  retryText: { fontFamily: font, color: '#fff', fontWeight: '600' },
  layout: { flex: 1, flexDirection: 'row' },
  left: { flex: 1, gap: 12, minWidth: 0 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.panel, borderRadius: radius.pill,
    paddingLeft: 18, paddingRight: 5, height: 48,
  },
  searchInput: { flex: 1, fontFamily: font, fontSize: 14, color: colors.text, height: '100%', outlineStyle: 'none' } as object,
  searchIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -GRID_GAP / 2 },
  noResult: { alignItems: 'center', paddingVertical: 60 },
  track: {
    position: 'absolute', left: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.primary, paddingLeft: 16, paddingRight: 8, height: 42, borderRadius: radius.md,
  },
  trackText: { fontFamily: font, color: '#fff', fontSize: 13, fontWeight: '500' },
  trackPlus: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cartBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, margin: 10, marginTop: 0, height: 56, borderRadius: radius.md,
    backgroundColor: colors.primary, paddingHorizontal: 16,
  },
  cartCount: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  cartCountText: { fontFamily: font, color: colors.primary, fontWeight: '700' },
  cartBarText: { fontFamily: font, color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  cartBarTotal: { fontFamily: font, color: '#fff', fontSize: 17, fontWeight: '700' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10 },
  backText: { fontFamily: font, fontSize: 14, color: colors.text },
  successHead: { alignItems: 'center', paddingTop: 14, paddingBottom: 12 },
  successIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontFamily: font, fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 12 },
  successNo: { fontFamily: font, fontSize: 13, color: colors.sub, marginTop: 2 },
  change: { fontFamily: font, fontSize: 16, fontWeight: '700', color: colors.success, marginTop: 8, backgroundColor: colors.successSoft, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill },
  btn: { flex: 1, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  btnGhost: { borderWidth: 1.5, borderColor: colors.line },
  btnGhostText: { fontFamily: font, fontSize: 14, color: colors.text, fontWeight: '500' },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '600' },
});
