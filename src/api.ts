// เรียก API ของเซิร์ฟเวอร์ POS (ทุก endpoint อยู่ใน object `api`) + ชนิดข้อมูลของคำขอ/คำตอบ
import { Platform } from 'react-native';
import { auth, type Feature, type Me, type PermLevel, type Role } from './session';
import { getDeviceTerminal } from './terminal';
import type { PublicSettings } from './appSettings';
import type {
  Bootstrap, CashMove, CreditNoteDoc, Dashboard, TaxInvoiceDoc, EditPreview, HistoryFilter, HistoryRow, HistorySummary, Order, OrderDetail, PaymentMethod, Promo,
  ProductFull, Shift, ShiftSummary, SkuPage, SkuProduct, StockCmdMode, StockCmdResult, StockRow, StockSummary, Variant, EditVariant, Attr,
} from './types';

/**
 * ที่อยู่ API:
 * - ถ้าตั้ง EXPO_PUBLIC_API_URL ไว้ จะใช้ค่านั้น
 * - บนเว็บที่ serve จาก server เดียวกัน (production บน VPS) ใช้ path เดียวกัน ("")
 * - ตอน dev ด้วย `expo start --web` (พอร์ต 8081) จะชี้ไปที่ API พอร์ต 3000
 */
function resolveBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (port === '8081' || port === '19006') return `${protocol}//${hostname}:3000`;
    return '';
  }
  return 'http://localhost:3000';
}

export const BASE = resolveBase();

/** รูปสินค้าที่อัปโหลด (/uploads/...) → URL เต็ม (ตอน dev อยู่คนละพอร์ต) */
export const imageSrc = (url: string, quality: 'high' | 'medium' | 'low' = 'high') => {
  if (!url.startsWith('/uploads/')) return url;
  // รูปย่อ: /uploads/<id>.jpg → /uploads/<id>.m.jpg (กลาง) / <id>.s.jpg (เล็ก) — ถ้ายังไม่มี เซิร์ฟเวอร์ส่งรูปหลักแทน
  const q = quality === 'medium' ? 'm' : quality === 'low' ? 's' : '';
  return BASE + (q ? url.replace(/^(\/uploads\/[a-f0-9]{24})\.(jpg|png|webp)$/, `$1.${q}.$2`) : url);
};

function qs(f: object) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export class ApiError extends Error {
  status: number;
  /** รหัสจาก server เช่น NO_SHIFT */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(auth.get() ? { Authorization: `Bearer ${auth.get()}` } : {}),
        // เครื่อง POS ของเครื่องนี้ → บิลบันทึกเครื่องที่ออก · เลขที่บิลรันต่อเครื่อง
        ...(getDeviceTerminal() ? { 'X-POS-Terminal': String(getDeviceTerminal()) } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data as { error?: string; code?: string };
      if (res.status === 401 && d.code === 'AUTH') auth.expire(); // หมดอายุ → กลับหน้าล็อกอิน
      throw new ApiError(res.status, d.error ?? `HTTP ${res.status}`, d.code);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === 'AbortError') throw new ApiError(0, 'เซิร์ฟเวอร์ไม่ตอบสนอง ลองใหม่อีกครั้ง');
    throw new ApiError(0, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  } finally {
    clearTimeout(timer);
  }
}

// ---------- สำรอง / กู้คืนข้อมูล ----------
export interface BackupBranchInfo {
  id: number; name: string; code: string; isMain: boolean;
  bills: number; lastBillAt: string | null; openShift: boolean;
}
export interface BackupPreview {
  id: string;
  shop: string;
  createdAt: string | null;
  /** 'all' = ไฟล์ทั้งร้าน · ตัวเลข = ไฟล์ของสาขาเดียว */
  scope: 'all' | number;
  sameShop: boolean;
  branches: (BackupBranchInfo & { hasData: boolean; current: BackupBranchInfo | null; lostBills: number; shipmentsAfter: number })[];
}
export interface RestoreResult { branches: { id: number; name: string; rows: number }[]; safetyBackup: string }

