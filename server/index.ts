// POS API + static web server — ไม่มี dependency ภายนอก (node:http + node:sqlite)
// รัน: node --experimental-strip-types server/index.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
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
  approveVoid, authenticate, clientIp, createStaff, listStaff, login, logout, PIN_LENGTH, requireManager, switchBranch, tokenOf, updateStaff,
  type Me,
} from './auth.ts';
import { discountFor, HttpError, ORDER_TYPES, PAYMENT_METHODS, round2, getVatRate, vatOf, type Promo } from './common.ts';
import { editOrder, history, historyCsv, orderDetail, voidOrder, type HistoryQuery } from './history.ts';
import {
  cashMove, closeShift, currentShift, listShifts, openShift, recordPayment, requireShift, shiftBrief, shiftDetail,
} from './shifts.ts';
import { dashboard, dashboardCsv } from './dashboard.ts';
import { importProducts } from './productImport.ts';
import { reportXlsx } from './reportExport.ts';
import { shipmentXlsx } from './shipmentExport.ts';
import { productReport, productReportXlsx, salesReport, salesReportXlsx } from './reports.ts';
import { stockXlsx } from './stockExport.ts';
import { XLSX_TYPE } from './xlsx.ts';
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
            p.low_stock AS lowStock, p.attrs
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
    `SELECT id, name, role FROM staff s WHERE active = 1 AND (role = 'manager'
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
                         promo_code, payment_method, cash_received, change_due, shift_id, fee, fee_payer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  insItem: db.prepare(
    `INSERT INTO order_items (order_id, variant_id, product_name, sku, size, color, extra, qty, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  recentOrders: db.prepare(
    `SELECT id, order_no AS orderNo, customer_name AS customerName, salesperson, order_type AS orderType,
            subtotal, discount, vat, total, promo_code AS promoCode, payment_method AS paymentMethod,
            cash_received AS cashReceived, change_due AS changeDue, status, created_at AS createdAt
       FROM orders ORDER BY id DESC LIMIT ?`,
  ),
  itemsOf: db.prepare(
    `SELECT product_name AS name, sku, size, color, extra, qty, unit_price AS unitPrice, line_total AS lineTotal
       FROM order_items WHERE order_id = ?`,
  ),
};


/** เลขที่บิล: สาขาหลัก INV-251011-0001 · สาขาอื่นมีรหัสสาขา INV-B02-251011-0001 (ไม่ซ้ำกันข้ามสาขา) */
function todayPrefix() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  const b = currentBranchInfo();
  const code = b.isMain ? '' : `${b.code.replace(/[^A-Za-z0-9]/g, '') || b.id}-`;
  return `INV-${code}${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-`;
}
function nextOrderNo() {
  const prefix = todayPrefix();
  const { n } = q.countToday.get(prefix + '%') as { n: number };
  return prefix + String(n + 1).padStart(4, '0');
}


/** เพิ่ม/แก้/ลบสินค้า หมวดหมู่ = ทำที่สาขาหลัก (ทุกสาขาใช้รายการสินค้าเดียวกัน) */
function requireMain() {
  if (currentBranch() !== mainBranchId())
    throw new HttpError(403, 'เพิ่ม/แก้ไขสินค้าทำได้ที่สาขาหลัก — สาขานี้ปรับได้เฉพาะสต็อกและราคาขาย (หน้า สต็อกสินค้า (คุณสมบัติ))', 'MAIN_ONLY');
}

