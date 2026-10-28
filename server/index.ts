// POS API + static web server — ไม่มี dependency ภายนอก (node:http + node:sqlite)
// รัน: node --experimental-strip-types server/index.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createWriteStream, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { countChanges, currentBranch, db, DB_PATH, mainBranchId, setBranch, tx, withBranch } from './db.ts';
import { allowNegativeStock, feeFor, feePayer, forAdmin, getSettings, methodEnabled, publicSettings, saveSection } from './settings.ts';
import { emit, notifyCatalog, testNotify } from './events.ts';
import { daySummary } from './dayreport.ts';
import { deleteHeld, holdBill, listHeld, recallHeld } from './held.ts';
import {
  createExpense, drawerLedger, expenseCategories, expensesCsv, listExpenses, recentShifts, saveExpenseCategories, updateExpense, voidExpense,
  EXPENSE_SOURCES, type ExpenseQuery,
} from './expenses.ts';
import { apiKeyOf, authenticateKey, createKey, listKeys, revokeKey } from './apikeys.ts';
import { createBranch, currentBranchInfo, deleteBranches, getBranch, listBranches, nextCode, resetBranchPrices, updateBranch } from './branches.ts';
import {
  allBranchRole, approveManager, approveVoid, authenticate, clientIp, createStaff, listStaff, login, logout, PIN_LENGTH, requireFeature, switchBranch, tokenOf, updateStaff,
  type Me,
} from './auth.ts';
import { discountFor, HttpError, ORDER_TYPES, PAYMENT_METHODS, round2, getVatRate, type Promo } from './common.ts';
import {
  addRate, addTerminal, deleteRate, deleteTerminal, getTerminal, isExempt, saleTax, saveBranchTax, saveTaxCompany, taxAdmin, terminalFor, updateRate, updateTerminal,
  type Terminal,
} from './tax.ts';
import { taxReport, taxReportXlsx } from './taxReport.ts';
import { cancelTaxInvoice, createCreditNote, creditNoteDoc, issueTaxInvoice, taxInvoiceDoc } from './taxDocs.ts';
import { editOrder, history, historyCsv, orderDetail, voidOrder, type HistoryQuery } from './history.ts';
import {
  cashMove, closeShift, currentShift, listShifts, openShift, recordPayment, requireShift, shiftBrief, shiftDetail,
} from './shifts.ts';
import { dashboard, dashboardCsv } from './dashboard.ts';
import { importProducts } from './productImport.ts';
import { reportXlsx } from './reportExport.ts';
import { shipmentXlsx } from './shipmentExport.ts';
import { shipmentReport, shipmentReportXlsx } from './shipmentReport.ts';
import { billReport, billReportXlsx, productReport, productReportXlsx, salesReport, salesReportXlsx } from './reports.ts';
import { stockXlsx } from './stockExport.ts';
import { XLSX_TYPE } from './xlsx.ts';
import { internalAllowed, shopStats } from './internal.ts';
import { backupBuffer, backupFileName, dropUpload, newUploadPath, previewUpload, restoreBranches } from './backup.ts';
import { docFloor } from './docFloor.ts';
import { permCatalog, resetPerms, savePerms } from './perms.ts';
import { bestAutoDiscount, createPromo, deletePromo, giftsFor, listPromos, previewFor, updatePromo } from './promos.ts';
import { cancelShipment, createShipment, holdShipment, listShipments, restoreShipment, resumeShipment, scanShipment, setShipmentItem, shipmentDetail, shipShipment, updateShipment } from './shipments.ts';
import {
  createCategory, getProduct, listCategories, saveBranchStock, listProducts, listSkus, patchVariant, bulkUpdateSkus, stockCommand, bulkProducts, readUpload, saveProduct, saveUpload, saveUploadVariants, uploadsMissingVariants, setProductActive, stockSummary,
  variantLabel,
} from './products.ts';

const PORT = Number(process.env.PORT ?? 3000);
const WEB_DIR = resolve(process.env.WEB_DIR ?? 'dist');

