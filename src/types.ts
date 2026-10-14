export interface Category {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  sort: number;
}

export type AttrType = 'color' | 'size' | 'custom';
export interface Attr {
  type: AttrType;
  name: string;
  options: { value: string; hex?: string }[];
}

export interface Product {
  id: number;
  sku: string;
  barcode?: string | null;
  name: string;
  categoryId: string;
  price: number;
  art: string;
  tint: string;
  imageUrl: string | null;
  lowStock?: number;
  attrs?: Attr[];
}

export interface Variant {
  id: number;
  productId: number;
  sku: string;
  /** บาร์โค้ด (กำหนดเอง) สำหรับป้าย label — สแกนแล้วใส่ตะกร้าทันที */
  barcode?: string | null;
  size: string;
  color: string;
  colorHex: string;
  /** คุณสมบัติที่ 3 (ดีไซน์/ลาย/อื่นๆ) — '' ถ้าไม่มี */
  extra: string;
  stock: number;
  /** ราคาขายของ SKU นี้ */
  price: number;
}

export interface Staff {
  id: number;
  name: string;
  role?: 'manager' | 'staff';
}

export interface Bootstrap {
  categories: Category[];
  products: Product[];
  variants: Variant[];
  staff: Staff[];
  orderTypes: string[];
  vatRate: number;
  nextOrderNo: string;
  /** กะที่เปิดอยู่ (null = ยังไม่เปิดกะ) */
  shift: ShiftBrief | null;
  stockAlerts?: StockSummary;
  settings?: import('./appSettings').PublicSettings;
}

export interface Promo {
  code: string;
  label: string;
  type: 'percent' | 'amount';
  value: number;
  minTotal: number;
  discount: number;
}

export type PaymentMethod = 'cash' | 'promptpay' | 'card' | 'transfer';

export interface CartLine {
  variantId: number;
  productId: number;
  qty: number;
}

export interface OrderItem {
  name: string;
  sku: string;
  size: string;
  color: string;
  extra?: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: number;
  orderNo: string;
  customerName?: string | null;
  salesperson?: string | null;
  orderType: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  promoCode: string | null;
  /** ค่าธรรมเนียมการชำระเงิน */
  fee?: number;
  /** customer = บวกในยอดบิลแล้ว · shop = ร้านจ่าย */
  feePayer?: 'customer' | 'shop';
  paymentMethod: PaymentMethod;
  cashReceived: number | null;
  changeDue: number | null;
  createdAt?: string;
  items: OrderItem[];
}

// ---------------- ประวัติการขาย ----------------
export type OrderStatus = 'paid' | 'edited' | 'void';

export interface HistoryRow {
  id: number;
  orderNo: string;
  createdAt: string;
  customerName: string | null;
  salesperson: string | null;
  orderType: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  editCount: number;
  itemCount: number;
}

export interface HistorySummary {
  count: number;
  sales: number;
  voided: number;
  edited: number;
}

export interface HistoryFilter {
  from?: string;
  to?: string;
  timeFrom?: string;
  timeTo?: string;
  q?: string;
  status?: OrderStatus | '';
  payment?: PaymentMethod | '';
}

export interface DetailItem extends OrderItem {
  variantId: number;
  productId: number | null;
  colorHex: string | null;
  art: string | null;
}

export interface OrderEdit {
  id: number;
  kind: 'edit' | 'void';
  editedAt: string;
  staff: string;
  reason: string;
  summary: string;
  oldTotal: number;
  newTotal: number;
  diff: number;
  settleMethod: PaymentMethod | null;
  cashReceived: number | null;
  changeDue: number | null;
}

export interface OrderDetail extends Omit<Order, 'items'> {
  status: OrderStatus;
  updatedAt: string | null;
  editCount: number;
  voidReason: string | null;
  items: DetailItem[];
  edits: OrderEdit[];
}

export interface EditPreview {
  subtotal: number;
  discount: number;
  fee?: number;
  feePayer?: 'customer' | 'shop';
  vat: number;
  total: number;
  oldTotal: number;
  diff: number;
  promoCode: string | null;
  summary: string;
  changed: boolean;
  lines: { variantId: number; qty: number; unitPrice: number; lineTotal: number }[];
}

// ---------------- กะการขาย ----------------
export type ShiftVerdict = 'open' | 'match' | 'short' | 'over';

export interface ShiftBrief {
  id: number;
  shiftNo: number;
  openedAt: string;
  openedBy: string;
}

export interface Shift {
  id: number;
  shiftNo: number;
  businessDate: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedBy: string;
  openingCash: number;
  openingNote: string | null;
  closedAt: string | null;
  closedBy: string | null;
  countedCash: number | null;
  expectedCash: number;
  diff: number | null;
  denominations: Record<string, number> | null;
  closeNote: string | null;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  netCash: number;
  totalSales: number;
  billCount: number;
  byMethod: Record<PaymentMethod, number>;
  editCount: number;
  voidCount: number;
  cashRefunds: number;
  minutes: number;
  verdict: ShiftVerdict;
}

export interface CashMove {
  id: number;
  kind: 'in' | 'out';
  amount: number;
  reason: string;
  staff: string;
  createdAt: string;
}