// ---------- handlers ----------
function bootstrap() {
  return {
    categories: q.categories.all(),
    products: (q.products.all() as { attrs: string | null }[]).map((p) => ({ ...p, attrs: p.attrs ? JSON.parse(p.attrs) : [] })),
    variants: q.variants.all(),
    staff: q.staff.all(),
    orderTypes: ORDER_TYPES,
    vatRate: getVatRate(),
    nextOrderNo: nextOrderNo(),
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

function createOrder(body: OrderBody) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new HttpError(400, 'ยังไม่มีสินค้าในรายการ');
  if (items.length > 200) throw new HttpError(400, 'รายการสินค้ามากเกินไป');
  const orderType = ORDER_TYPES.includes(body.orderType ?? '') ? body.orderType! : ORDER_TYPES[0];
  const payment = body.paymentMethod ?? '';
  if (!PAYMENT_METHODS.includes(payment)) throw new HttpError(400, 'กรุณาเลือกวิธีชำระเงิน');
  if (!methodEnabled(payment)) throw new HttpError(400, 'วิธีชำระเงินนี้ถูกปิดใช้งาน (ตั้งค่า → วิธีชำระเงิน)');

  const shift = requireShift(); // ต้องเปิดกะก่อนขาย

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
      return { ...v, qty: qn, lineTotal: round2(v.price * qn) };
    });

    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    let discount = 0;
    let promoCode: string | null = null;
    if (body.promoCode) {
      const p = checkPromo(body.promoCode, subtotal);
      discount = p.discount;
      promoCode = p.code;
    }
    // ค่าธรรมเนียม (เช่น บัตรเครดิต) คิดจากยอดสินค้าหลังส่วนลด — ลูกค้าจ่ายเพิ่ม หรือร้านจ่ายเอง ตามตั้งค่า
    const goods = round2(subtotal - discount);
    const fee = feeFor(payment, goods);
    const payer = feePayer();
    const total = round2(goods + (payer === 'customer' ? fee : 0));
    const vat = vatOf(total);

    let cashReceived: number | null = null;
    let change: number | null = null;
    if (payment === 'cash') {
      cashReceived = round2(Number(body.cashReceived ?? total));
      if (!(cashReceived >= total)) throw new HttpError(422, 'รับเงินสดไม่พอ');
      change = round2(cashReceived - total);
    }

    const orderNo = nextOrderNo();
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
    );
    const orderId = Number(res.lastInsertRowid);
    recordPayment(shift.id, orderId, 'sale', payment, total);
    for (const l of lines) {
      const dec = allowNegativeStock() ? () => q.decStockAny.run(l.qty, l.id) : () => q.decStock.run(l.qty, l.id, l.qty);
      if (countChanges(dec) !== 1) throw new HttpError(409, `${l.name} สต็อกไม่พอ`);
      q.insItem.run(orderId, l.id, l.name, l.sku, l.size, l.color, l.extra, l.qty, l.price, l.lineTotal);
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
        items: lines.map((l) => ({ name: l.name, sku: l.sku, size: l.size, color: l.color, extra: l.extra, qty: l.qty, unitPrice: l.price, lineTotal: l.lineTotal })),
      },
      stock: lines.map((l) => q.stockOf.get(l.id)),
      nextOrderNo: nextOrderNo(),
    };
  });
}

function recentOrders(limit: number) {
  const rows = q.recentOrders.all(Math.min(Math.max(limit, 1), 100)) as { id: number }[];
  return rows.map((o) => ({ ...o, items: q.itemsOf.all(o.id) }));
}

