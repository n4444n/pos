// ออกบิล · คิดยอด · ข้อมูลตั้งต้นของหน้าขาย — หัวใจของ module ขาย
import { countChanges, currentBranch, db, tx, withBranch } from '../../core/db.ts';
import { allowNegativeStock, feeFor, feePayer, getSettings, methodEnabled, publicSettings } from '../../core/settings.ts';
import { discountFor, HttpError, ORDER_TYPES, PAYMENT_METHODS, round2, getVatRate, type Promo } from '../../core/common.ts';
import { nextBillNo } from '../../core/billNo.ts';
import { getTerminal, isExempt, saleTax, terminalFor, type Terminal } from '../tax/tax.ts';
import { bestAutoDiscount, giftsFor } from '../promo/promos.ts';
import { recordPayment, requireShift, shiftBrief } from '../shift/shifts.ts';
import { stockSummary, variantLabel } from '../stock/products.ts';
import { emit } from '../notify/events.ts';

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


/** เลขที่บิล — รูปแบบตั้งแยกต่อสาขาที่ ตั้งค่า → เลขที่บิล (billNo.ts) */
export function nextOrderNo(t: Terminal | null = null) {
  return nextBillNo(t);
}


// ---------- handlers ----------
export function bootstrap(terminalHeader?: unknown) {
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

export function checkPromo(code: string, subtotal: number) {
  const promo = q.promo.get(code.trim().toUpperCase()) as Promo | undefined;
  if (!promo) throw new HttpError(404, 'ไม่พบโค้ดส่วนลดนี้');
  if (subtotal < promo.minTotal)
    throw new HttpError(422, `ต้องซื้อขั้นต่ำ ฿${promo.minTotal.toLocaleString()} เพื่อใช้โค้ดนี้`);
  return { ...promo, discount: discountFor(promo, subtotal) };
}

export interface OrderBody {
  customerName?: string;
  salesperson?: string;
  orderType?: string;
  promoCode?: string;
  paymentMethod?: string;
  cashReceived?: number;
  items?: { variantId: number; qty: number }[];
}

/**
 * ยอดที่ต้องเรียกเก็บของตะกร้านี้ — ใช้ก่อนส่งยอดไปเครื่องรับบัตร (ตอนนั้นยังไม่ออกบิล)
 * คิดด้วยฟังก์ชันชุดเดียวกับ createOrder (ราคาจากฐานข้อมูล · โปรโมชั่น · ค่าธรรมเนียม) เพื่อไม่ให้ยอดเพี้ยนกัน
 * ของแถมราคา 0 จึงไม่กระทบยอด · VAT รวมในราคาอยู่แล้ว ยอดนี้คือยอดที่ลูกค้าจ่ายจริง
 */
export function quoteTotal(body: OrderBody, payment: string) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new HttpError(400, 'ยังไม่มีสินค้าในรายการ');
  if (items.length > 200) throw new HttpError(400, 'รายการสินค้ามากเกินไป');
  let subtotal = 0;
  for (const { variantId, qty } of items) {
    const qn = Math.floor(Number(qty));
    if (!Number.isFinite(qn) || qn <= 0 || qn > 999) throw new HttpError(400, 'จำนวนสินค้าไม่ถูกต้อง');
    const v = q.variantForSale.get(Number(variantId)) as { id: number; name: string; price: number; stock: number } | undefined;
    if (!v) throw new HttpError(404, `ไม่พบสินค้า #${variantId}`);
    if (v.stock < qn && !allowNegativeStock()) throw new HttpError(409, `${v.name} คงเหลือ ${v.stock} ชิ้น`);
    subtotal = round2(subtotal + round2(v.price * qn));
  }
  const discount = body.promoCode ? checkPromo(body.promoCode, subtotal).discount : bestAutoDiscount(subtotal)?.discount ?? 0;
  const goods = round2(subtotal - discount);
  const fee = feeFor(payment, goods);
  return { subtotal, discount, fee, total: round2(goods + (feePayer() === 'customer' ? fee : 0)) };
}

/** afterBeam = เรียกจากขั้นตอนออกบิลหลังเครื่องรับบัตรแจ้งว่าได้เงินแล้วเท่านั้น */
export function createOrder(body: OrderBody, terminalHeader?: unknown, afterBeam = false) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new HttpError(400, 'ยังไม่มีสินค้าในรายการ');
  if (items.length > 200) throw new HttpError(400, 'รายการสินค้ามากเกินไป');
  const orderType = ORDER_TYPES.includes(body.orderType ?? '') ? body.orderType! : ORDER_TYPES[0];
  const payment = body.paymentMethod ?? '';
  if (!PAYMENT_METHODS.includes(payment)) throw new HttpError(400, 'กรุณาเลือกวิธีชำระเงิน');
  // กันออกบิลโดยยังไม่ได้รับเงิน: บิลที่ชำระด้วยเครื่องรับบัตรต้องมาจาก /api/beam/charge/{id}/bill เท่านั้น
  if (payment === 'beam' && !afterBeam) {
    throw new HttpError(409, 'บิลที่ชำระด้วยเครื่องรับบัตรต้องผ่านขั้นตอนรับเงินที่เครื่องก่อน', 'BEAM_REQUIRED');
  }
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
      if (payment === 'promptpay') {
        const pp = getSettings().payments;
        const id = pp.promptpayId;
        emit('payment.promptpay', {
          id: orderId, orderNo, amount: total, locked: pp.promptpayLock !== false, account: pp.promptpayName || publicSettings().shop.name,
          promptpayMasked: id.length === 10 ? `${id.slice(0, 3)}-xxx-${id.slice(6)}` : id ? `${id.slice(0, 3)}…${id.slice(-4)}` : '',
          salesperson: body.salesperson ?? null,
        });
      }
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

export function recentOrders(limit: number) {
  const rows = q.recentOrders.all(Math.min(Math.max(limit, 1), 100)) as { id: number; terminalId: number | null }[];
  return rows.map((o) => {
    const t = o.terminalId ? getTerminal(o.terminalId) : null;
    return {
      ...o, terminal: t ? { code: t.code, rdNo: t.rdNo } : null,
      items: (q.itemsOf.all(o.id) as { vatExempt: number }[]).map((i) => ({ ...i, vatExempt: !!i.vatExempt })),
    };
  });
}