export interface ShiftSummary {
  count: number;
  totalSales: number;
  cashSales: number;
  match: number;
  short: number;
  over: number;
  netDiff: number;
}

// ---------------- รายงาน / Dashboard ----------------
export interface Kpis {
  sales: number;
  bills: number;
  units: number;
  discount: number;
  profit: number;
  margin: number;
  aov: number;
  upt: number;
}

export interface SeriesPoint {
  key: string;
  sales: number;
  bills: number;
  units: number;
  profit: number;
}

export interface Dashboard {
  range: { from: string; to: string; days: number; granularity: 'hour' | 'day' | 'month' };
  prevRange: { from: string; to: string };
  kpis: Kpis;
  /** ค่าใช้จ่ายร้านในช่วงเดียวกัน (หน้าค่าใช้จ่าย) */
  expenses?: { total: number; count: number; prev: number; top: { category: string; name: string; total: number }[] };
  prev: Kpis;
  series: SeriesPoint[];
  prevSeries: SeriesPoint[];
  topProducts: { id: number; name: string; sku: string; art: string; tint: string; categoryId: string; category: string; units: number; sales: number }[];
  sizes: { label: string; units: number; sales: number }[];
  colors: { label: string; hex: string; units: number; sales: number }[];
  categories: { id: string; label: string; units: number; sales: number }[];
  payments: { method: PaymentMethod; bills: number; sales: number; fees?: number }[];
  hours: { hour: number; bills: number; sales: number }[];
  staff: { name: string; bills: number; sales: number }[];
  lowStock: { variantId: number; productId: number; name: string; art: string; size: string; color: string; colorHex: string; stock: number; sold30: number }[];
  stock: { out: number; low: number; variants: number; units: number; value: number };
  returns: { edits: number; voids: number; refunded: number; collected: number };
  recent: { id: number; orderNo: string; createdAt: string; customerName: string | null; salesperson: string | null; total: number; paymentMethod: PaymentMethod; status: OrderStatus; itemCount: number }[];
}

// ---------------- สต็อกสินค้า ----------------
export interface StockSummary {
  products: number;
  skus: number;
  units: number;
  out: number;
  low: number;
  value?: number;
}

export interface StockRow {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string;
  category: string;
  art: string;
  tint: string;
  imageUrl: string | null;
  active: boolean;
  lowStock: number;
  skuCount: number;
  skuActive: number;
  stock: number;
  outCount: number;
  lowCount: number;
  minPrice: number;
  maxPrice: number;
  stockValue?: number;
  updatedAt: string;
}

export interface EditVariant {
  id?: number;
  sku: string;
  /** undefined = ไม่แก้ (คงค่าเดิม) */
  barcode?: string | null;
  color: string;
  colorHex?: string;
  size: string;
  extra: string;
  cost: number;
  price: number;
  stock: number;
  stockBase?: number;
  active: boolean;
  label?: string;
}

export interface ProductFull {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string;
  price: number;
  cost?: number | null;
  art: string;
  tint: string;
  imageUrl: string | null;
  active: boolean;
  note: string | null;
  lowStock: number;
  attrs: Attr[];
  variants: (EditVariant & { id: number; label: string })[];
  moves: { id: number; delta: number; balance: number; reason: string; staff: string | null; createdAt: string; size: string; color: string; extra: string }[];
  createdAt: string;
  updatedAt: string | null;
}

// ---------------- สต็อกสินค้า (คุณสมบัติ): ตาราง ไซซ์ × สี ----------------
export interface SkuCell {
  id: number;
  sku: string;
  /** บาร์โค้ด (กำหนดเอง) */
  barcode: string | null;
  size: string;
  color: string;
  colorHex: string;
  extra: string;
  stock: number;
  active: boolean;
  price: number;
  cost?: number;
}
export interface SkuProduct {
  id: number;
  /** รหัสสินค้า */
  code: string;
  name: string;
  barcode: string | null;
  categoryId: string;
  category: string | null;
  art: string;
  tint: string;
  imageUrl: string | null;
  active: boolean;
  lowStock: number;
  attrs: Attr[];
  variants: SkuCell[];
}
export interface SkuPage {
  /** จำนวนสินค้าทั้งหมดตามตัวกรอง */
  total: number;
  skus: number;
  units: number;
  page: number;
  pages: number;
  limit: number;
  products: SkuProduct[];
}

// ---------------- คำสั่งพิเศษในสต็อก ----------------
export type StockCmdMode = 'check' | 'add' | 'set';
export interface StockCmdRow {
  id: number;
  productId: number;
  code: string;
  name: string;
  label: string;
  sku: string;
  barcode: string | null;
  input: string;
  lines: number[];
  qty: number;
  before: number;
  after: number;
  diff: number;
  active: boolean;
  error: string | null;
}
export interface StockCmdResult {
  mode: StockCmdMode;
  rows: StockCmdRow[];
  errors: { line: number; code: string; error: string }[];
  summary: { skus: number; units: number; match: number; over: number; short: number; errors: number };
  applied: number | null;
}