/** อัปโหลดไฟล์ .db (ไฟล์ใหญ่ — ไม่จำกัดเวลา 15 วินาทีแบบคำขออื่น) */
async function uploadBackup(file: Blob): Promise<BackupPreview> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/backup/upload`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream', ...(auth.get() ? { Authorization: `Bearer ${auth.get()}` } : {}) },
    });
  } catch {
    throw new ApiError(0, 'อัปโหลดไม่สำเร็จ — เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as BackupPreview;
}

export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  promo: (code: string, subtotal: number) =>
    request<Promo>(`/api/promos/${encodeURIComponent(code)}?subtotal=${subtotal}`),
  orders: (limit = 30) => request<Order[]>(`/api/orders?limit=${limit}`),
  placeOrder: (body: {
    customerName?: string;
    salesperson?: string;
    orderType: string;
    promoCode?: string;
    paymentMethod: PaymentMethod;
    cashReceived?: number;
    items: { variantId: number; qty: number }[];
  }) =>
    request<{ order: Order; stock: Pick<Variant, 'id' | 'stock'>[]; nextOrderNo: string }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  history: (f: HistoryFilter & { limit?: number; offset?: number }) =>
    request<{ rows: HistoryRow[]; summary: HistorySummary; limit: number; offset: number }>(`/api/history${qs(f)}`),
  historyCsvUrl: (f: HistoryFilter) => `${BASE}/api/history.csv${qs({ ...f, token: auth.get() ?? '' })}`,
  orderDetail: (id: number) => request<OrderDetail>(`/api/orders/${id}`),
  previewEdit: (id: number, items: { variantId: number; qty: number }[]) =>
    request<{ preview: EditPreview }>(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify({ dryRun: true, items }) }),
  saveEdit: (
    id: number,
    body: {
      items: { variantId: number; qty: number }[];
      customerName?: string;
      staff: string;
      reason: string;
      settleMethod?: PaymentMethod;
      cashReceived?: number;
    },
  ) =>
    request<{ order: OrderDetail; diff: number; changeDue: number | null }>(`/api/orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  voidOrder: (id: number, body: { pin: string; reason: string; refundMethod?: PaymentMethod }) =>
    request<{ order: OrderDetail }>(`/api/orders/${id}/void`, { method: 'POST', body: JSON.stringify(body) }),
  // ----- ใบกำกับภาษีเต็มรูป / ใบลดหนี้ -----
  issueTaxInvoice: (orderId: number, body: { buyerName: string; buyerAddress: string; buyerTaxId: string; buyerBranch: string }) =>
    request<TaxInvoiceDoc>(`/api/orders/${orderId}/tax-invoice`, { method: 'POST', body: JSON.stringify(body) }),
  taxInvoice: (id: number) => request<TaxInvoiceDoc>(`/api/tax-invoices/${id}`),
  cancelTaxInvoice: (id: number, reason: string) =>
    request<TaxInvoiceDoc>(`/api/tax-invoices/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  creditNote: (orderId: number, body: { pin: string; reason: string; refundMethod?: PaymentMethod; items: { itemId: number; qty: number }[] }) =>
    request<CreditNoteDoc>(`/api/orders/${orderId}/credit-note`, { method: 'POST', body: JSON.stringify(body) }),
  creditNoteDoc: (id: number) => request<CreditNoteDoc>(`/api/credit-notes/${id}`),

  // ----- กะการขาย -----
  currentShift: () => request<{ shift: Shift | null; moves?: CashMove[]; suggestOpening?: number }>('/api/shifts/current'),
  openShift: (body: { staff: string; openingCash: number; note?: string; denominations?: Record<string, number> }) =>
    request<Shift>('/api/shifts/open', { method: 'POST', body: JSON.stringify(body) }),
  cashMove: (body: { kind: 'in' | 'out'; amount: number; reason: string; staff: string }) =>
    request<{ shift: Shift; moves: CashMove[] }>('/api/shifts/current/cash', { method: 'POST', body: JSON.stringify(body) }),
  closeShift: (body: { staff: string; countedCash: number; note?: string; denominations?: Record<string, number>; tenders?: Record<string, number> }) =>
    request<Shift>('/api/shifts/current/close', { method: 'POST', body: JSON.stringify(body) }),
  shifts: (f: { from?: string; to?: string; limit?: number; offset?: number }) =>
    request<{ rows: Shift[]; summary: ShiftSummary }>(`/api/shifts${qs(f)}`),
  shiftDetail: (id: number) =>
    request<{
      shift: Shift;
      moves: CashMove[];
      orders: { id: number; orderNo: string; createdAt: string; total: number; paymentMethod: PaymentMethod; status: string }[];
      adjustments: { id: number; kind: 'edit' | 'void'; method: PaymentMethod; amount: number; createdAt: string; orderNo: string }[];
    }>(`/api/shifts/${id}`),

  // ----- สต็อกสินค้า -----
  products: (f: { q?: string; category?: string; status?: string }) =>
    request<{ rows: StockRow[]; summary: StockSummary }>(`/api/products${qs(f)}`),
  product: (id: number) => request<ProductFull>(`/api/products/${id}`),
  saveProduct: (id: number | null, body: ProductInput) =>
    request<ProductFull>(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }),
  setProductActive: (id: number, active: boolean) =>
    request<{ id: number; active: boolean }>(`/api/products/${id}/active`, { method: 'PUT', body: JSON.stringify({ active }) }),
  stockAlerts: () => request<StockSummary>('/api/stock/alerts'),
  skus: (f: { q?: string; category?: string; status?: string; sort?: string; dir?: string; page?: number; limit?: number }) =>
    request<SkuPage>(`/api/stock/skus${qs(f)}`),
  // ----- ตั้งค่า -----
  settings: () => request<{ settings: AdminSettings; keys: ApiKeyRow[] }>('/api/settings'),
  saveSettings: <K extends keyof AdminSettings>(section: K, value: AdminSettings[K]) =>
    request<{ settings: AdminSettings }>(`/api/settings/${section}`, { method: 'PUT', body: JSON.stringify(value) }),
  testNotify: (channel: 'line' | 'whatsapp' | 'webhook', event?: NotifyEventKey) =>
    request<{ ok: boolean; status: number; body: string }>('/api/settings/notify/test', { method: 'POST', body: JSON.stringify({ channel, event }) }),
  notifyCatalog: () => request<NotifyEventInfo[]>('/api/settings/notify/catalog'),
  createKey: (name: string, scope: 'read' | 'write') =>
    request<ApiKeyRow & { key: string }>('/api/settings/keys', { method: 'POST', body: JSON.stringify({ name, scope }) }),
  revokeKey: (id: number) => request<{ ok: boolean }>(`/api/settings/keys/${id}`, { method: 'DELETE' }),
  bulkProducts: (ids: number[], action: 'activate' | 'deactivate' | 'category' | 'zero' | 'delete' | 'vat' | 'exempt', categoryId?: string) =>
    request<{ action: string; done: number; archived: number }>('/api/products/bulk', { method: 'POST', body: JSON.stringify({ ids, action, categoryId }) }),
  stockCommand: (mode: StockCmdMode, lines: { code: string; qty: number; line: number }[], apply = false) =>
    request<StockCmdResult>('/api/stock/command', { method: 'POST', body: JSON.stringify({ mode, lines, apply }) }),
  bulkSkus: (productId: number, variants: { id: number; stock?: number; stockBase?: number; price?: number; barcode?: string | null; active?: boolean }[]) =>
    request<SkuProduct>(`/api/products/${productId}/skus`, { method: 'PUT', body: JSON.stringify({ variants }) }),
  patchVariant: (id: number, body: { barcode?: string | null; active?: boolean }) =>
    request<{ id: number; barcode: string | null; active: boolean }>(`/api/variants/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  categories: () => request<{ id: string; name: string; icon: string; sort: number }[]>('/api/categories'),
  createCategory: (b: { name: string; icon: string }) => request<{ id: string; name: string; icon: string }>('/api/categories', { method: 'POST', body: JSON.stringify(b) }),
  // ---- ส่งของจากโรงงาน (ใบส่งของ DO) ----
  importProducts: (b: { rows: ImportRow[]; mode: 'add' | 'set'; updateInfo: boolean; apply: boolean }) =>
    request<ImportResult>('/api/products/import', { method: 'POST', body: JSON.stringify(b) }),
  shipments: () => request<ShipmentList>('/api/shipments'),
  shipment: (id: number) => request<ShipmentDetail>(`/api/shipments/${id}`),
  /** ใบส่งของเป็น Excel (หน้าตาเดียวกับใบพิมพ์ A4) */
  shipmentXlsxUrl: (id: number) => `${BASE}/api/shipments/${id}/export.xlsx${qs({ token: auth.get() ?? '' })}`,
  createShipment: (b: { destBranchId: number; sourceBranchId: number | null; bags: number; note?: string }) =>
    request<ShipmentDetail>('/api/shipments', { method: 'POST', body: JSON.stringify(b) }),
  updateShipment: (id: number, b: Partial<{ destBranchId: number; sourceBranchId: number | null; bags: number; note: string }>) =>
    request<ShipmentDetail>(`/api/shipments/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  scanShipment: (id: number, code: string, qty: number) =>
    request<ShipmentDetail>(`/api/shipments/${id}/scan`, { method: 'POST', body: JSON.stringify({ code, qty }) }),
  setShipmentItem: (id: number, variantId: number, qty: number) =>
    request<ShipmentDetail>(`/api/shipments/${id}/items/${variantId}`, { method: 'PUT', body: JSON.stringify({ qty }) }),
  holdShipment: (id: number) => request<ShipmentDetail>(`/api/shipments/${id}/hold`, { method: 'POST' }),
  resumeShipment: (id: number) => request<ShipmentDetail>(`/api/shipments/${id}/resume`, { method: 'POST' }),
  shipShipment: (id: number) => request<ShipmentDetail>(`/api/shipments/${id}/ship`, { method: 'POST' }),
  cancelShipment: (id: number, reason: string) =>
    request<ShipmentList>(`/api/shipments/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  restoreShipment: (id: number) => request<ShipmentDetail>(`/api/shipments/${id}/restore`, { method: 'POST' }),
  // ----- ภาษีมูลค่าเพิ่ม -----
  tax: () => request<TaxAdmin>('/api/tax'),
  taxCompany: (b: { legalName?: string; taxId?: string; lockEdit?: boolean }) => request<TaxAdmin>('/api/tax/company', { method: 'PUT', body: JSON.stringify(b) }),
  taxBranch: (id: number, b: { vatRegistered?: boolean; taxBranchNo?: string }) => request<TaxAdmin>(`/api/tax/branches/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  addVatRate: (b: VatRateIn) => request<TaxAdmin>('/api/tax/rates', { method: 'POST', body: JSON.stringify(b) }),
  updateVatRate: (id: number, b: VatRateIn) => request<TaxAdmin>(`/api/tax/rates/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteVatRate: (id: number) => request<TaxAdmin>(`/api/tax/rates/${id}`, { method: 'DELETE' }),
  addTerminal: (b: TerminalIn & { branchId: number }) => request<TaxAdmin>('/api/tax/terminals', { method: 'POST', body: JSON.stringify(b) }),
  updateTerminal: (id: number, b: TerminalIn) => request<TaxAdmin>(`/api/tax/terminals/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteTerminal: (id: number) => request<TaxAdmin>(`/api/tax/terminals/${id}`, { method: 'DELETE' }),
  /** เครื่อง POS ที่ใช้งานได้ของสาขาปัจจุบัน (ให้เครื่องนี้เลือก) */
  branchTerminals: () => request<TaxTerminal[]>('/api/tax/terminals'),
  taxReport: (f: TaxReportFilter) => request<TaxReport>(`/api/tax/report${qs(f)}`),
  taxReportXlsxUrl: (f: TaxReportFilter) => `${BASE}/api/tax/report.xlsx${qs({ ...f, token: auth.get() ?? '' })}`,
  shipmentReport: (f: ShipReportFilter) => request<ShipReport>(`/api/shipments/report${qs(f)}`),
  shipmentReportXlsxUrl: (f: ShipReportFilter) => `${BASE}/api/shipments/report.xlsx${qs({ ...f, token: auth.get() ?? '' })}`,
  /** ลิงก์ดาวน์โหลดไฟล์สำรอง · branch = id สาขา (ไม่ระบุ = ทั้งร้าน) */
  backupUrl: (branch?: number) => `${BASE}/api/backup/download${qs({ branch, token: auth.get() ?? '' })}`,
  uploadBackup,
  restoreBackup: (id: string, branchIds: number[], pin: string) =>
    request<RestoreResult>('/api/backup/restore', { method: 'POST', body: JSON.stringify({ id, branchIds, pin }) }, 300_000),
  discardBackup: (id: string) => request<{ ok: true }>('/api/backup/discard', { method: 'POST', body: JSON.stringify({ id }) }),
  branches: () => request<{ current: Branch | null; list: (Branch & { current: boolean })[] }>('/api/branches'),
  switchBranch: (id: number) => request<{ branchId: number }>('/api/branches/switch', { method: 'POST', body: JSON.stringify({ id }) }),
  branchManage: () => request<BranchManage>('/api/branches/manage'),
  createBranch: (b: BranchInput) => request<Branch>('/api/branches', { method: 'POST', body: JSON.stringify(b) }),
  updateBranch: (id: number, b: BranchInput) => request<Branch>(`/api/branches/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  resetBranchPrices: (variantIds: number[]) => request<{ done: number }>('/api/branches/reset-prices', { method: 'POST', body: JSON.stringify({ variantIds }) }),
  deleteBranches: (ids: number[]) => request<{ done: number }>('/api/branches/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  upload: (dataUrl: string, variants?: { m?: string; s?: string }) =>
    request<{ url: string }>('/api/uploads', { method: 'POST', body: JSON.stringify({ dataUrl, variants }) }),
  /** รูปสินค้าที่ยังไม่มีรูปย่อ / เพิ่มรูปย่อให้รูปเดิม */
  uploadsMissingVariants: () => request<{ urls: string[] }>('/api/uploads/variants'),
  saveUploadVariants: (url: string, variants: { m: string; s: string }) =>
    request<{ ok: true }>('/api/uploads/variants', { method: 'POST', body: JSON.stringify({ url, variants }) }),

  // ----- รายงาน -----
  dashboard: (f: { from: string; to: string; branch?: string }) => request<Dashboard>(`/api/dashboard${qs(f)}`),
  // ----- ค่าใช้จ่าย & สมุดลิ้นชัก -----
  expenses: (f: ExpenseFilter) => request<ExpenseList>(`/api/expenses${qs(f)}`),
  expensesCsvUrl: (f: ExpenseFilter) => `${BASE}/api/expenses.csv${qs({ ...f, token: auth.get() ?? '' })}`,
  createExpense: (body: ExpenseInput) => request<Expense>('/api/expenses', { method: 'POST', body: JSON.stringify(body) }),
  updateExpense: (id: number, body: ExpenseInput) => request<Expense>(`/api/expenses/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  voidExpense: (id: number, reason: string) =>
    request<{ expense: Expense; refunded: boolean }>(`/api/expenses/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
  saveExpenseCategories: (categories: ExpenseCategory[]) =>
    request<ExpenseCategory[]>('/api/expenses/categories', { method: 'PUT', body: JSON.stringify({ categories }) }),
  // ----- พักบิล -----
  heldBills: () => request<HeldBill[]>('/api/held'),
  holdBill: (body: { items: { variantId: number; qty: number }[]; customerName?: string; note?: string; salesperson?: string | null; orderType?: string | null; promoCode?: string | null }) =>
    request<HeldBill>('/api/held', { method: 'POST', body: JSON.stringify(body) }),
  recallHeld: (id: number) => request<HeldBill>(`/api/held/${id}/recall`, { method: 'POST' }),
  deleteHeld: (id: number) => request<{ ok: boolean }>(`/api/held/${id}`, { method: 'DELETE' }),
  daySummary: (date?: string) => request<DaySummary>(`/api/reports/day${qs({ date })}`),
  drawer: (shift?: number) => request<DrawerLedger>(`/api/expenses/drawer${qs({ shift })}`),
  dashboardCsvUrl: (f: { from: string; to: string; branch?: string }) => `${BASE}/api/dashboard.csv${qs({ ...f, token: auth.get() ?? '' })}`,
  dashboardXlsxUrl: (f: { from: string; to: string; branch?: string }) => `${BASE}/api/dashboard.xlsx${qs({ ...f, token: auth.get() ?? '' })}`,
  stockXlsxUrl: () => `${BASE}/api/stock/export.xlsx${qs({ token: auth.get() ?? '' })}`,
  // รายงานย่อย (เมนู รายงาน → ยอดขาย / สินค้า)
  salesReport: (f: SalesReportFilter) => request<SalesReport>(`/api/reports/sales${qs(f)}`),
  salesReportXlsxUrl: (f: SalesReportFilter) => `${BASE}/api/reports/sales.xlsx${qs({ ...f, token: auth.get() ?? '' })}`,
  productReport: (f: ProductReportFilter) => request<ProductReport>(`/api/reports/products${qs(f)}`),
  productReportXlsxUrl: (f: ProductReportFilter) => `${BASE}/api/reports/products.xlsx${qs({ ...f, token: auth.get() ?? '' })}`,
  billReport: (f: BillReportFilter) => request<BillReport>(`/api/reports/bills${qs(f)}`),
  billReportXlsxUrl: (f: BillReportFilter) => `${BASE}/api/reports/bills.xlsx${qs({ ...f, token: auth.get() ?? '' })}`,

  // ----- พนักงาน / เข้าสู่ระบบ -----
  login: (pin: string) => request<{ token: string; staff: Me }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  me: () => request<Me>('/api/auth/me'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  staffList: () => request<StaffMember[]>('/api/staff'),
  // ---------- สิทธิ์ตามบทบาท ----------
  perms: () => request<PermCatalog>('/api/perms'),
  savePerms: (role: Role, perms: Record<string, PermLevel>) =>
    request<PermCatalog['perms']>(`/api/perms/${role}`, { method: 'PUT', body: JSON.stringify({ perms }) }),
  resetPerms: (role: Role) => request<PermCatalog['perms']>(`/api/perms/${role}/reset`, { method: 'POST' }),
  // ---------- โปรโมชั่น ----------
  promos: () => request<PromoRule[]>('/api/promos'),
  createPromo: (b: PromoInput) => request<PromoRule>('/api/promos', { method: 'POST', body: JSON.stringify(b) }),
  updatePromo: (code: string, b: Partial<PromoRule>) => request<PromoRule>(`/api/promos/${code}`, { method: 'PUT', body: JSON.stringify(b) }),
  deletePromo: (code: string) => request<{ ok: true }>(`/api/promos/${code}`, { method: 'DELETE' }),
  promoPreview: (subtotal: number) => request<PromoPreview>(`/api/promos/preview?subtotal=${subtotal}`),
  createStaff: (b: { name: string; pin: string; role: Role; canVoid: boolean; branchIds: number[] }) =>
    request<StaffMember>('/api/staff', { method: 'POST', body: JSON.stringify(b) }),
  updateStaff: (id: number, b: Partial<{ name: string; pin: string; role: Role; canVoid: boolean; active: boolean; branchIds: number[] }>) =>
    request<StaffMember>(`/api/staff/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
};

export interface PermCatalog {
  roles: { id: Role; label: string; desc: string; fixed: boolean }[];
  features: { id: Feature; label: string; group: string; hint: string }[];
  perms: Record<Role, Record<Feature, PermLevel>>;
}

/** โปรโมชั่น (ตัวตั้งค่า): ส่วนลด หรือ ของแถม */
export interface PromoRule {
  code: string;
  label: string;
  kind: 'discount' | 'freebie';
  type: 'percent' | 'amount';
  value: number;
  minTotal: number;
  giftVariantId: number | null;
  giftQty: number;
  /** ใช้เองเมื่อยอดถึงขั้นต่ำ (ไม่ต้องกรอกโค้ด) */
  auto: boolean;
  startsAt: string | null;
  endsAt: string | null;
  note: string;
  active: boolean;
  giftName?: string | null;
}
export type PromoInput = Omit<PromoRule, 'giftName'>;
export interface PromoPreview {
  subtotal: number;
  gifts: { variantId: number; qty: number; promoCode: string; label: string; name: string }[];
  discount: { code: string; label: string; amount: number } | null;
  next: { code: string; label: string; minTotal: number; missing: number }[];
}

export interface StaffMember {
  id: number;
  name: string;
  role: Role;
  active: boolean;
  canVoid: boolean;
  lastLogin: string | null;
  hasPin: boolean;
  branchIds: number[];
}

export interface ProductInput {
  /** รหัสสินค้า ('' = สร้างอัตโนมัติ) */
  code: string;
  name: string;
  categoryId: string;
  barcode: string;
  imageUrl: string | null;
  art: string;
  tint: string;
  active: boolean;
  lowStock: number;
  note: string;
  attrs: Attr[];
  variants: EditVariant[];
}

// ---------------- ตั้งค่า (ผู้จัดการ) ----------------
export interface Branch {
  id: number;
  name: string;
  code: string;
  address: string;
  vatRegistered: boolean;
  phone: string;
  photo: string;
  isMain: boolean;
  staffCount: number;
  createdAt: string;
}
export interface BranchInput {
  name: string;
  code: string;
  address: string;
  vatRegistered: boolean;
  phone: string;
  photo: string;
}
export interface BranchManage {
  currentId: number;
  mainId: number;
  nextCode: string;
  list: Branch[];
}

export interface AdminSettings extends PublicSettings {
  stock: PublicSettings['stock'] & {
    skuDigits: number;
    skuSeparator: '-' | '' | '.' | '_';
    sync: { role: 'off' | 'master' | 'branch'; masterUrl: string; apiKey: string; intervalMin: number; syncPrice: boolean; syncCost: boolean; syncImages: boolean };
  };
  barcode: PublicSettings['barcode'] & { autoAssign: 'none' | 'sku' | 'ean13'; ean13Prefix: string; labelWidth: number; labelHeight: number; labelShowPrice: boolean; labelShowName: boolean };
  notify: {
    line: { enabled: boolean; token: string; to: string };
    whatsapp: { enabled: boolean; token: string; phoneNumberId: string; to: string };
    webhook: { enabled: boolean; url: string; secret: string };
    events: Record<NotifyEventKey, NotifyChannels>;
    options: { saleMin: number; shiftMismatchOnly: boolean; dailyTime: string };
    style: CardStyle;
    templates: Record<NotifyEventKey, CardTemplate>;
  };
  api: { enabled: boolean };
}
export type NotifyEventKey = 'sale' | 'void' | 'edit' | 'lowStock' | 'outStock' | 'shiftOpen' | 'shiftClose' | 'cash' | 'expense' | 'daily';
export interface NotifyChannels { on: boolean; line: boolean; whatsapp: boolean; webhook: boolean }
export interface CardLine { label: string; value: string }
export interface CardTemplate { emoji: string; title: string; subtitle: string; color: string; lines: CardLine[]; showItems: boolean; itemsTitle: string; footer: string }
export interface CardStyle { color: string; logoUrl: string; buttonLabel: string; buttonUrl: string; size: 'kilo' | 'mega' | 'giga' }
export interface NotifyItem { name: string; detail: string; value: string }
export interface NotifyEventInfo {
  key: NotifyEventKey; name: string; label: string; desc: string; hasItems: boolean;
  placeholders: [string, string][]; sample: Record<string, string>; sampleItems: NotifyItem[]; defaultTemplate: CardTemplate;
}
export interface ApiKeyRow { id: number; name: string; prefix: string; scope: 'read' | 'write' | 'sync'; createdAt?: string; createdBy?: string | null; lastUsedAt?: string | null }

// ----- ค่าใช้จ่ายร้าน -----
export type ExpenseSource = 'drawer' | 'transfer' | 'card' | 'owner';
export interface ExpenseCategory { id: string; name: string; icon: string; color: string }
export interface ExpenseItem { description: string; category: string; qty: number; unit: string; unitPrice: number; amount: number }
export interface Expense {
  items: ExpenseItem[];
  id: number; branchId: number; branchName: string; date: string; category: string; description: string; amount: number; source: ExpenseSource;
  vendor: string; refNo: string; photo: string; note: string; shiftId: number | null; shiftNo: number | null; shiftStatus: string | null;
  cashMoveId: number | null; staff: string; createdAt: string; updatedAt: string; voidedAt: string | null; voidedBy: string | null; voidReason: string | null;
}
export interface ExpenseItemInput { description: string; category: string; qty: number | string; unit: string; unitPrice: number | string }
export interface ExpenseInput {
  date?: string; items: ExpenseItemInput[]; source: ExpenseSource; vendor: string; refNo: string; photo: string; note: string;
}
export interface ExpenseFilter { from?: string; to?: string; category?: string; source?: string; q?: string; voided?: string; branch?: string }
export interface ExpenseList {
  rows: Expense[];
  summary: {
    count: number; total: number;
    bySource: { source: ExpenseSource; total: number; count: number }[];
    byCategory: { category: string; total: number; count: number }[];
    byDay: { date: string; total: number }[];
  };
  categories: ExpenseCategory[];
  sources: Record<ExpenseSource, string>;
}
export interface DrawerEntry {
  at: string; type: 'open' | 'sale' | 'edit' | 'void' | 'cash_in' | 'cash_out' | 'expense' | 'expense_void'; label: string; detail: string; amount: number;
  staff: string; ref: number | string | null; balance: number;
}
export interface DrawerLedger {
  shift: null | {
    id: number; shiftNo: number; businessDate: string; status: 'open' | 'closed'; openedAt: string; openedBy: string;
    closedAt: string | null; closedBy: string | null; countedCash: number | null; diff: number | null;
  };
  entries: DrawerEntry[];
  totals: null | { opening: number; cashSales: number; refunds: number; cashIn: number; cashOut: number; expenses: number; expected: number };
  shifts: { id: number; shiftNo: number; businessDate: string; status: string; openedBy: string }[];
}

// ----- สรุปยอดประจำวัน (พิมพ์ตอนปิดกะ) -----
export interface DaySummary {
  date: string;
  shop: { name: string; branchName: string; branchCode: string };
  sales: { bills: number; total: number; subtotal: number; discount: number; vat: number; fee: number; units: number; aov: number };
  voids: { count: number; amount: number };
  edits: { count: number; refunded: number };
  byMethod: { method: string; amount: number }[];
  top: { name: string; qty: number; amount: number }[];
  expenses: { total: number; count: number; drawer: number; top: { category: string; name: string; total: number }[] };
  shifts: {
    id: number; shiftNo: number; status: string; openedAt: string; openedBy: string; closedAt: string | null; closedBy: string | null;
    openingCash: number; expectedCash: number | null; countedCash: number | null; diff: number | null; cashIn: number | null; cashOut: number | null;
  }[];
}

// ----- พักบิล -----
export interface HeldBill {
  id: number; customerName: string; note: string; salesperson: string | null; orderType: string | null; promoCode: string | null;
  items: { variantId: number; qty: number; name: string; label: string; price: number }[]; itemCount: number; total: number; staff: string; createdAt: string;
}

// ---- ส่งของจากโรงงาน ----
export interface ShipBranch { id: number; name: string; code: string; isMain: boolean }
export interface Shipment {
  id: number; docNo: string; destBranchId: number; destBranchName: string | null; sourceBranchId: number | null; sourceBranchName: string | null;
  bags: number; note: string | null; status: 'draft' | 'shipped' | 'cancelled';
  createdBy: string | null; createdAt: string; shippedBy: string | null; shippedAt: string | null; units: number; lines: number;
  /** พักไว้ (Hold) เมื่อไร / โดยใคร · null = กำลังทำอยู่ */
  heldAt: string | null; heldBy: string | null;
  /** ยกเลิกเมื่อไร / โดยใคร / เหตุผล · purgeAt = เวลาที่จะลบถาวร (ยกเลิก + 3 วัน) */
  cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null; purgeAt: string | null;
}
export interface ImportRow {
  line: number; code: string; barcode: string; qty: string; name: string; color: string; size: string; category: string; lowStock: string; price: string;
  /** คุณสมบัติที่ 3 · รหัส SKU ที่ระบบสร้าง (ไฟล์จาก "ส่งออก Excel") */
  extra: string; variantSku: string;
}
export interface ImportResult {
  applied: boolean; mode: 'add' | 'set';
  summary: { products: number; newProducts: number; updatedProducts: number; newSkus: number; updatedSkus: number; unchangedSkus: number; units: number; newCategories: string[] };
  errors: { line: number; code: string; text: string }[];
  warnings: { line: number; code: string; text: string }[];
  failed: { code: string; name: string; text: string }[];
}
// ---- ภาษีมูลค่าเพิ่ม ----
export interface VatRate {
  id: number; rate: number; startDate: string; endDate: string | null; note: string; createdBy: string | null; createdAt: string;
  /** จำนวนบิลในช่วงอัตรานี้ · current = มีผลวันนี้ */
  bills: number; current: boolean;
}
export interface VatRateIn { rate: number | string; startDate: string; endDate?: string | null; note?: string }
export interface TaxTerminal {
  id: number; branchId: number; code: string; rdNo: string; name: string; active: boolean; bills?: number; lastBillAt?: string | null;
}
export interface TerminalIn { code: string; rdNo: string; name: string; active?: boolean }
export interface TaxAdmin {
  company: { legalName: string; taxId: string; shopName: string; lockEdit: boolean; taxIdValid: boolean };
  branches: { id: number; name: string; code: string; isMain: boolean; vatRegistered: boolean; taxBranchNo: string }[];
  rates: VatRate[];
  rateToday: number | null;
  today: string;
  terminals: TaxTerminal[];
}
export interface TaxCreditRow {
  id: number; docNo: string; issuedAt: string; reason: string; refundMethod: string; vatRate: number; vatBase: number; vat: number; exempt: number;
  total: number; issuedBy: string; approver: string; orderNo: string; orderDate: string; branch: string;
}
export interface TaxFullInvoiceRow {
  id: number; docNo: string; issuedAt: string; buyerName: string; buyerTaxId: string; buyerBranch: string; buyerBranchText: string;
  vatRate: number; vatBase: number; vat: number; exempt: number; total: number; status: 'active' | 'cancelled'; cancelReason: string | null;
  issuedBy: string; orderNo: string;
}
export interface TaxReportFilter { from: string; to: string; branch?: string; terminal?: string; page?: number; limit?: number }
export interface TaxDayRow {
  day: string; branchId: number; branch: string; taxBranch: string; terminalId: number; terminal: string | null; rdNo: string; terminalName: string;
  firstNo: string; lastNo: string; bills: number; voids: number; voidTotal: number; total: number; vatBase: number; vat: number; exempt: number;
  gtStart: number; gtEnd: number; continuous: boolean | null;
}
export interface TaxBillRow {
  id: number; orderNo: string; createdAt: string; branch: string; terminal: string | null; rdNo: string; customer: string | null; status: string;
  vatRate: number | null; vatBase: number; vat: number; exempt: number; total: number; paymentMethod: string;
  voidReason: string | null; voidedAt: string | null; voidedBy: string | null; voidApprover: string | null;
}
export interface TaxReport {
  range: { from: string; to: string };
  header: { legalName: string; taxId: string; branches: { id: number; name: string; taxBranch: string; vatRegistered: boolean }[] };
  total: { bills: number; voids: number; edited: number; noTerminal: number; voidTotal: number; total: number; vatBase: number; vat: number; exempt: number };
  byRate: {
    rate: number; bills: number; vatBase: number; vat: number; exempt: number; total: number;
    /** ใบลดหนี้ในอัตรานี้ + ยอดสุทธิหลังหักใบลดหนี้ */
    cnCount?: number; cnVatBase?: number; cnVat?: number; cnTotal?: number; netVatBase?: number; netVat?: number; netExempt?: number; netTotal?: number;
  }[];
  /** ยอดสุทธิหลังหักใบลดหนี้ของงวด (ใช้ยื่น ภ.พ.30) */
  net?: { total: number; vatBase: number; vat: number; exempt: number };
  creditTotal?: { count: number; total: number; vatBase: number; vat: number; exempt: number };
  creditNotes?: TaxCreditRow[];
  taxInvoices?: TaxFullInvoiceRow[];
  days: TaxDayRow[];
  bills: TaxBillRow[]; page: number; pages: number;
  voids: TaxBillRow[];
  terminals: { id: number; code: string; rdNo: string; name: string }[];
}

/** รายงานการส่ง (ใบส่งของที่ส่งออกแล้ว) */
export interface ShipReportFilter { from: string; to: string; dest?: string; q?: string; sort?: string; dir?: 'asc' | 'desc'; page?: number; limit?: number }
export interface ShipReportRow {
  id: number; docNo: string; shippedAt: string; createdAt: string; destBranchId: number; destBranchName: string | null;
  sourceBranchId: number | null; sourceBranchName: string | null; bags: number; note: string | null; shippedBy: string | null; createdBy: string | null;
  units: number; lines: number;
}
export interface ShipReport {
  range: { from: string; to: string }; rows: ShipReportRow[]; page: number; pages: number;
  total: { docs: number; bags: number; units: number; lines: number };
  byDest: { destBranchId: number; destBranchName: string | null; docs: number; units: number; bags: number }[];
}
export interface ShipmentList { list: Shipment[]; cancelled: Shipment[]; keepDays: number; branches: ShipBranch[] }
export interface ShipmentItem {
  variantId: number; qty: number; sku: string; barcode: string | null; size: string; color: string; extra: string; name: string; productId: number; productSku?: string; label: string;
}
export interface ShipmentDetail {
  shipment: Shipment;
  items: ShipmentItem[];
  /** สต็อกปัจจุบันของสาขาที่จะตัด (variantId → จำนวน) · null = ไม่ตัดสต็อก */
  sourceStock: Record<string, number> | null;
  scanned?: { variantId: number; name: string; label: string; sku: string; qty: number; added: number };
}

// ---------- รายงานย่อย ----------
export interface SalesReportFilter { from: string; to: string; group: 'day' | 'week' | 'month'; branch?: string }
export interface SalesReportRow {
  key: string; label: string; from: string; to: string;
  bills: number; units: number; gross: number; discount: number; refund: number; net: number; vat: number; cost: number; profit: number;
}
export interface SalesReport {
  range: { from: string; to: string }; group: 'day' | 'week' | 'month'; rows: SalesReportRow[];
  total: Omit<SalesReportRow, 'key' | 'label' | 'from' | 'to'>;
}
export interface BillReportFilter {
  from: string; to: string; branch?: string; q?: string; payment?: string; status?: string;
  sort?: string; dir?: 'asc' | 'desc'; page?: number; limit?: number;
}
export interface BillReportRow {
  id: number; orderNo: string; createdAt: string; branch: string | null; salesperson: string | null; customer: string | null;
  orderType: string | null; payment: string; paymentLabel: string; lines: number; units: number;
  gross: number; discount: number; fee: number; net: number; vat: number; cost: number; profit: number;
  status: 'paid' | 'edited' | 'void'; editCount: number; voidReason: string | null;
  /** คืนเงินด้วยใบลดหนี้ (หักใน net / vat / units / cost แล้ว) */
  refund: number;
}
export interface BillReport {
  range: { from: string; to: string }; page: number; pages: number; limit: number; rows: BillReportRow[];
  total: { rows: number; bills: number; voided: number; edited: number; units: number; gross: number; discount: number; fee: number; net: number; vat: number; cost: number; profit: number; refund: number };
  byPayment: { payment: string; label: string; bills: number; net: number }[];
}
export interface ProductReportFilter {
  from: string; to: string; branch?: string; q?: string; category?: string; mode?: 'product' | 'sku'; sold?: '0' | '1';
  productId?: number; sort?: string; dir?: 'asc' | 'desc'; page?: number; limit?: number;
}
export interface ProductReportRow {
  key: string; productId: number | null; code: string; name: string; category: string; categoryId: string | null;
  variantId: number | null; sku: string; barcode: string; attribute: string; skuCount: number;
  units: number; bills: number; sales: number; cost: number; profit: number; avgCost: number | null; avgSell: number | null;
  stock: number | null; price: number | null;
}
export interface ProductReport {
  range: { from: string; to: string }; mode: 'product' | 'sku'; soldOnly: boolean; sort: string; dir: 'asc' | 'desc';
  page: number; pages: number; limit: number; rows: ProductReportRow[];
  total: { rows: number; units: number; sales: number; cost: number; profit: number; stock: number };
}