// ---------- http helpers ----------
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Branch',
      });
      return res.end();
    }
    if (path.startsWith('/api/')) {
      if (req.method === 'GET' && path === '/api/health') return json(req, res, 200, { ok: true, db: DB_PATH });

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
      if (path === '/api/staff' && req.method === 'GET') { requireManager(me); return json(req, res, 200, listStaff()); }
      if (path === '/api/staff' && req.method === 'POST') { requireManager(me); return json(req, res, 201, createStaff((await readBody(req)) as never, me)); }
      const st = path.match(/^\/api\/staff\/(\d+)$/);
      if (st && req.method === 'PUT') { requireManager(me); return json(req, res, 200, updateStaff(Number(st[1]), (await readBody(req)) as never, me)); }
      if (req.method === 'GET' && path === '/api/bootstrap') return json(req, res, 200, bootstrap());
      if (req.method === 'GET' && path.startsWith('/api/promos/')) {
        const code = decodeURIComponent(path.slice('/api/promos/'.length));
        return json(req, res, 200, checkPromo(code, Number(url.searchParams.get('subtotal') ?? 0)));
      }
      if (req.method === 'GET' && path === '/api/orders')
        return json(req, res, 200, recentOrders(Number(url.searchParams.get('limit') ?? 20)));
      if (req.method === 'POST' && path === '/api/orders') {
        const body = (await readBody(req)) as OrderBody;
        body.salesperson = body.salesperson || me.name; // ค่าเริ่มต้น = ผู้ที่ล็อกอิน
        return json(req, res, 201, createOrder(body));
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
      if (path === '/api/products' && req.method === 'POST') { requireManager(me); requireMain(); return json(req, res, 201, saveProduct(null, (await readBody(req)) as never, me)); }
      if (path === '/api/products/import' && req.method === 'POST') { requireManager(me); requireMain(); return json(req, res, 200, importProducts((await readBody(req, 8_000_000)) as never, me)); }
      if (path === '/api/stock/alerts' && req.method === 'GET') return json(req, res, 200, stockSummary());
      // ส่งออกสต็อก (Excel) — ชีตแรกนำเข้ากลับได้ที่ "นำเข้าสินค้า" · ?branch=all (ผู้จัดการ) = เพิ่มชีตสต็อกทุกสาขา
      if (path === '/api/stock/export.xlsx' && req.method === 'GET') {
        const d = new Date();
        const p2 = (n: number) => String(n).padStart(2, '0');
        res.setHeader('Content-Disposition', `attachment; filename="stock-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.xlsx"`);
        return send(req, res, 200, stockXlsx(me), XLSX_TYPE);
      }
      // ----- ตั้งค่า (ผู้จัดการ) -----
      if (path === '/api/settings' && req.method === 'GET') { requireManager(me); return json(req, res, 200, { settings: forAdmin(), keys: listKeys() }); }
      {
        const sm2 = /^\/api\/settings\/([a-z]+)$/.exec(path);
        if (sm2 && req.method === 'PUT') {
          requireManager(me);
          let body = (await readBody(req)) as Record<string, unknown>;
          if (sm2[1] === 'stock') body = { ...body, sync: getSettings().stock.sync };
          return json(req, res, 200, { settings: saveSection(sm2[1], body) });
        }
      }
      if (path === '/api/settings/notify/test' && req.method === 'POST') {
        requireManager(me);
        const b = (await readBody(req)) as { channel?: string; event?: string };
        return json(req, res, 200, await testNotify(String(b.channel ?? ''), b.event ? String(b.event) : undefined));
      }
      if (path === '/api/settings/notify/catalog' && req.method === 'GET') { requireManager(me); return json(req, res, 200, notifyCatalog()); }
      if (path === '/api/settings/keys' && req.method === 'POST') { requireManager(me); return json(req, res, 201, createKey((await readBody(req)) as never, me)); }
      {
        const km = /^\/api\/settings\/keys\/(\d+)$/.exec(path);
        if (km && req.method === 'DELETE') { requireManager(me); return json(req, res, 200, revokeKey(Number(km[1]))); }
      }
      // ----- จัดการสาขา (ผู้จัดการ) -----
      if (path === '/api/branches/manage' && req.method === 'GET') {
        requireManager(me);
        return json(req, res, 200, { currentId: me.branchId, mainId: mainBranchId(), nextCode: nextCode(), list: listBranches() });
      }
      if (path === '/api/branches' && req.method === 'POST') { requireManager(me); return json(req, res, 201, createBranch((await readBody(req)) as never)); }
      if (path === '/api/branches/delete' && req.method === 'POST') { requireManager(me); return json(req, res, 200, deleteBranches(((await readBody(req)) as { ids?: unknown }).ids)); }
      if (path === '/api/branches/reset-prices' && req.method === 'POST') { requireManager(me); return json(req, res, 200, resetBranchPrices(((await readBody(req)) as { variantIds?: unknown }).variantIds)); }
      {
        const bm = /^\/api\/branches\/(\d+)$/.exec(path);
        if (bm && req.method === 'PUT') { requireManager(me); return json(req, res, 200, updateBranch(Number(bm[1]), (await readBody(req)) as never)); }
        if (bm && req.method === 'GET') { requireManager(me); return json(req, res, 200, getBranch(Number(bm[1]))); }
      }
      if (path === '/api/products/bulk' && req.method === 'POST') {
        requireManager(me);
        const body = (await readBody(req)) as { action?: string };
        if (body.action !== 'zero') requireMain(); // ล้างสต็อก = เฉพาะสาขานี้ · อย่างอื่นเปลี่ยนสินค้าทุกสาขา
        return json(req, res, 200, bulkProducts(body as never, me));
      }
      // ---- ส่งของจากโรงงาน (ใบส่งของ DO) — ผู้จัดการเท่านั้น (ย้ายสต็อกข้ามสาขา) ----
      if (path === '/api/shipments' && req.method === 'GET') { requireManager(me); return json(req, res, 200, listShipments()); }
      if (path === '/api/shipments' && req.method === 'POST') { requireManager(me); return json(req, res, 201, createShipment((await readBody(req)) as never, me)); }
      {
        // ใบส่งของเป็น Excel (หน้าตาเดียวกับใบพิมพ์ A4)
        const se = /^\/api\/shipments\/(\d+)\/export\.xlsx$/.exec(path);
        if (se && req.method === 'GET') {
          requireManager(me);
          const { file, docNo } = shipmentXlsx(Number(se[1]));
          res.setHeader('Content-Disposition', `attachment; filename="${docNo.replace(/[^\w.-]/g, '_')}.xlsx"`);
          return send(req, res, 200, file, XLSX_TYPE);
        }
      }
      {
        const sh = /^\/api\/shipments\/(\d+)(?:\/(scan|ship|cancel|restore|hold|resume|items\/(\d+)))?$/.exec(path);
        if (sh) {
          requireManager(me);
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
      if (path === '/api/categories' && req.method === 'POST') { requireManager(me); requireMain(); return json(req, res, 201, createCategory((await readBody(req)) as never)); }
      if (path === '/api/uploads' && req.method === 'POST') { requireManager(me); return json(req, res, 201, saveUpload((await readBody(req, 6_000_000)) as never)); }
      if (path === '/api/uploads/variants' && req.method === 'GET') { requireManager(me); return json(req, res, 200, { urls: uploadsMissingVariants() }); }
      if (path === '/api/uploads/variants' && req.method === 'POST') { requireManager(me); return json(req, res, 200, saveUploadVariants((await readBody(req, 3_000_000)) as never)); }
      {
        const bm = /^\/api\/products\/(\d+)\/skus$/.exec(path);
        if (bm && req.method === 'PUT') { requireManager(me); return json(req, res, 200, bulkUpdateSkus(Number(bm[1]), (await readBody(req)) as never, me)); }
      }
      const pm = path.match(/^\/api\/products\/(\d+)(\/active)?$/);
      if (pm) {
        const pid = Number(pm[1]);
        if (!pm[2] && req.method === 'GET') return json(req, res, 200, getProduct(pid, me));
        if (!pm[2] && req.method === 'PUT') {
          requireManager(me);
          const body = (await readBody(req)) as never;
          // สาขาย่อย: บันทึกได้เฉพาะจำนวน/ราคาขายของสาขา · สาขาหลัก: แก้สินค้าได้ทั้งหมด
          return json(req, res, 200, currentBranch() === mainBranchId() ? saveProduct(pid, body, me) : saveBranchStock(pid, body, me));
        }
        if (pm[2] && req.method === 'PUT') { requireManager(me); requireMain(); return json(req, res, 200, setProductActive(pid, !!((await readBody(req)) as { active?: boolean }).active)); }
      }

      // ----- รายงาน / Dashboard (ผู้จัดการ) -----
      if ((path === '/api/dashboard' || path === '/api/dashboard.csv' || path === '/api/dashboard.xlsx') && req.method === 'GET') {
        requireManager(me);
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
        const rm = /^\/api\/reports\/(sales|products)(\.xlsx)?$/.exec(path);
        if (rm && req.method === 'GET') {
          requireManager(me);
          const sp = url.searchParams;
          const bq = sp.get('branch');
          if (bq === 'all') setBranch(0);
          else if (bq && me.branchIds.includes(Number(bq))) setBranch(Number(bq));
          const f = Object.fromEntries(sp.entries()) as Record<string, string>;
          if (!rm[2]) return json(req, res, 200, rm[1] === 'sales' ? salesReport(f) : productReport(f));
          const bName = currentBranchInfo().name;
          const scope = currentBranch() === 0 ? 'รวมทุกสาขา' : bName.startsWith('สาขา') ? bName : `สาขา ${bName}`;
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
        if (sp.get('branch') === 'all' && me.role === 'manager') setBranch(0);
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
        requireManager(me);
        return json(req, res, 200, saveExpenseCategories(await readBody(req)));
      }
      if (path === '/api/expenses/drawer' && req.method === 'GET') {
        const id = Number(url.searchParams.get('shift') ?? 0) || undefined;
        return json(req, res, 200, { ...drawerLedger(id), shifts: recentShifts() });
      }
      {
        const em = /^\/api\/expenses\/(\d+)(\/void)?$/.exec(path);
        if (em && !em[2] && req.method === 'PUT') { requireManager(me); return json(req, res, 200, updateExpense(Number(em[1]), (await readBody(req)) as never, me.name)); }
        if (em && em[2] && req.method === 'POST') {
          requireManager(me);
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
          const out = voidOrder(id, { reason: body.reason, refundMethod: body.refundMethod, staff: by }) as Record<string, any>;
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

server.listen(PORT, () => {
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