// ---------- prepared statements (เตรียมครั้งเดียว เร็วขึ้น) ----------
const q = {
  categories: db.prepare('SELECT id, name, name_en AS nameEn, icon, sort FROM categories ORDER BY sort'),
  // หน้าขาย: เฉพาะสินค้า/SKU ที่เปิดแสดงขาย
  products: db.prepare(
    `SELECT p.id, p.sku, p.barcode, p.name, p.category_id AS categoryId, p.price, p.art, p.tint, p.image_url AS imageUrl,
            p.low_stock AS lowStock, p.attrs, p.vat_exempt AS vatExempt
       FROM products p WHERE p.active = 1 AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1)
      ORDER BY p.id`,
  ),
  variants: db.prepare(
    `SELECT v.id, v.product_id AS productId, v.sku, v.barcode, v.size, v.color, v.color_hex AS colorHex, v.extra, v.stock,
            COALESCE(v.price, p.price) AS price
       FROM variants v JOIN products p ON p.id = v.product_id WHERE p.active = 1 AND v.active = 1 ORDER BY v.product_id, v.sort, v.id`,
  ),
  // พนักงานของสาขานี้ + ผู้จัดการ (เลือกเป็นผู้ขายได้)
  staff: db.prepare(
    `SELECT id, name, role FROM staff s WHERE active = 1 AND (role IN ('admin', 'manager')
       OR EXISTS (SELECT 1 FROM staff_branches sb WHERE sb.staff_id = s.id AND sb.branch_id = (SELECT branch_id FROM temp.ctx)))
     ORDER BY role DESC, id`,
  ),
  promo: db.prepare('SELECT code, label, type, value, min_total AS minTotal FROM promos WHERE code = ? AND active = 1'),
  variantForSale: db.prepare(
    `SELECT v.id, v.sku, v.size, v.color, v.extra, v.stock, p.name, COALESCE(v.price, p.price) AS price
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND p.active = 1 AND v.active = 1`,
  ),
  decStock: db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?'),
  /** ตั้งค่า "ขายได้แม้สต็อกหมด" → ตัดสต็อกได้จนติดลบ */
  decStockAny: db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ?'),
  stockOf: db.prepare('SELECT id, stock FROM variants WHERE id = ?'),
  countToday: db.prepare(`SELECT COUNT(*) AS n FROM orders_all WHERE order_no LIKE ?`),
  insOrder: db.prepare(
    `INSERT INTO orders_all (order_no, customer_name, salesperson, order_type, subtotal, discount, vat, total,
                         promo_code, payment_method, cash_received, change_due, shift_id, fee, fee_payer,
                         vat_rate, vat_base, exempt_amount, terminal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  insItem: db.prepare(
    `INSERT INTO order_items (order_id, variant_id, product_name, sku, size, color, extra, qty, unit_price, line_total, vat_exempt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  recentOrders: db.prepare(
    `SELECT id, order_no AS orderNo, customer_name AS customerName, salesperson, order_type AS orderType,
            subtotal, discount, vat, total, promo_code AS promoCode, payment_method AS paymentMethod,
            cash_received AS cashReceived, change_due AS changeDue, status, created_at AS createdAt,
            vat_rate AS vatRate, vat_base AS vatBase, exempt_amount AS exemptAmount, terminal_id AS terminalId
       FROM orders ORDER BY id DESC LIMIT ?`,
  ),
  itemsOf: db.prepare(
    `SELECT product_name AS name, sku, size, color, extra, qty, unit_price AS unitPrice, line_total AS lineTotal, vat_exempt AS vatExempt
       FROM order_items WHERE order_id = ?`,
  ),
};


/**
 * เลขที่บิล: สาขาหลัก INV-251011-0001 · สาขาอื่นมีรหัสสาขา INV-B02-251011-0001 (ไม่ซ้ำกันข้ามสาขา)
 * ตั้งเครื่อง POS แล้ว → มีรหัสเครื่องด้วย INV-POS01-251011-0001 (เลขรันต่อเครื่อง ตามข้อกำหนดกรมสรรพากร)
 */
function todayPrefix(t: Terminal | null) {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  const b = currentBranchInfo();
  const code = b.isMain ? '' : `${b.code.replace(/[^A-Za-z0-9]/g, '') || b.id}-`;
  return `INV-${code}${t ? `${t.code}-` : ''}${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-`;
}
function nextOrderNo(t: Terminal | null = null) {
  const prefix = todayPrefix(t);
  const { n } = q.countToday.get(prefix + '%') as { n: number };
  return prefix + String(Math.max(n, docFloor(prefix)) + 1).padStart(4, '0');
}


/** เพิ่ม/แก้/ลบสินค้า หมวดหมู่ = ทำที่สาขาหลัก (ทุกสาขาใช้รายการสินค้าเดียวกัน) */
function requireMain() {
  if (currentBranch() !== mainBranchId())
    throw new HttpError(403, 'เพิ่ม/แก้ไขสินค้าทำได้ที่สาขาหลัก — สาขานี้ปรับได้เฉพาะสต็อกและราคาขาย (หน้า สต็อกสินค้า (คุณสมบัติ))', 'MAIN_ONLY');
}

// ---------- handlers ----------
function bootstrap(terminalHeader?: unknown) {
  const terminal = terminalFor(terminalHeader);
  return {
    categories: q.categories.all(),
    products: (q.products.all() as { attrs: string | null; vatExempt: number }[]).map((p) => ({ ...p, vatExempt: !!p.vatExempt, attrs: p.attrs ? JSON.parse(p.attrs) : [] })),
    variants: q.variants.all(),
    staff: q.staff.all(),
    orderTypes: ORDER_TYPES,
    vatRate: getVatRate(),
    nextOrderNo: nextOrderNo(terminal),
    terminal,
    shift: shiftBrief(),
    stockAlerts: stockSummary(),
    settings: publicSettings(),
  };
}

function checkPromo(code: string, subtotal: number) {
  const promo = q.promo.get(code.trim().toUpperCase()) as Promo | undefined;
  if (!promo) throw new HttpError(404, 'ไม่พบโค้ดส่วนลดนี้');
  if (subtotal < promo.minTotal)
    throw new HttpError(422, `ต้องซื้อขั้นต่ำ ฿${promo.minTotal.toLocaleString()} เพื่อใช้โค้ดนี้`);
  return { ...promo, discount: discountFor(promo, subtotal) };
}

interface OrderBody {
  customerName?: string;
  salesperson?: string;
  orderType?: string;
  promoCode?: string;
  paymentMethod?: string;
  cashReceived?: number;
  items?: { variantId: number; qty: number }[];
}

function createOrder(body: OrderBody, terminalHeader?: unknown) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new HttpError(400, 'ยังไม่มีสินค้าในรายการ');
  if (items.length > 200) throw new HttpError(400, 'รายการสินค้ามากเกินไป');
  const orderType = ORDER_TYPES.includes(body.orderType ?? '') ? body.orderType! : ORDER_TYPES[0];
  const payment = body.paymentMethod ?? '';
  if (!PAYMENT_METHODS.includes(payment)) throw new HttpError(400, 'กรุณาเลือกวิธีชำระเงิน');
  if (!methodEnabled(payment)) throw new HttpError(400, 'วิธีชำระเงินนี้ถูกปิดใช้งาน (ตั้งค่า → วิธีชำระเงิน)');

  const shift = requireShift(); // ต้องเปิดกะก่อนขาย
  const terminal = terminalFor(terminalHeader); // เครื่อง POS ที่ออกบิล

  return tx(() => {
    // ราคาและสต็อกคำนวณจากฐานข้อมูลเสมอ (ไม่เชื่อราคาจากฝั่ง client)
    const lines = items.map(({ variantId, qty }) => {
      const qn = Math.floor(Number(qty));
      if (!Number.isFinite(qn) || qn <= 0 || qn > 999) throw new HttpError(400, 'จำนวนสินค้าไม่ถูกต้อง');
      const v = q.variantForSale.get(Number(variantId)) as
        | { id: number; sku: string; size: string; color: string; extra: string; stock: number; name: string; price: number }
        | undefined;
      if (!v) throw new HttpError(404, `ไม่พบสินค้า #${variantId}`);
      if (v.stock < qn && !allowNegativeStock())
        throw new HttpError(409, `${v.name} (${variantLabel(v)}) คงเหลือ ${v.stock} ชิ้น`);
      return { ...v, qty: qn, lineTotal: round2(v.price * qn), exempt: isExempt(v.id) };
    });

    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    let discount = 0;
    let promoCode: string | null = null;
    if (body.promoCode) {
      const p = checkPromo(body.promoCode, subtotal);
      discount = p.discount;
      promoCode = p.code;
    } else {
      // ไม่ได้กรอกโค้ด → ใช้โปรโมชั่นอัตโนมัติที่ลดได้มากที่สุด
      const auto = bestAutoDiscount(subtotal);
      if (auto) {
        discount = auto.discount;
        promoCode = auto.promo.code;
      }
    }
    // ของแถมอัตโนมัติ (เช่น ซื้อครบ 2,000 แถมกระเป๋า) — เพิ่มเป็นรายการราคา 0 ตัดสต็อกจริง
    for (const g of giftsFor(subtotal)) {
      const v = q.variantForSale.get(g.variantId) as
        | { id: number; sku: string; size: string; color: string; extra: string; stock: number; name: string; price: number }
        | undefined;
      if (!v) continue;
      if (v.stock < g.qty && !allowNegativeStock()) continue; // ของแถมหมด → ขายต่อได้ ไม่ขวางการชำระเงิน
      lines.push({ ...v, price: 0, qty: g.qty, lineTotal: 0, exempt: isExempt(v.id) });
    }
    // ค่าธรรมเนียม (เช่น บัตรเครดิต) คิดจากยอดสินค้าหลังส่วนลด — ลูกค้าจ่ายเพิ่ม หรือร้านจ่ายเอง ตามตั้งค่า
    const goods = round2(subtotal - discount);
    const fee = feeFor(payment, goods);
    const payer = feePayer();
    const total = round2(goods + (payer === 'customer' ? fee : 0));
    // VAT ตามอัตราที่มีผลวันนี้ (ตารางอัตรา VAT) · แยกสินค้ายกเว้น VAT
    const tax = saleTax(lines, subtotal, discount, total);
    const vat = tax.vat;

    let cashReceived: number | null = null;
    let change: number | null = null;
    if (payment === 'cash') {
      cashReceived = round2(Number(body.cashReceived ?? total));
      if (!(cashReceived >= total)) throw new HttpError(422, 'รับเงินสดไม่พอ');
      change = round2(cashReceived - total);
    }

    const orderNo = nextOrderNo(terminal);
    const res = q.insOrder.run(
      orderNo,
      body.customerName?.trim().slice(0, 80) || null,
      body.salesperson?.slice(0, 80) || null,
      orderType,
      subtotal,
      discount,
      vat,
      total,
      promoCode,
      payment,
      cashReceived,
      change,
      shift.id,
      fee,
      payer,
      tax.vatRate,
      tax.vatBase,
      tax.exempt,
      terminal?.id ?? null,
    );
    const orderId = Number(res.lastInsertRowid);
    recordPayment(shift.id, orderId, 'sale', payment, total);
    for (const l of lines) {
      const dec = allowNegativeStock() ? () => q.decStockAny.run(l.qty, l.id) : () => q.decStock.run(l.qty, l.id, l.qty);
      if (countChanges(dec) !== 1) throw new HttpError(409, `${l.name} สต็อกไม่พอ`);
      q.insItem.run(orderId, l.id, l.name, l.sku, l.size, l.color, l.extra, l.qty, l.price, l.lineTotal, l.exempt ? 1 : 0);
    }

    // สินค้าที่เพิ่งลดลงถึงจุดแจ้งเตือน/หมด (ส่ง LINE/WhatsApp/Webhook หลังบันทึกสำเร็จ)
    const lowNow = lines
      .map((l) => ({ l, after: (q.stockOf.get(l.id) as { stock: number }).stock, low: (db.prepare('SELECT p.low_stock AS n FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').get(l.id) as { n: number }).n }))
      .map((x) => ({ ...x, item: { variantId: x.l.id, name: x.l.name, label: variantLabel(x.l), sku: x.l.sku, stock: x.after } }));
    // หมดพอดีจากบิลนี้ → stock.out · ลดลงถึงจุดแจ้งเตือน (ยังไม่หมด) → stock.low
    const outNow = lowNow.filter((x) => x.after <= 0 && x.after + x.l.qty > 0).map((x) => x.item);
    const lowOnly = lowNow.filter((x) => x.after > 0 && x.after <= x.low && x.after + x.l.qty > x.low).map((x) => x.item);
    const bid = currentBranch();
    setImmediate(() => withBranch(bid, () => {
      emit('order.created', {
        id: orderId, orderNo, total, subtotal, discount, fee, paymentMethod: payment, orderType, customer: body.customerName?.trim() || null,
        salesperson: body.salesperson ?? null, itemCount: lines.reduce((a, l) => a + l.qty, 0),
        items: lines.map((l) => ({ sku: l.sku, name: l.name, label: variantLabel(l), qty: l.qty, price: l.price })),
      });
      if (lowOnly.length) emit('stock.low', { items: lowOnly });
      if (outNow.length) emit('stock.out', { items: outNow });
    }));

    return {
      order: {
        id: orderId, orderNo, orderType, subtotal, discount, vat, total, promoCode, fee, feePayer: payer,
        paymentMethod: payment, cashReceived, changeDue: change,
        vatRate: tax.vatRate, vatBase: tax.vatBase, exemptAmount: tax.exempt, terminal: terminal ? { code: terminal.code, rdNo: terminal.rdNo } : null,
        items: lines.map((l) => ({ name: l.name, sku: l.sku, size: l.size, color: l.color, extra: l.extra, qty: l.qty, unitPrice: l.price, lineTotal: l.lineTotal, vatExempt: l.exempt })),
      },
      stock: lines.map((l) => q.stockOf.get(l.id)),
      nextOrderNo: nextOrderNo(terminal),
    };
  });
}

function recentOrders(limit: number) {
  const rows = q.recentOrders.all(Math.min(Math.max(limit, 1), 100)) as { id: number; terminalId: number | null }[];
  return rows.map((o) => {
    const t = o.terminalId ? getTerminal(o.terminalId) : null;
    return {
      ...o, terminal: t ? { code: t.code, rdNo: t.rdNo } : null,
      items: (q.itemsOf.all(o.id) as { vatExempt: number }[]).map((i) => ({ ...i, vatExempt: !!i.vatExempt })),
    };
  });
}

// ---------- http helpers ----------
/** ?branch=<id> → สำรองเฉพาะสาขา · ไม่ระบุ/all = ทั้งร้าน */
function branchParam(url: URL): number | undefined {
  const v = url.searchParams.get('branch');
  if (!v || v === 'all') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'สาขาไม่ถูกต้อง');
  return n;
}

