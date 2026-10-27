// สถานะหน้าขาย: สินค้า · ตะกร้า · ส่วนลด · ชำระเงิน · แจ้งเตือน (toast)
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { api, ApiError, type HeldBill } from '../api';
import { allowNegativeStock, feeOf, sellableStock, setAppSettings, useAppSettings } from '../appSettings';
import { computeTotals, variantLabel } from '../format';
import { useSession } from '../session';
import type { Bootstrap, CartLine, Order, PaymentMethod, Product, Promo, Variant } from '../types';

// ---------------- ตะกร้าค้าง (กันรีเฟรช/ปิดแท็บโดยไม่ตั้งใจ) ----------------
interface CartDraft {
  cart: CartLine[];
  customerName: string;
  salesperson: string | null;
  orderType: string | null;
  promo: Promo | null;
}
const draftStore = {
  read(key: string): CartDraft | null {
    try {
      const raw = globalThis.sessionStorage?.getItem(key);
      return raw ? (JSON.parse(raw) as CartDraft) : null;
    } catch {
      return null;
    }
  },
  write(key: string, d: CartDraft | null) {
    try {
      if (d) globalThis.sessionStorage?.setItem(key, JSON.stringify(d));
      else globalThis.sessionStorage?.removeItem(key);
    } catch {
      /* เก็บไม่ได้ (โหมดส่วนตัว/พื้นที่เต็ม) → ใช้งานต่อได้ตามปกติ */
    }
  },
};

// ---------------- cart reducer ----------------
type CartAction =
  | { type: 'add'; variantId: number; productId: number; qty: number; max: number }
  | { type: 'set'; variantId: number; qty: number; max: number }
  | { type: 'remove'; variantId: number }
  | { type: 'clear' }
  | { type: 'replace'; lines: CartLine[] };

function cartReducer(state: CartLine[], a: CartAction): CartLine[] {
  switch (a.type) {
    case 'add': {
      const i = state.findIndex((l) => l.variantId === a.variantId);
      if (i === -1) return [...state, { variantId: a.variantId, productId: a.productId, qty: Math.min(a.qty, a.max) }];
      const next = state.slice();
      next[i] = { ...next[i], qty: Math.min(next[i].qty + a.qty, a.max) };
      return next;
    }
    case 'set':
      if (a.qty <= 0) return state.filter((l) => l.variantId !== a.variantId);
      return state.map((l) => (l.variantId === a.variantId ? { ...l, qty: Math.min(a.qty, a.max) } : l));
    case 'remove':
      return state.filter((l) => l.variantId !== a.variantId);
    case 'clear':
      return [];
    case 'replace':
      return a.lines;
  }
}

export interface Toast {
  id: number;
  kind: 'error' | 'success' | 'info';
  text: string;
}

export interface CartRow {
  line: CartLine;
  product: Product;
  variant: Variant;
  lineTotal: number;
}

export function usePos() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, dispatch] = useReducer(cartReducer, []);
  const [customerName, setCustomerName] = useState('');
  const [salesperson, setSalesperson] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<string | null>(null);
  const [promo, setPromo] = useState<Promo | null>(null);
  const [payment, setPayment] = useState<{ method: PaymentMethod; cashReceived?: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback((kind: Toast['kind'], text: string) => {
    setToast({ id: Date.now(), kind, text });
  }, []);

  // ตะกร้าค้างแยกตามพนักงาน + สาขา (sessionStorage: รีเฟรชแล้วยังอยู่, ปิดแท็บแล้วหาย)
  const { me } = useSession();
  const draftKey = `pos.cart.${me.id}.${me.branchId}`;
  const [restoredKey, setRestoredKey] = useState<string | null>(null);

  const clearToast = useCallback(() => setToast(null), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const b = await api.bootstrap();
      setAppSettings(b.settings);
      setData(b);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ---------- lookup indexes (O(1) access) ----------
  const index = useMemo(() => {
    const products = new Map<number, Product>();
    const variants = new Map<number, Variant>();
    const variantsByProduct = new Map<number, Variant[]>();
    const variantBySku = new Map<string, Variant>();
    const productByBarcode = new Map<string, Product>();
    const stockByProduct = new Map<number, number>();
    const countByCategory = new Map<string, number>();
    if (data) {
      for (const p of data.products) {
        products.set(p.id, p);
        if (p.barcode) productByBarcode.set(p.barcode.toUpperCase(), p);
        productByBarcode.set(p.sku.toUpperCase(), p);
        countByCategory.set(p.categoryId, (countByCategory.get(p.categoryId) ?? 0) + 1);
      }
      for (const v of data.variants) {
        variants.set(v.id, v);
        variantBySku.set(v.sku.toUpperCase(), v);
        if (v.barcode) variantBySku.set(v.barcode.toUpperCase(), v);
        const arr = variantsByProduct.get(v.productId);
        if (arr) arr.push(v);
        else variantsByProduct.set(v.productId, [v]);
        stockByProduct.set(v.productId, (stockByProduct.get(v.productId) ?? 0) + v.stock);
      }
    }
    return { products, variants, variantsByProduct, variantBySku, productByBarcode, stockByProduct, countByCategory };
  }, [data]);

  // ---------- cart ----------
  const rows: CartRow[] = useMemo(
    () =>
      cart
        .map((line) => {
          const product = index.products.get(line.productId);
          const variant = index.variants.get(line.variantId);
          if (!product || !variant) return null;
          return { line, product, variant, lineTotal: variant.price * line.qty };
        })
        .filter((r): r is CartRow => r !== null),
    [cart, index],
  );

  // โหลดตะกร้าค้างคืน เมื่อข้อมูลสินค้าพร้อม (ตรวจว่าสินค้ายังมี + สต็อกพอ)
  useEffect(() => {
    if (!data || restoredKey === draftKey) return;
    const d = draftStore.read(draftKey);
    if (d && Array.isArray(d.cart) && d.cart.length) {
      const lines: CartLine[] = [];
      for (const l of d.cart) {
        const v = index.variants.get(l.variantId);
        const max = v ? sellableStock(v.stock) : 0;
        if (v && max > 0 && l.qty > 0) lines.push({ variantId: v.id, productId: v.productId, qty: Math.min(l.qty, max) });
      }
      if (lines.length) {
        dispatch({ type: 'replace', lines });
        setCustomerName(d.customerName ?? '');
        if (d.salesperson) setSalesperson(d.salesperson);
        if (d.orderType) setOrderType(d.orderType);
        setPromo(d.promo ?? null);
        const n = lines.reduce((a, l) => a + l.qty, 0);
        const lost = d.cart.reduce((a, l) => a + l.qty, 0) - n;
        notify('info', `กู้คืนตะกร้าเดิม ${n} ชิ้น${lost > 0 ? ` (สต็อกไม่พอ/สินค้าถูกลบ ${lost} ชิ้น)` : ''}`);
      }
    }
    setRestoredKey(draftKey);
  }, [data, index, draftKey, restoredKey, notify]);

  // บันทึกทุกครั้งที่ตะกร้า/ลูกค้า/โค้ดส่วนลดเปลี่ยน (ตะกร้าว่าง = ลบทิ้ง)
  useEffect(() => {
    if (restoredKey !== draftKey) return;
    draftStore.write(draftKey, cart.length ? { cart, customerName, salesperson, orderType, promo } : null);
  }, [cart, customerName, salesperson, orderType, promo, draftKey, restoredKey]);

  // เตือนก่อนปิดแท็บ/รีเฟรช เมื่อมีสินค้าในตะกร้า
  useEffect(() => {
    if (cart.length === 0 || typeof window === 'undefined' || !window.addEventListener) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [cart.length]);

  const itemCount = useMemo(() => cart.reduce((s, l) => s + l.qty, 0), [cart]);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + r.lineTotal, 0), [rows]);

  // ส่วนลดคำนวณใหม่ทุกครั้งที่ยอดเปลี่ยน (และยกเลิกเองถ้ายอดต่ำกว่าขั้นต่ำ)
  const discount = useMemo(() => {
    if (!promo || subtotal < promo.minTotal) return 0;
    const d = promo.type === 'percent' ? (subtotal * promo.value) / 100 : promo.value;
    return Math.min(Math.round(d * 100) / 100, subtotal);
  }, [promo, subtotal]);

  const appSettings = useAppSettings();
  // ค่าธรรมเนียมของวิธีชำระที่เลือก: ถ้าลูกค้าจ่าย บวกเพิ่มในยอดสุทธิ
  const totals = useMemo(() => {
    const f = feeOf(payment?.method, Math.max(0, subtotal - discount));
    const exemptGross = rows.reduce((s, r) => s + (r.product.vatExempt ? r.lineTotal : 0), 0);
    return { ...computeTotals(subtotal, discount, data?.vatRate ?? 0, f?.customer ? f.fee : 0, exemptGross), fee: f };
  }, [subtotal, discount, data, payment, appSettings, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const addToCart = useCallback(
    (variantId: number, qty = 1) => {
      const v = index.variants.get(variantId);
      if (!v) return false;
      const inCart = cart.find((l) => l.variantId === variantId)?.qty ?? 0;
      const max = sellableStock(v.stock);
      const name = `${index.products.get(v.productId)?.name ?? ''} (${variantLabel(v)})`;
      if (max <= 0) {
        notify('error', `${name} หมดสต็อก`);
        return false;
      }
      if (inCart >= max) {
        // สแกนซ้ำแต่สต็อกไม่พอ → ไม่เพิ่ม และบอกให้ชัด (เปิด "ขายได้แม้สต็อกหมด" ที่ ตั้งค่า → สต็อก เพื่อขายเกินได้)
        notify('error', `${name} มีในสต็อก ${v.stock} ชิ้น — อยู่ในบิลครบแล้ว (เปิด "ขายได้แม้สต็อกหมด" ที่ตั้งค่า → สต็อก เพื่อขายเกิน)`);
        return false;
      }
      if (inCart + qty > v.stock) notify('info', allowNegativeStock() ? `ขายเกินสต็อก — คงเหลือจะเป็น ${v.stock - inCart - qty} ชิ้น` : `เหลือในสต็อก ${v.stock} ชิ้น`);
      dispatch({ type: 'add', variantId, productId: v.productId, qty, max });
      return true;
    },
    [index, cart, notify],
  );

  const setQty = useCallback(
    (variantId: number, qty: number) => {
      const v = index.variants.get(variantId);
      if (!v) return;
      if (qty > v.stock && !allowNegativeStock()) notify('info', `เหลือในสต็อก ${v.stock} ชิ้น`);
      dispatch({ type: 'set', variantId, qty, max: sellableStock(v.stock) });
    },
    [index, notify],
  );

  const removeLine = useCallback((variantId: number) => dispatch({ type: 'remove', variantId }), []);

  const resetOrder = useCallback(() => {
    dispatch({ type: 'clear' });
    setCustomerName('');
    setPromo(null);
    setPayment(null);
  }, []);

  /** ค้นหาด้วยรหัส SKU / บาร์โค้ด → เพิ่มลงตะกร้าทันที */
  /**
   * สแกน/พิมพ์รหัส:
   * - รหัส SKU (เช่น 8850001234567-0002) → ลงตะกร้าทันที
   * - บาร์โค้ดหลักของสินค้า → ถ้ามี SKU เดียวลงตะกร้าเลย ไม่งั้นคืนสินค้าให้หน้าขายเปิดเลือกตัวเลือก
   */
  const addBySku = useCallback(
    (code: string): 'added' | 'full' | Product | false => {
      const key = code.trim().toUpperCase();
      if (!key) return false;
      const v = index.variantBySku.get(key);
      if (v) {
        if (!addToCart(v.id, 1)) return 'full';
        const p = index.products.get(v.productId);
        const n = (cart.find((l) => l.variantId === v.id)?.qty ?? 0) + 1;
        notify('success', `เพิ่ม ${p?.name ?? ''} (${variantLabel(v)})${n > 1 ? ` · รวม ${n} ชิ้น` : ''}`);
        return 'added';
      }
      const p = index.productByBarcode.get(key);
      if (!p) return false;
      const vs = index.variantsByProduct.get(p.id) ?? [];
      if (vs.length === 1) {
        if (!addToCart(vs[0].id, 1)) return 'full';
        notify('success', `เพิ่ม ${p.name}`);
        return 'added';
      }
      return p;
    },
    [index, addToCart, notify, cart],
  );

  const applyPromo = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      try {
        const p = await api.promo(code, subtotal);
        setPromo(p);
        notify('success', `ใช้โค้ด ${p.code}: ${p.label}`);
      } catch (e) {
        notify('error', (e as Error).message);
      }
    },
    [subtotal, notify],
  );

  const placeOrder = useCallback(async (override?: { method: PaymentMethod; cashReceived?: number }): Promise<Order | null> => {
    const pay = override ?? payment;
    if (!data || rows.length === 0 || !pay) return null;
    setPlacing(true);
    try {
      const res = await api.placeOrder({
        customerName: customerName || undefined,
        salesperson: salesperson ?? undefined,
        orderType: orderType ?? data.settings?.display.defaultOrderType ?? data.orderTypes[0],
        promoCode: promo && discount > 0 ? promo.code : undefined,
        paymentMethod: pay.method,
        cashReceived: pay.method === 'cash' ? pay.cashReceived : undefined,
        items: cart.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      });
      // อัปเดตสต็อกในเครื่องทันที โดยไม่ต้องโหลดข้อมูลทั้งหมดใหม่
      const stock = new Map(res.stock.map((s) => [s.id, s.stock]));
      setData((d) =>
        d && {
          ...d,
          nextOrderNo: res.nextOrderNo,
          variants: d.variants.map((v) => (stock.has(v.id) ? { ...v, stock: stock.get(v.id)! } : v)),
        },
      );
      const order = { ...res.order, customerName, salesperson };
      resetOrder();
      return order;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_SHIFT') {
        // กะถูกปิดจากเครื่องอื่น → อัปเดตสถานะ แล้วให้หน้าขายเปิดหน้าต่างเปิดกะ
        setData((d) => d && { ...d, shift: null });
        throw e;
      }
      notify('error', (e as Error).message);
      if (e instanceof ApiError && e.status === 409) load(); // สต็อกเปลี่ยน → โหลดใหม่
      return null;
    } finally {
      setPlacing(false);
    }
  }, [data, rows, payment, customerName, salesperson, orderType, promo, discount, cart, resetOrder, notify, load]);

  // ---------- พักบิล ----------
  const [held, setHeld] = useState<HeldBill[]>([]);
  const refreshHeld = useCallback(async () => {
    try {
      setHeld(await api.heldBills());
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    refreshHeld();
    const t = setInterval(refreshHeld, 30_000); // เครื่องอื่นในสาขาพัก/เรียกคืน
    return () => clearInterval(t);
  }, [refreshHeld]);

  /** พักบิลปัจจุบัน → ล้างตะกร้าให้ขายคนต่อไปได้ทันที */
  const holdCurrent = useCallback(
    async (note: string, customer?: string) => {
      if (cart.length === 0) return null;
      const bill = await api.holdBill({
        items: cart.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        customerName: (customer ?? customerName) || undefined,
        note: note || undefined,
        salesperson,
        orderType,
        promoCode: promo?.code ?? null,
      });
      resetOrder();
      setHeld((h) => [...h.filter((x) => x.id !== bill.id), bill]);
      return bill;
    },
    [cart, customerName, salesperson, orderType, promo, resetOrder],
  );

  /** เรียกคืนบิลที่พักไว้ → ใส่กลับลงตะกร้า (ตรวจสต็อกปัจจุบัน) */
  const recallHeld = useCallback(
    async (id: number) => {
      const bill = await api.recallHeld(id);
      setHeld((h) => h.filter((x) => x.id !== id));
      const lines: CartLine[] = [];
      const short: string[] = [];
      for (const it of bill.items) {
        const v = index.variants.get(it.variantId);
        if (!v || sellableStock(v.stock) <= 0) {
          short.push(`${it.name} (${it.label}) หมด`);
          continue;
        }
        const qty = Math.min(it.qty, sellableStock(v.stock));
        if (qty < it.qty) short.push(`${it.name} (${it.label}) เหลือ ${v.stock}`);
        lines.push({ variantId: v.id, productId: v.productId, qty });
      }
      dispatch({ type: 'replace', lines });
      setCustomerName(bill.customerName);
      if (bill.salesperson) setSalesperson(bill.salesperson);
      if (bill.orderType) setOrderType(bill.orderType);
      setPromo(null);
      setPayment(null);
      if (bill.promoCode && lines.length) {
        const sub = lines.reduce((a, l) => a + (index.variants.get(l.variantId)?.price ?? 0) * l.qty, 0);
        api.promo(bill.promoCode, sub).then(setPromo).catch(() => notify('info', `โค้ด ${bill.promoCode} ใช้ไม่ได้แล้ว`));
      }
      if (short.length) notify('info', `สต็อกเปลี่ยนระหว่างพักบิล: ${short.join(', ')}`);
      return bill;
    },
    [index, notify],
  );

  const deleteHeld = useCallback(async (id: number) => {
    await api.deleteHeld(id);
    setHeld((h) => h.filter((x) => x.id !== id));
  }, []);

  return {
    held, refreshHeld, holdCurrent, recallHeld, deleteHeld,
    data, loadError, reload: load, index,
    cart, rows, itemCount, totals, promo, setPromo, applyPromo,
    addToCart, addBySku, setQty, removeLine, resetOrder,
    customerName, setCustomerName, salesperson, setSalesperson, orderType: orderType ?? data?.settings?.display.defaultOrderType ?? null, setOrderType,
    payment, setPayment, placeOrder, placing,
    toast, notify, clearToast,
  };
}

export type Pos = ReturnType<typeof usePos>;