/** รับไฟล์ที่อัปโหลด (body ดิบ) ลงดิสก์ — จำกัดขนาด */
function receiveFile(req: IncomingMessage, file: string, limit: number) {
  return new Promise<void>((ok, fail) => {
    const out = createWriteStream(file);
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        out.destroy();
        try { unlinkSync(file); } catch { /* ไม่มีไฟล์ */ }
        fail(new HttpError(413, `ไฟล์ใหญ่เกิน ${Math.round(limit / 1048576)} MB`));
      }
    });
    req.pipe(out);
    out.on('finish', () => (size ? ok() : fail(new HttpError(400, 'ไม่ได้แนบไฟล์'))));
    out.on('error', fail);
    req.on('error', fail);
  });
}

function send(req: IncomingMessage, res: ServerResponse, status: number, body: Buffer | string, type: string, cache = 'no-store') {
  let buf = typeof body === 'string' ? Buffer.from(body) : body;
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Cache-Control': cache,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };
  if (buf.length > 1024 && /gzip/.test(String(req.headers['accept-encoding'])) && /json|javascript|html|css|svg|text/.test(type)) {
    buf = gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  headers['Content-Length'] = String(buf.length);
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const json = (req: IncomingMessage, res: ServerResponse, status: number, data: unknown) =>
  send(req, res, status, JSON.stringify(data), 'application/json; charset=utf-8');

/** สาขาของ request นี้ — ตั้งใหม่ทุกครั้งหลัง await (request อื่นอาจเปลี่ยนสาขาระหว่างรออ่าน body) */
const branchOfReq = new WeakMap<IncomingMessage, number>();
function readBody(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return readBodyRaw(req, limit).then((v) => {
    const b = branchOfReq.get(req);
    if (b !== undefined) setBranch(b);
    return v;
  });
}
function readBodyRaw(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new HttpError(413, 'Payload too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        fail(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', fail);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.map': 'application/json',
};
const fileCache = new Map<string, Buffer>();

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (!existsSync(WEB_DIR)) {
    return send(req, res, 503, 'Web build not found. Run "npm run build:web" first.', 'text/plain; charset=utf-8');
  }
  let file = normalize(join(WEB_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(WEB_DIR)) return send(req, res, 403, 'Forbidden', 'text/plain');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIR, 'index.html'); // SPA fallback
  let buf = fileCache.get(file);
  if (!buf) {
    buf = readFileSync(file);
    if (process.env.NODE_ENV === 'production') fileCache.set(file, buf);
  }
  const hashed = /\/_expo\/static\/|\/assets\//.test(file);
  send(req, res, 200, buf, MIME[extname(file)] ?? 'application/octet-stream',
    hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
}

// ---------- router ----------
const server = createServer(async (req, res) => {
  const started = performance.now();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Branch, X-POS-Terminal',
      });
      return res.end();
    }
    if (path.startsWith('/api/')) {
      if (req.method === 'GET' && path === '/api/health') return json(req, res, 200, { ok: true }); // ไม่เปิดเผยที่อยู่ไฟล์ฐานข้อมูล

      // ----- API ภายใน (เซิร์ฟเวอร์ license เรียก) — ไม่มี token ที่ถูกต้อง = ไม่มีเส้นทางนี้ -----
      if (path.startsWith('/api/internal/')) {
        if (!internalAllowed(req)) throw new HttpError(404, 'Not found');
        if (req.method === 'GET' && path === '/api/internal/stats') return json(req, res, 200, shopStats());
        if (req.method === 'GET' && path === '/api/internal/backup') return send(req, res, 200, backupBuffer(branchParam(url)), 'application/vnd.sqlite3');
        throw new HttpError(404, 'Not found');
      }

      // ----- เข้าสู่ระบบด้วย PIN (ไม่ต้องมี token) -----
      if (req.method === 'POST' && path === '/api/auth/login') {
        const body = (await readBody(req)) as { pin?: string };
        return json(req, res, 200, login(body.pin, clientIp(req)));
      }
      if (req.method === 'GET' && path === '/api/auth/config') return json(req, res, 200, { pinLength: PIN_LENGTH, shop: { name: getSettings().shop.name } });

      // ----- ทุก API ด้านล่างต้องเข้าสู่ระบบ -----
      const apiKey = apiKeyOf(req);
      const me: Me = apiKey ? authenticateKey(apiKey, req.method ?? 'GET', req) : authenticate(req, url);
      // ข้อมูลทั้งหมดของ request นี้เป็นของสาขาที่เลือกไว้
      setBranch(me.branchId);
      branchOfReq.set(req, me.branchId);

      // ----- สำรอง / กู้คืนข้อมูล (ผู้จัดการ) -----
      if (path.startsWith('/api/backup/')) {
        requireFeature(me, 'settings', 'edit');
        if (req.method === 'GET' && path === '/api/backup/download') {
          const branch = branchParam(url);
          const buf = backupBuffer(branch);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.sqlite3', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
            'Content-Disposition': `attachment; filename="backup.db"; filename*=UTF-8''${encodeURIComponent(backupFileName(branch))}`,
            'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff',
          });
          return res.end(buf);
        }
        if (req.method === 'POST' && path === '/api/backup/upload') {
          const up = newUploadPath();
          await receiveFile(req, up.path, 500 * 1024 * 1024);
          try {
            return json(req, res, 200, previewUpload(up.id));
          } catch (e) {
            dropUpload(up.id);
            throw e;
          }
        }
        if (req.method === 'POST' && path === '/api/backup/restore') {
          const body = (await readBody(req)) as { id?: string; branchIds?: unknown; pin?: string };
          const by = approveManager(body.pin, clientIp(req), 'settings');
          const ids = Array.isArray(body.branchIds) ? body.branchIds.map(Number).filter(Number.isInteger) : [];
          return json(req, res, 200, restoreBranches(String(body.id ?? ''), ids, by));
        }
        if (req.method === 'POST' && path === '/api/backup/discard') {
          const body = (await readBody(req)) as { id?: string };
          if (/^[a-f0-9]{24}$/.test(String(body.id))) dropUpload(String(body.id));
          return json(req, res, 200, { ok: true });
        }
        throw new HttpError(404, 'Not found');
      }

      // ----- สาขา: สาขาที่เข้าได้ + สลับสาขา -----
      if (path === '/api/branches' && req.method === 'GET') {
        const list = listBranches().filter((b) => me.branchIds.includes(b.id)).map((b) => ({ ...b, current: b.id === me.branchId }));
        return json(req, res, 200, { current: list.find((b) => b.current) ?? null, list });
      }
      if (path === '/api/branches/switch' && req.method === 'POST') {
        return json(req, res, 200, switchBranch(req, url, me, ((await readBody(req)) as { id?: unknown }).id));
      }
      if (req.method === 'GET' && path === '/api/auth/me') return json(req, res, 200, me);
      if (req.method === 'POST' && path === '/api/auth/logout') return json(req, res, 200, logout(tokenOf(req, url)));

      // ----- จัดการพนักงาน (ผู้จัดการ) -----
      // ----- สิทธิ์ตามบทบาท (ดูได้ถ้าเปิดเมนูพนักงานได้ · แก้ได้เฉพาะคนที่แก้เมนูพนักงานได้) -----
      if (path === '/api/perms' && req.method === 'GET') { requireFeature(me, 'staff', 'view'); return json(req, res, 200, permCatalog()); }
      {
        const pm = /^\/api\/perms\/([a-z]+)(\/reset)?$/.exec(path);
        if (pm && req.method === 'PUT' && !pm[2]) {
          requireFeature(me, 'staff', 'edit');
          return json(req, res, 200, savePerms(pm[1], ((await readBody(req)) as { perms?: Record<string, string> }).perms ?? {}));
        }
        if (pm && req.method === 'POST' && pm[2]) { requireFeature(me, 'staff', 'edit'); return json(req, res, 200, resetPerms(pm[1])); }
      }
      if (path === '/api/staff' && req.method === 'GET') { requireFeature(me, 'staff', 'view'); return json(req, res, 200, listStaff()); }
      if (path === '/api/staff' && req.method === 'POST') { requireFeature(me, 'staff', 'edit'); return json(req, res, 201, createStaff((await readBody(req)) as never, me)); }
      const st = path.match(/^\/api\/staff\/(\d+)$/);
      if (st && req.method === 'PUT') { requireFeature(me, 'staff', 'edit'); return json(req, res, 200, updateStaff(Number(st[1]), (await readBody(req)) as never, me)); }
      if (req.method === 'GET' && path === '/api/bootstrap') return json(req, res, 200, bootstrap(req.headers['x-pos-terminal']));
      // ----- โปรโมชั่น / ส่วนลด -----
      if (path === '/api/promos' && req.method === 'GET') { requireFeature(me, 'promos', 'view'); return json(req, res, 200, listPromos()); }
      if (path === '/api/promos' && req.method === 'POST') { requireFeature(me, 'promos', 'edit'); return json(req, res, 201, createPromo((await readBody(req)) as never)); }
      if (path === '/api/promos/preview' && req.method === 'GET') {
        return json(req, res, 200, previewFor(Math.max(0, Number(url.searchParams.get('subtotal') ?? 0) || 0)));
      }
      {
        const pc = /^\/api\/promos\/([A-Za-z0-9_-]{2,20})$/.exec(path);
        if (pc && req.method === 'PUT') { requireFeature(me, 'promos', 'edit'); return json(req, res, 200, updatePromo(pc[1].toUpperCase(), (await readBody(req)) as never)); }
        if (pc && req.method === 'DELETE') { requireFeature(me, 'promos', 'edit'); return json(req, res, 200, deletePromo(pc[1].toUpperCase())); }
      }
      if (req.method === 'GET' && path.startsWith('/api/promos/')) {
        const code = decodeURIComponent(path.slice('/api/promos/'.length));
        return json(req, res, 200, checkPromo(code, Number(url.searchParams.get('subtotal') ?? 0)));
      }
      if (req.method === 'GET' && path === '/api/orders')
        return json(req, res, 200, recentOrders(Number(url.searchParams.get('limit') ?? 20)));
      if (req.method === 'POST' && path === '/api/orders') {
        const body = (await readBody(req)) as OrderBody;
        body.salesperson = body.salesperson || me.name; // ค่าเริ่มต้น = ผู้ที่ล็อกอิน
        return json(req, res, 201, createOrder(body, req.headers['x-pos-terminal']));
      }

      // ----- ประวัติการขาย / แก้ไขบิล -----
      if (req.method === 'GET' && (path === '/api/history' || path === '/api/history.csv')) {
        const p = url.searchParams;
        const f: HistoryQuery = {
          from: p.get('from') ?? undefined, to: p.get('to') ?? undefined,
          timeFrom: p.get('timeFrom') ?? undefined, timeTo: p.get('timeTo') ?? undefined,
          q: p.get('q') ?? undefined, status: p.get('status') ?? undefined, payment: p.get('payment') ?? undefined,
          limit: Number(p.get('limit') ?? 50), offset: Number(p.get('offset') ?? 0),
        };
        if (path === '/api/history') return json(req, res, 200, history(f));
        res.setHeader('Content-Disposition', `attachment; filename="sales-${f.from ?? 'all'}-${f.to ?? 'all'}.csv"`);
        return send(req, res, 200, historyCsv(f), 'text/csv; charset=utf-8');
      }
      // ----- สต็อกสินค้า -----
      if (path === '/api/products' && req.method === 'GET') {
        const p = url.searchParams;
        return json(req, res, 200, listProducts({ q: p.get('q') ?? undefined, category: p.get('category') ?? undefined, status: p.get('status') ?? undefined }, me));
      }
      if (path === '/api/products' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); requireMain(); return json(req, res, 201, saveProduct(null, (await readBody(req)) as never, me)); }
      if (path === '/api/products/import' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); requireMain(); return json(req, res, 200, importProducts((await readBody(req, 8_000_000)) as never, me)); }
      if (path === '/api/stock/alerts' && req.method === 'GET') return json(req, res, 200, stockSummary());
      // ส่งออกสต็อก (Excel) — ชีตแรกนำเข้ากลับได้ที่ "นำเข้าสินค้า" · ?branch=all (ผู้จัดการ) = เพิ่มชีตสต็อกทุกสาขา
      if (path === '/api/stock/export.xlsx' && req.method === 'GET') {
        const d = new Date();
        const p2 = (n: number) => String(n).padStart(2, '0');
        res.setHeader('Content-Disposition', `attachment; filename="stock-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.xlsx"`);
        return send(req, res, 200, stockXlsx(me), XLSX_TYPE);
      }
      // ----- ตั้งค่า (ผู้จัดการ) -----
      // ----- ภาษีมูลค่าเพิ่ม (ผู้จัดการ) -----
      if (path.startsWith('/api/tax')) {
        // เครื่องนี้เลือกเครื่อง POS ได้ทุกคน (ดูรายการเครื่องของสาขา)
        if (path === '/api/tax/terminals' && req.method === 'GET') {
          const b = currentBranch() || mainBranchId();
          return json(req, res, 200, taxAdmin().terminals.filter((t) => t.branchId === b && t.active));
        }
        requireFeature(me, 'settings', 'edit');
        if (path === '/api/tax' && req.method === 'GET') return json(req, res, 200, taxAdmin());
        if (path === '/api/tax/company' && req.method === 'PUT') return json(req, res, 200, saveTaxCompany((await readBody(req)) as never));
        if (path === '/api/tax/rates' && req.method === 'POST') return json(req, res, 201, addRate((await readBody(req)) as never, me.name));
        if (path === '/api/tax/terminals' && req.method === 'POST') return json(req, res, 201, addTerminal((await readBody(req)) as never));
        const tm = /^\/api\/tax\/(branches|rates|terminals)\/(\d+)$/.exec(path);
        if (tm) {
          const id = Number(tm[2]);
          if (tm[1] === 'branches' && req.method === 'PUT') return json(req, res, 200, saveBranchTax(id, (await readBody(req)) as never));
          if (tm[1] === 'rates' && req.method === 'PUT') return json(req, res, 200, updateRate(id, (await readBody(req)) as never));
          if (tm[1] === 'rates' && req.method === 'DELETE') return json(req, res, 200, deleteRate(id));
          if (tm[1] === 'terminals' && req.method === 'PUT') return json(req, res, 200, updateTerminal(id, (await readBody(req)) as never));
          if (tm[1] === 'terminals' && req.method === 'DELETE') return json(req, res, 200, deleteTerminal(id));
        }
        // รายงานภาษีขาย: สรุปรายวันต่อเครื่อง + รายบิล + บิลยกเลิก (+ Excel)
        if ((path === '/api/tax/report' || path === '/api/tax/report.xlsx') && req.method === 'GET') {
          const sp = url.searchParams;
          const bq = sp.get('branch');
          if (bq === 'all') setBranch(0);
          else if (bq && me.branchIds.includes(Number(bq))) setBranch(Number(bq));
          const f = Object.fromEntries(sp.entries()) as Record<string, string>;
          if (path === '/api/tax/report') return json(req, res, 200, taxReport(f));
          const { file, range } = taxReportXlsx(f);
          res.setHeader('Content-Disposition', `attachment; filename="sales-tax-report-${range.from}-to-${range.to}.xlsx"`);
          return send(req, res, 200, file, XLSX_TYPE);
        }
      }
      if (path === '/api/settings' && req.method === 'GET') { requireFeature(me, 'settings', 'view'); return json(req, res, 200, { settings: forAdmin(), keys: listKeys() }); }
      {
        const sm2 = /^\/api\/settings\/([a-z]+)$/.exec(path);
        if (sm2 && req.method === 'PUT') {
          requireFeature(me, 'settings', 'edit');
          let body = (await readBody(req)) as Record<string, unknown>;
          if (sm2[1] === 'stock') body = { ...body, sync: getSettings().stock.sync };
          return json(req, res, 200, { settings: saveSection(sm2[1], body) });
        }
      }
      if (path === '/api/settings/notify/test' && req.method === 'POST') {
        requireFeature(me, 'settings', 'edit');
        const b = (await readBody(req)) as { channel?: string; event?: string };
        return json(req, res, 200, await testNotify(String(b.channel ?? ''), b.event ? String(b.event) : undefined));
      }
      if (path === '/api/settings/notify/catalog' && req.method === 'GET') { requireFeature(me, 'settings', 'view'); return json(req, res, 200, notifyCatalog()); }
      if (path === '/api/settings/keys' && req.method === 'POST') { requireFeature(me, 'settings', 'edit'); return json(req, res, 201, createKey((await readBody(req)) as never, me)); }
      {
        const km = /^\/api\/settings\/keys\/(\d+)$/.exec(path);
        if (km && req.method === 'DELETE') { requireFeature(me, 'settings', 'edit'); return json(req, res, 200, revokeKey(Number(km[1]))); }
      }
      // ----- จัดการสาขา (ผู้จัดการ) -----
      if (path === '/api/branches/manage' && req.method === 'GET') {
        requireFeature(me, 'branches', 'view');
        return json(req, res, 200, { currentId: me.branchId, mainId: mainBranchId(), nextCode: nextCode(), list: listBranches() });
      }
      if (path === '/api/branches' && req.method === 'POST') { requireFeature(me, 'branches', 'edit'); return json(req, res, 201, createBranch((await readBody(req)) as never)); }
      if (path === '/api/branches/delete' && req.method === 'POST') { requireFeature(me, 'branches', 'edit'); return json(req, res, 200, deleteBranches(((await readBody(req)) as { ids?: unknown }).ids)); }
      if (path === '/api/branches/reset-prices' && req.method === 'POST') { requireFeature(me, 'branches', 'edit'); return json(req, res, 200, resetBranchPrices(((await readBody(req)) as { variantIds?: unknown }).variantIds)); }
      {
        const bm = /^\/api\/branches\/(\d+)$/.exec(path);
        if (bm && req.method === 'PUT') { requireFeature(me, 'branches', 'edit'); return json(req, res, 200, updateBranch(Number(bm[1]), (await readBody(req)) as never)); }
        if (bm && req.method === 'GET') { requireFeature(me, 'branches', 'view'); return json(req, res, 200, getBranch(Number(bm[1]))); }
      }
      if (path === '/api/products/bulk' && req.method === 'POST') {
        requireFeature(me, 'stock', 'edit');
        const body = (await readBody(req)) as { action?: string };
        if (body.action !== 'zero') requireMain(); // ล้างสต็อก = เฉพาะสาขานี้ · อย่างอื่นเปลี่ยนสินค้าทุกสาขา
        return json(req, res, 200, bulkProducts(body as never, me));
      }
      // ---- ส่งของจากโรงงาน (ใบส่งของ DO) — ผู้จัดการเท่านั้น (ย้ายสต็อกข้ามสาขา) ----
      if (path === '/api/shipments' && req.method === 'GET') { requireFeature(me, 'shipments', 'view'); return json(req, res, 200, listShipments()); }
      if (path === '/api/shipments' && req.method === 'POST') { requireFeature(me, 'shipments', 'edit'); return json(req, res, 201, createShipment((await readBody(req)) as never, me)); }
      // รายงานการส่ง: ใบส่งของที่ส่งออกแล้วในช่วงวันที่ (+ Excel รวมรายการสินค้า)
      if ((path === '/api/shipments/report' || path === '/api/shipments/report.xlsx') && req.method === 'GET') {
        requireFeature(me, 'shipments', 'view');
        const f = Object.fromEntries(url.searchParams.entries()) as Record<string, string>;
        if (path === '/api/shipments/report') return json(req, res, 200, shipmentReport(f));
        const { file, range } = shipmentReportXlsx(f);
        res.setHeader('Content-Disposition', `attachment; filename="shipment-report-${range.from}-to-${range.to}.xlsx"`);
        return send(req, res, 200, file, XLSX_TYPE);
      }
      {
        // ใบส่งของเป็น Excel (หน้าตาเดียวกับใบพิมพ์ A4)
        const se = /^\/api\/shipments\/(\d+)\/export\.xlsx$/.exec(path);
        if (se && req.method === 'GET') {
          requireFeature(me, 'shipments', 'view');
          const { file, docNo } = shipmentXlsx(Number(se[1]));
          res.setHeader('Content-Disposition', `attachment; filename="${docNo.replace(/[^\w.-]/g, '_')}.xlsx"`);
          return send(req, res, 200, file, XLSX_TYPE);
        }
      }
      {
        const sh = /^\/api\/shipments\/(\d+)(?:\/(scan|ship|cancel|restore|hold|resume|items\/(\d+)))?$/.exec(path);
        if (sh) {
          requireFeature(me, 'shipments', 'edit');
          const id = Number(sh[1]);
          if (!sh[2] && req.method === 'GET') return json(req, res, 200, shipmentDetail(id));
          if (!sh[2] && req.method === 'PATCH') return json(req, res, 200, updateShipment(id, (await readBody(req)) as never));
          if (sh[2] === 'scan' && req.method === 'POST') return json(req, res, 200, scanShipment(id, (await readBody(req)) as never));
          if (sh[2] === 'ship' && req.method === 'POST') return json(req, res, 200, shipShipment(id, me));
          if (sh[2] === 'cancel' && req.method === 'POST') return json(req, res, 200, cancelShipment(id, (await readBody(req)) as never, me));
          if (sh[2] === 'restore' && req.method === 'POST') return json(req, res, 200, restoreShipment(id));
          if (sh[2] === 'hold' && req.method === 'POST') return json(req, res, 200, holdShipment(id, me));
          if (sh[2] === 'resume' && req.method === 'POST') return json(req, res, 200, resumeShipment(id));
          if (sh[3] && req.method === 'PUT') return json(req, res, 200, setShipmentItem(id, Number(sh[3]), (await readBody(req)) as never));
        }
      }
      if (path === '/api/stock/command' && req.method === 'POST') return json(req, res, 200, stockCommand((await readBody(req, 2_000_000)) as never, me));
      if (path === '/api/stock/skus' && req.method === 'GET') {
        const sp = url.searchParams;
        const g = (k: string) => sp.get(k) ?? undefined;
        return json(req, res, 200, listSkus({ q: g('q'), category: g('category'), status: g('status'), sort: g('sort'), dir: g('dir'), page: g('page'), limit: g('limit') }, me));
      }
      {
        const vm = /^\/api\/variants\/(\d+)$/.exec(path);
        if (vm && req.method === 'PATCH') return requireMain(), json(req, res, 200, patchVariant(Number(vm[1]), (await readBody(req)) as { barcode?: string; active?: boolean }, me));
      }
      if (path === '/api/categories' && req.method === 'GET') return json(req, res, 200, listCategories());
      if (path === '/api/categories' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); requireMain(); return json(req, res, 201, createCategory((await readBody(req)) as never)); }
      if (path === '/api/uploads' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); return json(req, res, 201, saveUpload((await readBody(req, 6_000_000)) as never)); }
      if (path === '/api/uploads/variants' && req.method === 'GET') { requireFeature(me, 'stock', 'edit'); return json(req, res, 200, { urls: uploadsMissingVariants() }); }
      if (path === '/api/uploads/variants' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); return json(req, res, 200, saveUploadVariants((await readBody(req, 3_000_000)) as never)); }
      {
        const bm = /^\/api\/products\/(\d+)\/skus$/.exec(path);
        if (bm && req.method === 'PUT') { requireFeature(me, 'stock', 'edit'); return json(req, res, 200, bulkUpdateSkus(Number(bm[1]), (await readBody(req)) as never, me)); }
      }
      const pm = path.match(/^\/api\/products\/(\d+)(\/active)?$/);
      if (pm) {
        const pid = Number(pm[1]);
        if (!pm[2] && req.method === 'GET') return json(req, res, 200, getProduct(pid, me));
        if (!pm[2] && req.method === 'PUT') {
          requireFeature(me, 'stock', 'edit');
          const body = (await readBody(req)) as never;
          // สาขาย่อย: บันทึกได้เฉพาะจำนวน/ราคาขายของสาขา · สาขาหลัก: แก้สินค้าได้ทั้งหมด
          return json(req, res, 200, currentBranch() === mainBranchId() ? saveProduct(pid, body, me) : saveBranchStock(pid, body, me));
        }
        if (pm[2] && req.method === 'PUT') { requireFeature(me, 'stock', 'edit'); requireMain(); return json(req, res, 200, setProductActive(pid, !!((await readBody(req)) as { active?: boolean }).active)); }
      }

      // ----- รายงาน / Dashboard (ผู้จัดการ) -----
      if ((path === '/api/dashboard' || path === '/api/dashboard.csv' || path === '/api/dashboard.xlsx') && req.method === 'GET') {
        requireFeature(me, 'reports', 'view');
        const f = { from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined };
        // ?branch=all = รวมทุกสาขา · ?branch=<id> = สาขาที่เลือก
        const bq = url.searchParams.get('branch');
        if (bq === 'all') setBranch(0);
        else if (bq && me.branchIds.includes(Number(bq))) setBranch(Number(bq));
        if (path === '/api/dashboard') return json(req, res, 200, dashboard(f));
        if (path === '/api/dashboard.xlsx') {
          const d = dashboard(f);
          const bName = currentBranchInfo().name;
          const scope = currentBranch() === 0 ? 'รวมทุกสาขา' : bName.startsWith('สาขา') ? bName : `สาขา ${bName}`;
          res.setHeader('Content-Disposition', `attachment; filename="report-${d.range.from}-to-${d.range.to}.xlsx"`);
          return send(req, res, 200, reportXlsx(f, scope), XLSX_TYPE);
        }
        res.setHeader('Content-Disposition', `attachment; filename="report-${f.from ?? ''}-${f.to ?? ''}.csv"`);
        return send(req, res, 200, dashboardCsv(f), 'text/csv; charset=utf-8');
      }

      // ----- รายงานย่อย: ยอดขาย / สินค้า (ผู้จัดการ) -----
      {
        const rm = /^\/api\/reports\/(sales|products|bills)(\.xlsx)?$/.exec(path);
        if (rm && req.method === 'GET') {
          requireFeature(me, 'reports', 'view');
          const sp = url.searchParams;
          const bq = sp.get('branch');
          if (bq === 'all') setBranch(0);
          else if (bq && me.branchIds.includes(Number(bq))) setBranch(Number(bq));
          const f = Object.fromEntries(sp.entries()) as Record<string, string>;
          if (!rm[2]) return json(req, res, 200, rm[1] === 'sales' ? salesReport(f) : rm[1] === 'bills' ? billReport(f) : productReport(f));
          const bName = currentBranchInfo().name;
          const scope = currentBranch() === 0 ? 'รวมทุกสาขา' : bName.startsWith('สาขา') ? bName : `สาขา ${bName}`;
          if (rm[1] === 'bills') {
            const r = billReport({ ...f, limit: 1 }).range;
            res.setHeader('Content-Disposition', `attachment; filename="bills-report-${r.from}-to-${r.to}.xlsx"`);
            return send(req, res, 200, billReportXlsx(f, scope, currentBranch() === 0), XLSX_TYPE);
          }
          const r = rm[1] === 'sales' ? salesReport(f).range : { from: f.from ?? '', to: f.to ?? '' };
          res.setHeader('Content-Disposition', `attachment; filename="${rm[1]}-report-${r.from}-to-${r.to}.xlsx"`);
          return send(req, res, 200, rm[1] === 'sales' ? salesReportXlsx(f, scope) : productReportXlsx(f, scope), XLSX_TYPE);
        }
      }

      // ----- ค่าใช้จ่าย & สมุดลิ้นชัก -----
      if ((path === '/api/expenses' || path === '/api/expenses.csv') && req.method === 'GET') {
        const sp = url.searchParams;
        const f: ExpenseQuery = {
          from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, category: sp.get('category') ?? undefined,
          source: sp.get('source') ?? undefined, q: sp.get('q') ?? undefined, voided: sp.get('voided') ?? undefined,
        };
        if (sp.get('branch') === 'all' && allBranchRole(me.role)) setBranch(0);
        if (path === '/api/expenses') return json(req, res, 200, listExpenses(f));
        res.setHeader('Content-Disposition', `attachment; filename="expenses-${f.from ?? ''}-${f.to ?? ''}.csv"`);
        return send(req, res, 200, expensesCsv(f), 'text/csv; charset=utf-8');
      }
      if (path === '/api/expenses' && req.method === 'POST') {
        const e = createExpense((await readBody(req)) as never, me.name);
        const cats = expenseCategories();
        const names = [...new Set((e.items ?? []).map((i) => cats.find((c) => c.id === i.category)?.name ?? i.category))];
        emit('expense.created', { ...e, categoryName: names.join(', ') || e.category, sourceName: EXPENSE_SOURCES[e.source] ?? e.source, staff: me.name });
        return json(req, res, 201, e);
      }
      if (path === '/api/expenses/categories' && req.method === 'PUT') {
        requireFeature(me, 'expenses', 'edit');
        return json(req, res, 200, saveExpenseCategories(await readBody(req)));
      }
      if (path === '/api/expenses/drawer' && req.method === 'GET') {
        const id = Number(url.searchParams.get('shift') ?? 0) || undefined;
        return json(req, res, 200, { ...drawerLedger(id), shifts: recentShifts() });
      }
      {
        const em = /^\/api\/expenses\/(\d+)(\/void)?$/.exec(path);
        if (em && !em[2] && req.method === 'PUT') { requireFeature(me, 'expenses', 'edit'); return json(req, res, 200, updateExpense(Number(em[1]), (await readBody(req)) as never, me.name)); }
        if (em && em[2] && req.method === 'POST') {
          requireFeature(me, 'expenses', 'view');
          const b = (await readBody(req)) as { reason?: string };
          return json(req, res, 200, voidExpense(Number(em[1]), String(b.reason ?? ''), me.name));
        }
      }

      // ----- พักบิล -----
      if (path === '/api/held' && req.method === 'GET') return json(req, res, 200, listHeld());
      if (path === '/api/held' && req.method === 'POST') return json(req, res, 201, holdBill((await readBody(req)) as Record<string, unknown>, me.name));
      {
        const hm = /^\/api\/held\/(\d+)(\/recall)?$/.exec(path);
        if (hm && hm[2] && req.method === 'POST') return json(req, res, 200, recallHeld(Number(hm[1])));
        if (hm && !hm[2] && req.method === 'DELETE') return json(req, res, 200, deleteHeld(Number(hm[1])));
      }
      if (path === '/api/reports/day' && req.method === 'GET') return json(req, res, 200, daySummary(url.searchParams.get('date') ?? undefined));

      // ----- กะการขาย -----
      if (path === '/api/shifts/current' && req.method === 'GET') return json(req, res, 200, currentShift());
      if (path === '/api/shifts/open' && req.method === 'POST') {
        const sh = openShift({ ...((await readBody(req)) as object), staff: me.name });
        emit('shift.opened', { shiftNo: sh.shiftNo, openingCash: sh.openingCash, openedBy: sh.openedBy, staff: me.name });
        return json(req, res, 201, sh);
      }
      if (path === '/api/shifts/current/cash' && req.method === 'POST') {
        const b = (await readBody(req)) as { kind?: string; amount?: number; reason?: string };
        const out = cashMove({ ...b, staff: me.name });
        emit('cash.moved', { kind: b.kind, amount: Number(b.amount), reason: b.reason ?? '', staff: me.name, shiftNo: out.shift?.shiftNo });
        return json(req, res, 201, out);
      }
      if (path === '/api/shifts/current/close' && req.method === 'POST') {
        const closed = closeShift({ ...((await readBody(req)) as object), staff: me.name }) as Record<string, unknown>;
        emit('shift.closed', closed);
        return json(req, res, 200, closed);
      }
      if (path === '/api/shifts' && req.method === 'GET') {
        const p = url.searchParams;
        return json(req, res, 200, listShifts({
          from: p.get('from') ?? undefined, to: p.get('to') ?? undefined,
          limit: Number(p.get('limit') ?? 50), offset: Number(p.get('offset') ?? 0),
        }));
      }
      const sm = path.match(/^\/api\/shifts\/(\d+)$/);
      if (sm && req.method === 'GET') return json(req, res, 200, shiftDetail(Number(sm[1])));

      // ----- ใบกำกับภาษีเต็มรูป / ใบลดหนี้ (taxDocs.ts) -----
      const td = path.match(/^\/api\/orders\/(\d+)\/(tax-invoice|credit-note)$/);
      if (td && req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>;
        if (td[2] === 'tax-invoice') return json(req, res, 201, issueTaxInvoice(Number(td[1]), body, me.name));
        // รับคืนสินค้า = คืนเงิน → ยืนยันด้วย PIN ผู้มีสิทธิ์ยกเลิกบิล (เหมือนยกเลิกบิล)
        const approver = approveVoid(body.pin as string | undefined, clientIp(req));
        const out = createCreditNote(Number(td[1]), body, { operator: me.name, approver: approver.name });
        emit('order.edited', { id: out.orderId, orderNo: out.orderNo, oldTotal: out.orderTotal, newTotal: out.orderTotal, diff: -out.total, reason: `ใบลดหนี้ ${out.docNo} · ${out.reason}`, staff: me.name });
        return json(req, res, 201, out);
      }
      const tv = path.match(/^\/api\/tax-invoices\/(\d+)(\/cancel)?$/);
      if (tv) {
        if (!tv[2] && req.method === 'GET') return json(req, res, 200, taxInvoiceDoc(Number(tv[1])));
        if (tv[2] && req.method === 'POST') {
          requireFeature(me, 'taxReport', 'edit');
          const body = (await readBody(req)) as { reason?: string };
          return json(req, res, 200, cancelTaxInvoice(Number(tv[1]), body.reason, me.name));
        }
      }
      const cn = path.match(/^\/api\/credit-notes\/(\d+)$/);
      if (cn && req.method === 'GET') return json(req, res, 200, creditNoteDoc(Number(cn[1])));

      const m = path.match(/^\/api\/orders\/(\d+)(\/void)?$/);
      if (m) {
        const id = Number(m[1]);
        if (!m[2] && req.method === 'GET') return json(req, res, 200, orderDetail(id));
        if (!m[2] && req.method === 'PUT') {
          const b = (await readBody(req)) as Record<string, unknown>;
          const out = editOrder(id, { ...b, staff: me.name });
          if (!b.dryRun && 'order' in out && out.order) {
            const o = out.order as { orderNo: string; total: number };
            emit('order.edited', { id, orderNo: o.orderNo, oldTotal: o.total - out.diff, newTotal: o.total, diff: out.diff, reason: b.reason ?? '', staff: me.name });
          }
          return json(req, res, 200, out);
        }
        if (m[2] && req.method === 'POST') {
          // ยกเลิกบิลต้องยืนยันด้วย PIN — บันทึกชื่อเจ้าของ PIN เป็นผู้อนุมัติ
          const body = (await readBody(req)) as { pin?: string; reason?: string; refundMethod?: string };
          const approver = approveVoid(body.pin, clientIp(req));
          const by = approver.id === me.id ? approver.name : `${approver.name} (อนุมัติ) · ทำรายการโดย ${me.name}`;
          const out = voidOrder(id, { reason: body.reason, refundMethod: body.refundMethod, staff: by, operator: me.name, approver: approver.name }) as Record<string, any>;
          emit('order.voided', { id, orderNo: out.order?.orderNo ?? out.orderNo, total: out.order?.total ?? out.total, reason: body.reason ?? '', staff: by });
          return json(req, res, 200, out);
        }
      }
      throw new HttpError(404, 'Not found');
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/uploads/')) {
      const f = readUpload(path);
      if (!f) throw new HttpError(404, 'Not found');
      return send(req, res, 200, f.buf, f.type, f.fallback ? 'no-cache' : 'public, max-age=31536000, immutable');
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, path);
    throw new HttpError(405, 'Method not allowed');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    json(req, res, status, {
      error: err instanceof Error ? err.message : 'Server error',
      code: err instanceof HttpError ? err.code : undefined,
    });
  } finally {
    if (path.startsWith('/api/'))
      console.log(`${req.method} ${path} ${res.statusCode} ${(performance.now() - started).toFixed(1)}ms`);
  }
});

// POS_HOST=127.0.0.1 (บน VPS) = รับเฉพาะคำขอที่ผ่านประตูของเซิร์ฟเวอร์ license · ไม่ตั้ง = ทุกเครือข่าย (ใช้ในร้าน/LAN)
server.listen(PORT, process.env.POS_HOST || undefined, () => {
  console.log(`\n  Clothing POS — พัฒนาต้นแบบโดย n4444n (MIT + Attribution)`);
  console.log(`\n  POS server ready → http://localhost:${PORT}`);
  console.log(`  Database        → ${DB_PATH}`);
  console.log(`  Web build       → ${WEB_DIR}${existsSync(WEB_DIR) ? '' : '  (not built yet)'}\n`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
