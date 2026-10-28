// สต็อกสินค้า: เพิ่ม/แก้ไขสินค้า, คุณสมบัติ (สี/ไซซ์/ดีไซน์), SKU, ต้นทุน/ราคา/จำนวน, แสดงขาย, แจ้งเตือนเหลือน้อย
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { db, DB_PATH, tx } from './db.ts';
import { HttpError, round2 } from './common.ts';
import { allowNegativeStock } from './settings.ts';

/** ยอดสต็อกต่ำสุดที่กรอกได้ (เปิด "ขายได้แม้สต็อกหมด" → ติดลบได้) */
const minStock = () => (allowNegativeStock() ? -999999 : 0);
/** ปรับยอดตามส่วนต่าง: ไม่แตะยอดถ้าไม่ได้แก้ (ยอดติดลบเดิมไม่ถูกปัดเป็น 0) */
const applyDelta = (cur: number, delta: number) => (delta === 0 ? cur : Math.max(minStock(), cur + delta));
import type { Me } from './auth.ts';
import { can, requirePerm as requireFeature } from './perms.ts';
import { getSettings } from './settings.ts';

export const UPLOAD_DIR = join(dirname(DB_PATH), 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const ARTS = ['tshirt', 'polo', 'longsleeve', 'tank', 'shirt', 'blouse', 'pants', 'shorts', 'dress', 'slipdress', 'skirt', 'hoodie', 'jacket', 'sweater', 'bag', 'cap', 'socks', 'belt', 'scarf'];
export const MAX_SKU = 200;

type AttrType = 'color' | 'size' | 'custom';
interface Attr { type: AttrType; name: string; options: { value: string; hex?: string }[] }

interface ProductRow {
  id: number; sku: string; barcode: string | null; name: string; categoryId: string; price: number; cost: number | null;
  art: string; tint: string; imageUrl: string | null; active: number; note: string | null; lowStock: number;
  attrs: string | null; createdAt: string; updatedAt: string | null; vatExempt: number;
}
interface VariantRow {
  id: number; productId: number; sku: string; barcode: string | null; size: string; color: string; colorHex: string; extra: string;
  stock: number; price: number | null; cost: number | null; active: number; sort: number;
}

const P_COLS = `p.id, p.sku, p.barcode, p.name, p.category_id AS categoryId, p.price, p.cost, p.art, p.tint,
  p.image_url AS imageUrl, p.active, p.note, p.low_stock AS lowStock, p.attrs, p.created_at AS createdAt, p.updated_at AS updatedAt,
  p.vat_exempt AS vatExempt`;
const V_COLS = `v.id, v.product_id AS productId, v.sku, v.barcode, v.size, v.color, v.color_hex AS colorHex, v.extra, v.stock,
  v.price, v.cost, v.active, v.sort`;

const q = {
  product: db.prepare(`SELECT ${P_COLS} FROM products p WHERE p.id = ?`),
  variants: db.prepare(`SELECT ${V_COLS} FROM variants v WHERE v.product_id = ? AND instr(v.extra, char(1)) = 0 ORDER BY v.sort, v.id`),
  allVariants: db.prepare(`SELECT ${V_COLS} FROM variants v WHERE v.product_id = ? ORDER BY v.sort, v.id`),
  skuTaken: db.prepare('SELECT product_id AS productId FROM variants WHERE sku = ?'),
  barcodeTaken: db.prepare("SELECT id FROM products WHERE barcode = ? AND id != ?"),
  codeTaken: db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?'),
  vBarcodeTaken: db.prepare('SELECT v.id, v.product_id AS productId, p.name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.barcode = ?'),
  categories: db.prepare('SELECT id, name, icon, sort FROM categories ORDER BY sort'),
  hasSales: db.prepare('SELECT 1 FROM order_items WHERE variant_id = ? LIMIT 1'),
  insMove: db.prepare('INSERT INTO stock_moves_all (variant_id, delta, balance, reason, staff) VALUES (?, ?, ?, ?, ?)'),
};

/** ชื่อ SKU สำหรับแสดงผล: "ดำ / M / ลายทาง" (ข้ามค่าที่ว่าง) */
export function variantLabel(v: { color: string; size: string; extra?: string }) {
  return [v.color, v.size, v.extra].filter((x) => x && x !== '-').join(' / ') || 'ปกติ';
}

function present(p: ProductRow, me: Me, variants: VariantRow[]) {
  const manager = can(me, 'stock', 'edit'); // เห็นต้นทุน = คนที่แก้สต็อกได้
  return {
    ...p,
    active: !!p.active,
    vatExempt: !!p.vatExempt,
    cost: manager ? p.cost : undefined,
    attrs: (p.attrs ? JSON.parse(p.attrs) : []) as Attr[],
    variants: variants.map((v) => ({
      ...v,
      active: !!v.active,
      label: variantLabel(v),
      price: v.price ?? p.price,
      cost: manager ? v.cost ?? p.cost ?? 0 : undefined,
    })),
  };
}

// ---------------- รายการสินค้า ----------------
export function listProducts(f: { q?: string; category?: string; status?: string }, me: Me) {
  const conds: string[] = ['p.deleted_at IS NULL'];
  const args: string[] = [];
  if (f.category) { conds.push('p.category_id = ?'); args.push(f.category); }
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    conds.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (SELECT 1 FROM variants x WHERE x.product_id = p.id AND (x.sku LIKE ? OR x.barcode LIKE ?)))');
    args.push(like, like, like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT ${P_COLS}, c.name AS category,
              COUNT(v.id) AS skuCount,
              SUM(CASE WHEN v.active = 1 THEN 1 ELSE 0 END) AS skuActive,
              COALESCE(SUM(v.stock), 0) AS stock,
              SUM(CASE WHEN v.active = 1 AND v.stock = 0 THEN 1 ELSE 0 END) AS outCount,
              SUM(CASE WHEN v.active = 1 AND v.stock > 0 AND v.stock <= p.low_stock THEN 1 ELSE 0 END) AS lowCount,
              MIN(COALESCE(v.price, p.price)) AS minPrice, MAX(COALESCE(v.price, p.price)) AS maxPrice,
              COALESCE(SUM(v.stock * COALESCE(v.cost, p.cost, 0)), 0) AS stockValue
         FROM products p
         LEFT JOIN variants v ON v.product_id = p.id AND instr(v.extra, char(1)) = 0
         LEFT JOIN categories c ON c.id = p.category_id
         ${where}
        GROUP BY p.id ORDER BY p.active DESC, p.updated_at DESC, p.id DESC`,
    )
    .all(...args) as (ProductRow & { category: string; skuCount: number; skuActive: number; stock: number; outCount: number; lowCount: number; minPrice: number; maxPrice: number; stockValue: number })[];

  let list = rows.map((r) => ({
    id: r.id, sku: r.sku, barcode: r.barcode, name: r.name, categoryId: r.categoryId, category: r.category, art: r.art,
    tint: r.tint, imageUrl: r.imageUrl, active: !!r.active, lowStock: r.lowStock, skuCount: r.skuCount, skuActive: r.skuActive ?? 0,
    stock: r.stock, outCount: r.outCount ?? 0, lowCount: r.lowCount ?? 0, minPrice: r.minPrice ?? r.price, maxPrice: r.maxPrice ?? r.price,
    stockValue: can(me, 'stock', 'edit') ? round2(r.stockValue) : undefined, updatedAt: r.updatedAt ?? r.createdAt,
  }));
  if (f.status === 'low') list = list.filter((p) => p.active && p.lowCount > 0);
  else if (f.status === 'out') list = list.filter((p) => p.active && p.outCount > 0);
  else if (f.status === 'inactive') list = list.filter((p) => !p.active);
  else if (f.status === 'active') list = list.filter((p) => p.active);

  return { rows: list, summary: stockSummary(me) };
}

export function stockSummary(me?: Me) {
  const s = db
    .prepare(
      `SELECT COUNT(DISTINCT p.id) AS products, COUNT(v.id) AS skus, COALESCE(SUM(v.stock), 0) AS units,
              COALESCE(SUM(v.stock * COALESCE(v.cost, p.cost, 0)), 0) AS value,
              SUM(CASE WHEN p.active = 1 AND v.active = 1 AND v.stock = 0 THEN 1 ELSE 0 END) AS out,
              SUM(CASE WHEN p.active = 1 AND v.active = 1 AND v.stock > 0 AND v.stock <= p.low_stock THEN 1 ELSE 0 END) AS low
         FROM products p LEFT JOIN variants v ON v.product_id = p.id AND instr(v.extra, char(1)) = 0
        WHERE p.deleted_at IS NULL`,
    )
    .get() as { products: number; skus: number; units: number; value: number; out: number | null; low: number | null };
  return {
    products: s.products, skus: s.skus, units: s.units, out: s.out ?? 0, low: s.low ?? 0,
    value: me && can(me, 'stock', 'edit') ? round2(s.value) : undefined,
  };
}

export function getProduct(id: number, me: Me) {
  const p = q.product.get(id) as ProductRow | undefined;
  if (!p) throw new HttpError(404, 'ไม่พบสินค้า');
  const moves = db
    .prepare(
      `SELECT m.id, m.delta, m.balance, m.reason, m.staff, m.created_at AS createdAt, v.size, v.color, v.extra
         FROM stock_moves m JOIN variants v ON v.id = m.variant_id WHERE v.product_id = ? ORDER BY m.id DESC LIMIT 30`,
    )
    .all(id);
  return { ...present(p, me, q.variants.all(id) as VariantRow[]), moves };
}

export function listCategories() {
  return q.categories.all();
}

export function createCategory(body: { name?: string; icon?: string }) {
  const name = body.name?.trim();
  if (!name) throw new HttpError(422, 'กรุณาระบุชื่อหมวดหมู่');
  if (db.prepare('SELECT 1 FROM categories WHERE name = ?').get(name)) throw new HttpError(409, 'มีหมวดหมู่นี้แล้ว');
  const id = 'c' + randomBytes(4).toString('hex');
  const { n } = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM categories').get() as { n: number };
  db.prepare('INSERT INTO categories (id, name, name_en, icon, sort) VALUES (?, ?, ?, ?, ?)').run(
    id, name.slice(0, 40), name.slice(0, 40), ARTS.includes(body.icon ?? '') ? body.icon! : 'tshirt', n + 1,
  );
  return { id, name, icon: body.icon ?? 'tshirt' };
}

// ---------------- บันทึกสินค้า ----------------
interface VariantIn {
  id?: number; sku?: string; barcode?: string | null; color?: string; colorHex?: string; size?: string; extra?: string;
  cost?: number; price?: number; stock?: number; stockBase?: number; active?: boolean;
}
export interface ProductIn {
  /** รหัสสินค้า (บ่งบอกว่าสินค้าชิ้นนี้คืออะไร) — ว่าง = สร้างอัตโนมัติ */
  code?: string;
  name?: string; categoryId?: string; barcode?: string; imageUrl?: string | null; art?: string; tint?: string;
  active?: boolean; lowStock?: number; note?: string; attrs?: Attr[]; variants?: VariantIn[];
  /** ยกเว้น VAT (ไม่ส่งมา = คงค่าเดิม · สินค้าใหม่ = เสีย VAT) */
  vatExempt?: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v: unknown, min = 0, max = 10_000_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

function cleanAttrs(attrs: unknown): Attr[] {
  if (!Array.isArray(attrs)) return [];
  const seen = new Set<string>();
  const out: Attr[] = [];
  for (const a of attrs.slice(0, 3) as Attr[]) {
    const type: AttrType = a.type === 'color' || a.type === 'size' ? a.type : 'custom';
    if (seen.has(type)) throw new HttpError(422, 'คุณสมบัติแต่ละประเภทใช้ได้ครั้งเดียว (สี / ไซซ์ / อื่นๆ)');
    seen.add(type);
    const name = String(a.name ?? '').trim().slice(0, 30) || (type === 'color' ? 'สี' : type === 'size' ? 'ไซซ์' : 'ดีไซน์');
    const opts = new Map<string, { value: string; hex?: string }>();
    for (const o of Array.isArray(a.options) ? a.options : []) {
      const value = String(o?.value ?? '').trim().slice(0, 30);
      if (!value || value === '-') continue;
      if (opts.has(value)) throw new HttpError(422, `ตัวเลือก "${value}" ซ้ำใน${name}`);
      opts.set(value, type === 'color' ? { value, hex: HEX.test(o.hex ?? '') ? o.hex : '#9AA0A8' } : { value });
    }
    if (opts.size === 0) throw new HttpError(422, `กรุณาเพิ่มตัวเลือกของ "${name}" อย่างน้อย 1 รายการ`);
    out.push({ type, name, options: [...opts.values()] });
  }
  return out;
}

const CODE_RE = /^[0-9A-Za-z\-_.]+$/;
const cleanCode = (v: unknown, max = 40) => String(v ?? '').trim().replace(/\s+/g, '').slice(0, max);

/** บาร์โค้ด (กำหนดเอง) ของ SKU ต้องไม่ซ้ำกับ: บาร์โค้ด SKU อื่น · บาร์โค้ดหลักของสินค้าอื่น · รหัส SKU ของสินค้าอื่น */
function assertVariantBarcodeFree(code: string, variantId: number | null, productId: number | null) {
  const v = q.vBarcodeTaken.get(code) as { id: number; productId: number; name: string } | undefined;
  if (v && v.id !== variantId) throw new HttpError(409, `บาร์โค้ด ${code} ถูกใช้กับ "${v.name}" แล้ว`);
  const p = db.prepare('SELECT id, name FROM products WHERE barcode = ?').get(code) as { id: number; name: string } | undefined;
  if (p) throw new HttpError(409, p.id === productId ? `บาร์โค้ด ${code} ซ้ำกับบาร์โค้ดหลักของสินค้านี้` : `บาร์โค้ด ${code} ซ้ำกับบาร์โค้ดหลักของ "${p.name}"`);
  const s = q.skuTaken.get(code) as { productId: number } | undefined;
  if (s && s.productId !== productId) throw new HttpError(409, `บาร์โค้ด ${code} ซ้ำกับรหัส SKU ของสินค้าอื่น`);
}

/** บาร์โค้ดอัตโนมัติสำหรับ SKU ใหม่: 'sku' = ใช้รหัส SKU · 'ean13' = สุ่ม EAN-13 (ขึ้นต้นด้วย prefix) */
function autoBarcode(sku: string, pid: number): string | null {
  const b = getSettings().barcode;
  const free = (code: string) => {
    try {
      assertVariantBarcodeFree(code, null, pid);
      return true;
    } catch {
      return false;
    }
  };
  if (b.autoAssign === 'sku') return free(sku) ? sku : null;
  if (b.autoAssign === 'ean13') {
    for (let t = 0; t < 20; t++) {
      const body = (b.ean13Prefix + Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('')).slice(0, 12);
      const sum = [...body].reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
      const code = body + ((10 - (sum % 10)) % 10);
      if (free(code)) return code;
    }
  }
  return null;
}

function nextSku(base: string, used: Set<string>, start: number) {
  for (let i = start; i < start + 100000; i++) {
    const { skuDigits, skuSeparator } = getSettings().stock; // ตั้งค่า → บาร์โค้ด & รหัส
    const sku = `${base}${skuSeparator}${String(i).padStart(skuDigits, '0')}`;
    if (!used.has(sku) && !q.skuTaken.get(sku)) {
      used.add(sku);
      return { sku, n: i + 1 };
    }
  }
  throw new HttpError(500, 'สร้างรหัส SKU ไม่ได้');
}

export function saveProduct(id: number | null, body: ProductIn, me: Me, opts: { moveReason?: string } = {}) {
  const name = body.name?.trim();
  if (!name) throw new HttpError(422, 'กรุณาระบุชื่อสินค้า');
  const categoryId = String(body.categoryId ?? '');
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw new HttpError(422, 'กรุณาเลือกหมวดหมู่');
  const barcode = String(body.barcode ?? '').trim().replace(/\s+/g, '').slice(0, 40) || null;
  if (barcode && !/^[0-9A-Za-z\-_.]+$/.test(barcode)) throw new HttpError(422, 'บาร์โค้ดใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .');
  if (barcode && q.barcodeTaken.get(barcode, id ?? 0)) throw new HttpError(409, `บาร์โค้ด ${barcode} ถูกใช้กับสินค้าอื่นแล้ว`);
  if (barcode) {
    const vb = q.vBarcodeTaken.get(barcode) as { name: string } | undefined;
    if (vb) throw new HttpError(409, `บาร์โค้ด ${barcode} ถูกใช้เป็นบาร์โค้ด SKU ของ "${vb.name}" แล้ว`);
    const v = q.skuTaken.get(barcode) as { productId: number } | undefined;
    if (v && v.productId !== id) throw new HttpError(409, `บาร์โค้ด ${barcode} ซ้ำกับรหัส SKU ของสินค้าอื่น`);
  }
  const code = cleanCode(body.code);
  if (code && !CODE_RE.test(code)) throw new HttpError(422, 'รหัสสินค้าใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .');
  if (code && q.codeTaken.get(code, id ?? 0)) throw new HttpError(409, `รหัสสินค้า ${code} ถูกใช้กับสินค้าอื่นแล้ว`);
  const lowStock = Math.floor(num(body.lowStock, 0, 9999) ?? 3);
  const art = ARTS.includes(body.art ?? '') ? body.art! : 'tshirt';
  const tint = HEX.test(body.tint ?? '') ? body.tint! : '#E8EEF9';
  const imageUrl = body.imageUrl && /^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(body.imageUrl) ? body.imageUrl : null;
  const note = body.note?.trim().slice(0, 2000) || null;
  const attrs = cleanAttrs(body.attrs);
  const manager = can(me, 'stock', 'edit'); // เห็นต้นทุน = คนที่แก้สต็อกได้
  requireFeature(me, 'stock', 'edit');

  // ---- ตรวจรายการ SKU ให้ตรงกับคุณสมบัติ ----
  const colorAttr = attrs.find((a) => a.type === 'color');
  const sizeAttr = attrs.find((a) => a.type === 'size');
  const extraAttr = attrs.find((a) => a.type === 'custom');
  const colorHex = new Map(colorAttr?.options.map((o) => [o.value, o.hex!]) ?? []);
  const input = Array.isArray(body.variants) ? body.variants : [];
  if (input.length === 0) throw new HttpError(422, 'ต้องมี SKU อย่างน้อย 1 รายการ');
  if (input.length > MAX_SKU) throw new HttpError(422, `SKU ได้สูงสุด ${MAX_SKU} รายการ`);

  const keys = new Set<string>();
  const vbSeen = new Set<string>();
  const lines = input.map((v, i) => {
    const color = colorAttr ? String(v.color ?? '') : '-';
    const size = sizeAttr ? String(v.size ?? '') : '-';
    const extra = extraAttr ? String(v.extra ?? '') : '';
    if (colorAttr && !colorHex.has(color)) throw new HttpError(422, `SKU แถวที่ ${i + 1}: ไม่พบสี "${color}"`);
    if (sizeAttr && !sizeAttr.options.some((o) => o.value === size)) throw new HttpError(422, `SKU แถวที่ ${i + 1}: ไม่พบไซซ์ "${size}"`);
    if (extraAttr && !extraAttr.options.some((o) => o.value === extra)) throw new HttpError(422, `SKU แถวที่ ${i + 1}: ไม่พบ${extraAttr.name} "${extra}"`);
    const key = `${color}|${size}|${extra}`;
    if (keys.has(key)) throw new HttpError(422, `SKU ซ้ำ: ${variantLabel({ color, size, extra })}`);
    keys.add(key);
    const price = num(v.price);
    if (price == null) throw new HttpError(422, `ราคาขายของ ${variantLabel({ color, size, extra })} ไม่ถูกต้อง`);
    const cost = num(v.cost ?? 0);
    if (cost == null) throw new HttpError(422, `ต้นทุนของ ${variantLabel({ color, size, extra })} ไม่ถูกต้อง`);
    // SKU เดิมที่สต็อกติดลบอยู่ ส่งยอดเดิมกลับมาได้เสมอ (ส่วนต่างคิดจาก stockBase)
    const stock = num(v.stock ?? 0, Math.min(minStock(), Number(v.stockBase ?? 0) || 0), 999999);
    if (stock == null || !Number.isInteger(stock)) throw new HttpError(422, `จำนวนของ ${variantLabel({ color, size, extra })} ต้องเป็นจำนวนเต็ม${minStock() < 0 ? '' : ' 0 ขึ้นไป'}`);
    const sku = String(v.sku ?? '').trim().slice(0, 40);
    if (sku && !/^[0-9A-Za-z\-_.]+$/.test(sku)) throw new HttpError(422, `รหัส SKU "${sku}" ใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .`);
    // undefined = ไม่ส่งมา → คงค่าเดิม
    const vb = v.barcode === undefined ? undefined : cleanCode(v.barcode) || null;
    if (vb && !CODE_RE.test(vb)) throw new HttpError(422, `บาร์โค้ด "${vb}" ใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .`);
    if (vb && vb === barcode) throw new HttpError(422, `บาร์โค้ดของ ${variantLabel({ color, size, extra })} ซ้ำกับบาร์โค้ดหลักของสินค้า`);
    if (vb && vbSeen.has(vb)) throw new HttpError(422, `บาร์โค้ด ${vb} ซ้ำกันในสินค้านี้`);
    if (vb) vbSeen.add(vb);
    return {
      id: v.id ? Number(v.id) : null, sku, barcode: vb, color, size, extra, colorHex: colorAttr ? colorHex.get(color)! : tint,
      price: round2(price), cost: round2(cost), stock, stockBase: v.stockBase != null ? Number(v.stockBase) : null,
      active: v.active !== false, sort: i,
    };
  });

  const minPrice = Math.min(...lines.map((l) => l.price));
  const minCost = Math.min(...lines.map((l) => l.cost));

  return tx(() => {
    let pid = id;
    const now = "datetime('now', 'localtime')";
    if (pid == null) {
      const tmpSku = 'P' + Date.now().toString(36).toUpperCase() + randomBytes(2).toString('hex').toUpperCase();
      pid = Number(
        db.prepare(
          `INSERT INTO products (sku, barcode, name, category_id, price, cost, art, tint, image_url, active, note, low_stock, attrs, vat_exempt, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${now})`,
        ).run(tmpSku, barcode, name.slice(0, 120), categoryId, minPrice, minCost, art, tint, imageUrl, body.active === false ? 0 : 1, note, lowStock, JSON.stringify(attrs), body.vatExempt === true ? 1 : 0).lastInsertRowid,
      );
      // รหัสสินค้า = ที่กำหนดเอง หรือ P000123
      db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(code || `P${String(pid).padStart(6, '0')}`, pid);
    } else {
      const cur = q.product.get(pid) as ProductRow | undefined;
      if (!cur) throw new HttpError(404, 'ไม่พบสินค้า');
      db.prepare(
        `UPDATE products SET sku = ?, barcode = ?, name = ?, category_id = ?, price = ?, cost = ?, art = ?, tint = ?, image_url = ?, active = ?,
                note = ?, low_stock = ?, attrs = ?, vat_exempt = ?, updated_at = ${now} WHERE id = ?`,
      ).run(code || cur.sku, barcode, name.slice(0, 120), categoryId, minPrice, minCost, art, tint, imageUrl, body.active === false ? 0 : 1, note, lowStock, JSON.stringify(attrs),
        typeof body.vatExempt === 'boolean' ? (body.vatExempt ? 1 : 0) : cur.vatExempt, pid);
    }

    const existing = q.variants.all(pid) as VariantRow[];
    const byId = new Map(existing.map((v) => [v.id, v]));
    const byKey = new Map(existing.map((v) => [`${v.color}|${v.size}|${v.extra}`, v]));
    const skuBase = (q.product.get(pid) as ProductRow).sku;
    // ล้างบาร์โค้ด SKU ของสินค้านี้ชั่วคราว (สลับบาร์โค้ดระหว่าง SKU ได้โดยไม่ชน UNIQUE)
    const oldBarcode = new Map(existing.map((v) => [v.id, v.barcode]));
    db.prepare('UPDATE variants SET barcode = NULL WHERE product_id = ?').run(pid);
    const usedSku = new Set<string>();
    let counter = existing.length + 1;
    const kept = new Set<number>();

    // ย้าย key ชั่วคราว เพื่อเลี่ยง UNIQUE ชนกันระหว่างสลับค่า
    db.prepare("UPDATE variants SET extra = extra || char(1) || id WHERE product_id = ?").run(pid);

    for (const l of lines) {
      const old = (l.id && byId.get(l.id)) || byKey.get(`${l.color}|${l.size}|${l.extra}`);
      let sku = l.sku;
      if (sku) {
        const t = q.skuTaken.get(sku) as { productId: number } | undefined;
        const ownOld = old && old.sku === sku;
        if ((t && !ownOld) || usedSku.has(sku)) throw new HttpError(409, `รหัส SKU ${sku} ถูกใช้แล้ว`);
        usedSku.add(sku);
      } else if (old) {
        sku = old.sku;
        usedSku.add(sku);
      } else {
        const r = nextSku(skuBase, usedSku, counter);
        sku = r.sku;
        counter = r.n;
      }

      let vb = l.barcode === undefined ? (old ? oldBarcode.get(old.id) ?? null : null) : l.barcode;
      // SKU ใหม่ที่ยังไม่มีบาร์โค้ด → สร้างให้อัตโนมัติตามการตั้งค่า
      if (!vb && !old && l.barcode === undefined) vb = autoBarcode(sku, pid);
      if (vb) assertVariantBarcodeFree(vb, old?.id ?? null, pid);
      if (old && !kept.has(old.id)) {
        kept.add(old.id);
        // จำนวน: ปรับตามส่วนต่างจากค่าที่เปิดฟอร์ม (ไม่ทับยอดที่ขายไประหว่างแก้ไข)
        const base = l.stockBase ?? old.stock;
        const delta = l.stock - base;
        const newStock = applyDelta(old.stock, delta);
        db.prepare(
          `UPDATE variants SET sku = ?, barcode = ?, size = ?, color = ?, color_hex = ?, extra = ?, stock = ?, price = ?, cost = ?, active = ?, sort = ? WHERE id = ?`,
        ).run(sku, vb, l.size, l.color, l.colorHex, l.extra, newStock, l.price, l.cost, l.active ? 1 : 0, l.sort, old.id);
        if (newStock !== old.stock) q.insMove.run(old.id, newStock - old.stock, newStock, opts.moveReason ?? 'ปรับยอดจากหน้าสินค้า', me.name);
      } else {
        const vid = Number(
          db.prepare(
            `INSERT INTO variants_all (product_id, sku, barcode, size, color, color_hex, extra, stock, price, cost, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          ).run(pid, sku, vb, l.size, l.color, l.colorHex, l.extra, l.price, l.cost, l.active ? 1 : 0, l.sort).lastInsertRowid,
        );
        // สต็อกเริ่มต้นเป็นของสาขาที่สร้าง (สาขาอื่นเริ่มที่ 0)
        if (l.stock > 0) db.prepare('UPDATE variants SET stock = ? WHERE id = ?').run(l.stock, vid);
        if (l.stock > 0) q.insMove.run(vid, l.stock, l.stock, opts.moveReason ?? 'รับเข้า (สร้าง SKU)', me.name);
      }
    }

    // SKU ที่ถูกเอาออก: ถ้าเคยขายแล้ว → ซ่อน (เก็บไว้ให้บิลเก่าอ้างอิง), ถ้ายังไม่เคยขาย → ลบ
    for (const v of existing) {
      if (kept.has(v.id)) continue;
      if (q.hasSales.get(v.id)) {
        db.prepare("UPDATE variants SET active = 0, extra = ?, sort = 9999 WHERE id = ?").run(`${v.extra}${'\u0001'}ลบแล้ว-${v.id}`, v.id);
      } else {
        db.prepare('DELETE FROM stock_moves_all WHERE variant_id = ?').run(v.id);
        db.prepare('DELETE FROM variants WHERE id = ?').run(v.id);
      }
    }
    return getProduct(pid, me);
  });
}

// ---------------- สต็อกสินค้า (คุณสมบัติ): ตาราง ไซซ์ × สี แบ่งหน้าตามสินค้า ----------------
const SKU_SORT: Record<string, string> = {
  code: 'p.sku', name: 'p.name', stock: 'SUM(v.stock)', price: 'MIN(COALESCE(v.price, p.price))',
};
export function listSkus(
  f: { q?: string; category?: string; status?: string; sort?: string; dir?: string; page?: string; limit?: string },
  me: Me,
) {
  const live = 'instr(v.extra, char(1)) = 0';
  const conds: string[] = ['p.deleted_at IS NULL'];
  const args: (string | number)[] = [];
  if (f.category) { conds.push('p.category_id = ?'); args.push(f.category); }
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    conds.push(`(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (SELECT 1 FROM variants x WHERE x.product_id = p.id
      AND instr(x.extra, char(1)) = 0 AND (x.sku LIKE ? OR x.barcode LIKE ? OR x.color LIKE ? OR x.size LIKE ? OR x.extra LIKE ?)))`);
    args.push(like, like, like, like, like, like, like, like);
  }
  // สถานะ: สินค้าที่มี SKU ตรงเงื่อนไขอย่างน้อย 1 รายการ
  const has = (c: string) => `EXISTS (SELECT 1 FROM variants x WHERE x.product_id = p.id AND instr(x.extra, char(1)) = 0 AND ${c})`;
  switch (f.status) {
    case 'active': conds.push(`p.active = 1 AND ${has('x.active = 1')}`); break;
    case 'inactive': conds.push(`(p.active = 0 OR ${has('x.active = 0')})`); break;
    case 'low': conds.push(has('x.stock > 0 AND x.stock <= p.low_stock')); break;
    case 'out': conds.push(has('x.stock = 0')); break;
    case 'nobarcode': conds.push(has("(x.barcode IS NULL OR x.barcode = '')")); break;
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(5, Number(f.limit) || 20));
  const tot = db
    .prepare(
      `SELECT COUNT(DISTINCT p.id) AS products, COUNT(v.id) AS skus, COALESCE(SUM(v.stock), 0) AS units
         FROM products p JOIN variants v ON v.product_id = p.id AND ${live} ${where}`,
    )
    .get(...args) as { products: number; skus: number; units: number };
  const pages = Math.max(1, Math.ceil(tot.products / limit));
  const page = Math.min(pages, Math.max(1, Number(f.page) || 1));
  const col = SKU_SORT[f.sort ?? ''];
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const ids = (
    db
      .prepare(
        `SELECT p.id FROM products p JOIN variants v ON v.product_id = p.id AND ${live} ${where}
          GROUP BY p.id ORDER BY ${col ? `${col} ${dir}, ` : ''}p.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, (page - 1) * limit) as { id: number }[]
  ).map((r) => r.id);

  const products = ids.map((id) => skuProduct(id, me));
  return { total: tot.products, skus: tot.skus, units: tot.units, page, pages, limit, products };
}

/** สินค้า 1 รายการ + SKU ทั้งหมด สำหรับตาราง สี × ไซซ์ */
export function skuProduct(id: number, me: Me) {
  const manager = can(me, 'stock', 'edit'); // เห็นต้นทุน = คนที่แก้สต็อกได้
  const p = db
    .prepare(
      `SELECT p.id, p.sku AS code, p.name, p.barcode, p.category_id AS categoryId, c.name AS category, p.art, p.tint,
              p.image_url AS imageUrl, p.active, p.low_stock AS lowStock, p.attrs, p.price, p.cost
         FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    )
    .get(id) as (Record<string, unknown> & { attrs: string | null; price: number; cost: number | null }) | undefined;
  if (!p) throw new HttpError(404, 'ไม่พบสินค้า');
  const vs = q.variants.all(id) as VariantRow[];
  return {
    id: p.id, code: p.code, name: p.name, barcode: p.barcode, categoryId: p.categoryId, category: p.category, art: p.art,
    tint: p.tint, imageUrl: p.imageUrl, active: !!p.active, lowStock: p.lowStock,
    attrs: (p.attrs ? JSON.parse(p.attrs) : []) as Attr[],
    variants: vs.map((v) => ({
      id: v.id, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color, colorHex: v.colorHex, extra: v.extra,
      stock: v.stock, active: !!v.active, price: v.price ?? p.price, cost: manager ? v.cost ?? p.cost ?? 0 : undefined,
    })),
  };
}

/**
 * แก้ไขทุก SKU ของสินค้าในครั้งเดียว (ปุ่มแก้ไขในตาราง สี × ไซซ์): จำนวน · ราคาขาย · บาร์โค้ด · แสดงขาย
 * จำนวนปรับตามส่วนต่างจากค่าที่เปิดแก้ (stockBase) เพื่อไม่ทับยอดที่ขายไประหว่างแก้ไข
 */
export function bulkUpdateSkus(
  pid: number,
  body: { variants?: { id: number; stock?: number; stockBase?: number; price?: number; barcode?: string | null; active?: boolean }[] },
  me: Me,
) {
  requireFeature(me, 'stock', 'edit');
  const list = Array.isArray(body.variants) ? body.variants : [];
  const existing = new Map((q.variants.all(pid) as VariantRow[]).map((v) => [v.id, v]));
  if (!existing.size) throw new HttpError(404, 'ไม่พบสินค้า');
  const seen = new Set<string>();
  const lines = list.map((x) => {
    const v = existing.get(Number(x.id));
    if (!v) throw new HttpError(422, 'มี SKU ที่ไม่ใช่ของสินค้านี้');
    const label = variantLabel(v);
    let stock: number | undefined;
    if (x.stock !== undefined) {
      const n = num(x.stock, Math.min(minStock(), Number(x.stockBase ?? 0) || 0, v.stock), 999999);
      if (n == null || !Number.isInteger(n)) throw new HttpError(422, `จำนวนของ ${label} ต้องเป็นจำนวนเต็ม${minStock() < 0 ? '' : ' 0 ขึ้นไป'}`);
      stock = n;
    }
    let price: number | undefined;
    if (x.price !== undefined) {
      const n = num(x.price);
      if (n == null) throw new HttpError(422, `ราคาขายของ ${label} ไม่ถูกต้อง`);
      price = round2(n);
    }
    let barcode: string | null | undefined;
    if (x.barcode !== undefined) {
      barcode = cleanCode(x.barcode) || null;
      if (barcode && !CODE_RE.test(barcode)) throw new HttpError(422, `บาร์โค้ดของ ${label} ใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .`);
      if (barcode && seen.has(barcode)) throw new HttpError(422, `บาร์โค้ด ${barcode} ซ้ำกันในสินค้านี้`);
      if (barcode) seen.add(barcode);
    }
    return { v, label, stock, stockBase: x.stockBase != null ? Number(x.stockBase) : null, price, barcode, active: x.active };
  });

  return tx(() => {
    // ล้างบาร์โค้ดที่จะเปลี่ยนก่อน → สลับบาร์โค้ดระหว่าง SKU ได้
    for (const l of lines) if (l.barcode !== undefined) db.prepare('UPDATE variants SET barcode = NULL WHERE id = ?').run(l.v.id);
    for (const l of lines) {
      if (l.barcode !== undefined) {
        if (l.barcode) {
          try {
            assertVariantBarcodeFree(l.barcode, l.v.id, pid);
          } catch (e) {
            throw new HttpError(409, `${l.label}: ${(e as Error).message}`);
          }
        }
        db.prepare('UPDATE variants SET barcode = ? WHERE id = ?').run(l.barcode, l.v.id);
      }
      if (l.price !== undefined) db.prepare('UPDATE variants SET price = ? WHERE id = ?').run(l.price, l.v.id);
      if (l.active !== undefined) db.prepare('UPDATE variants SET active = ? WHERE id = ?').run(l.active ? 1 : 0, l.v.id);
      if (l.stock !== undefined) {
        const cur = (db.prepare('SELECT stock FROM variants WHERE id = ?').get(l.v.id) as { stock: number }).stock;
        const next = applyDelta(cur, l.stock - (l.stockBase ?? cur));
        if (next !== cur) {
          db.prepare('UPDATE variants SET stock = ? WHERE id = ?').run(next, l.v.id);
          q.insMove.run(l.v.id, next - cur, next, 'ปรับยอดจากตาราง สี × ไซซ์', me.name);
        }
      }
    }
    db.prepare(
      `UPDATE products SET price = COALESCE((SELECT MIN(price) FROM variants_all WHERE product_id = ? AND instr(extra, char(1)) = 0), price),
              updated_at = datetime('now', 'localtime') WHERE id = ?`,
    ).run(pid, pid);
    return skuProduct(pid, me);
  });
}

/**
 * บันทึกจากหน้าแก้ไขสินค้าที่ "สาขาย่อย": ใช้เฉพาะจำนวนและราคาขายของสาขานี้
 * (ชื่อ หมวดหมู่ รูป คุณสมบัติ ต้นทุน แสดงขาย เป็นของสาขาหลัก — ไม่บันทึก)
 */
export function saveBranchStock(pid: number, body: { variants?: { id?: number | null; stock?: number; stockBase?: number | null; price?: number }[] }, me: Me) {
  const variants = (Array.isArray(body.variants) ? body.variants : [])
    .filter((v) => v.id)
    .map((v) => ({ id: Number(v.id), stock: v.stock, stockBase: v.stockBase ?? undefined, price: v.price }));
  if (variants.length) bulkUpdateSkus(pid, { variants }, me);
  return getProduct(pid, me);
}

/** แก้ไขทีละ SKU จากตาราง: บาร์โค้ด (กำหนดเอง) / แสดงขาย */
export function patchVariant(id: number, body: { barcode?: string | null; active?: boolean }, me: Me) {
  requireFeature(me, 'stock', 'edit');
  const v = db.prepare('SELECT id, product_id AS productId, barcode, active, extra FROM variants WHERE id = ?').get(id) as
    | { id: number; productId: number; barcode: string | null; active: number; extra: string }
    | undefined;
  if (!v || v.extra.includes('\u0001')) throw new HttpError(404, 'ไม่พบ SKU');
  return tx(() => {
    if (body.barcode !== undefined) {
      const code = cleanCode(body.barcode) || null;
      if (code && !CODE_RE.test(code)) throw new HttpError(422, 'บาร์โค้ดใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .');
      if (code) assertVariantBarcodeFree(code, v.id, v.productId);
      db.prepare('UPDATE variants SET barcode = ? WHERE id = ?').run(code, id);
    }
    if (body.active !== undefined) db.prepare('UPDATE variants SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id);
    db.prepare("UPDATE products SET updated_at = datetime('now', 'localtime') WHERE id = ?").run(v.productId);
    const r = db.prepare('SELECT id, barcode, active FROM variants WHERE id = ?').get(id) as { id: number; barcode: string | null; active: number };
    return { ...r, active: !!r.active };
  });
}

/** เปิด/ปิดแสดงขายทั้งสินค้า (สวิตช์ในรายการ) */
export function setProductActive(id: number, active: boolean) {
  const r = db.prepare("UPDATE products SET active = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(active ? 1 : 0, id);
  if (r.changes !== 1) throw new HttpError(404, 'ไม่พบสินค้า');
  return { id, active };
}

// ---------------- รูปสินค้า ----------------
const IMG_DATA = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const UPLOAD_NAME = /^([a-f0-9]{24})(?:\.(m|s))?\.(jpg|png|webp)$/;

function decodeImage(dataUrl: unknown, max = 3_000_000) {
  const m = IMG_DATA.exec(String(dataUrl ?? ''));
  if (!m) throw new HttpError(422, 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > max) throw new HttpError(413, 'ไฟล์ใหญ่เกิน 3MB');
  return { buf, ext: m[1] === 'jpeg' ? 'jpg' : m[1] };
}

/** บันทึกรูปย่อ (m = กลาง, s = เล็ก) ไว้ข้างรูปหลัก: <id>.m.jpg / <id>.s.jpg */
function saveVariants(id: string, variants: { m?: unknown; s?: unknown } | undefined) {
  for (const k of ['m', 's'] as const) {
    if (!variants?.[k]) continue;
    const v = decodeImage(variants[k], 1_000_000);
    writeFileSync(join(UPLOAD_DIR, `${id}.${k}.${v.ext}`), v.buf);
  }
}

/** อัปโหลดรูป + รูปย่อ (ย่อในเบราว์เซอร์มาแล้ว) */
export function saveUpload(body: { dataUrl?: string; variants?: { m?: string; s?: string } }) {
  const { buf, ext } = decodeImage(body.dataUrl);
  const id = randomBytes(12).toString('hex');
  writeFileSync(join(UPLOAD_DIR, `${id}.${ext}`), buf);
  saveVariants(id, body.variants);
  return { url: `/uploads/${id}.${ext}` };
}

/** เพิ่มรูปย่อให้รูปที่อัปโหลดไว้ก่อนแล้ว (ตั้งค่า → การแสดงผล → สร้างรูปย่อ) */
export function saveUploadVariants(body: { url?: string; variants?: { m?: string; s?: string } }) {
  const m = UPLOAD_NAME.exec(String(body.url ?? '').replace(/^\/uploads\//, ''));
  if (!m || m[2] || !existsSync(join(UPLOAD_DIR, `${m[1]}.${m[3]}`))) throw new HttpError(404, 'ไม่พบรูปนี้');
  saveVariants(m[1], body.variants);
  return { ok: true };
}

/** รูปที่ยังไม่มีรูปย่อ (สำหรับปุ่มสร้างรูปย่อ) */
export function uploadsMissingVariants() {
  const urls = (db.prepare("SELECT DISTINCT image_url AS u FROM products WHERE image_url LIKE '/uploads/%'").all() as { u: string }[]).map((r) => r.u);
  return urls.filter((u) => {
    const m = UPLOAD_NAME.exec(u.slice('/uploads/'.length));
    return m && !m[2] && existsSync(join(UPLOAD_DIR, `${m[1]}.${m[3]}`))
      && !['jpg', 'png', 'webp'].some((e) => existsSync(join(UPLOAD_DIR, `${m[1]}.s.${e}`)));
  });
}

/** ขอรูปย่อที่ยังไม่มี → ส่งรูปหลักแทน (รูปเก่าก่อนมีระบบรูปย่อ ยังแสดงได้ตามปกติ) */
export function readUpload(path: string) {
  const m = UPLOAD_NAME.exec(path.slice('/uploads/'.length));
  if (!m) return null;
  const typeOf = (e: string) => (e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg');
  const tries = m[2] ? [`${m[1]}.${m[2]}.jpg`, `${m[1]}.${m[2]}.${m[3]}`, `${m[1]}.${m[3]}`] : [`${m[1]}.${m[3]}`];
  for (const [i, name] of tries.entries()) {
    const file = normalize(join(UPLOAD_DIR, name));
    // fallback = ส่งรูปหลักแทนรูปย่อ → ห้ามแคชยาว (สร้างรูปย่อทีหลังแล้วจะได้เห็นทันที)
    if (file.startsWith(UPLOAD_DIR) && existsSync(file)) return { buf: readFileSync(file), type: typeOf(name.split('.').pop()!), fallback: !!m[2] && i === tries.length - 1 };
  }
  return null;
}

// ---------------- คำสั่งพิเศษ: [บาร์โค้ด] [จำนวน] ----------------
export type StockCmdMode = 'check' | 'add' | 'set';
const CMD_REASON: Record<Exclude<StockCmdMode, 'check'>, string> = { add: 'คำสั่ง: เพิ่ม/ลบสต็อก', set: 'คำสั่ง: ปรับสต็อกใหม่' };

/**
 * check = เช็คสต็อก (เทียบจำนวนที่นับได้กับในระบบ ไม่แก้ข้อมูล)
 * add   = เพิ่ม/ลบสต็อก (+/- จากยอดปัจจุบัน)
 * set   = ปรับสต็อกใหม่ (ตั้งยอดใหม่ทับ)
 * บรรทัดที่รหัสซ้ำจะถูกรวมกัน · apply=false = แสดงผลอย่างเดียว
 */
export function stockCommand(body: { mode?: string; lines?: { code?: string; qty?: number | string; line?: number }[]; apply?: boolean }, me: Me) {
  const mode = (['check', 'add', 'set'] as const).find((m) => m === body.mode);
  if (!mode) throw new HttpError(422, 'ไม่รู้จักคำสั่ง');
  if (mode !== 'check') requireFeature(me, 'stock', 'edit');
  const input = Array.isArray(body.lines) ? body.lines.slice(0, 5000) : [];
  if (!input.length) throw new HttpError(422, 'ยังไม่มีรายการ — พิมพ์ [บาร์โค้ด] [จำนวน] บรรทัดละ 1 รายการ');

  const find = db.prepare(
    `SELECT v.id, v.sku, v.barcode, v.size, v.color, v.extra, v.stock, v.active, p.id AS productId, p.sku AS code, p.name
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE instr(v.extra, char(1)) = 0 AND (UPPER(v.barcode) = UPPER(?) OR UPPER(v.sku) = UPPER(?))
      ORDER BY (UPPER(v.barcode) = UPPER(?)) DESC LIMIT 1`,
  );
  type Hit = { id: number; sku: string; barcode: string | null; size: string; color: string; extra: string; stock: number; active: number; productId: number; code: string; name: string };

  const errors: { line: number; code: string; error: string }[] = [];
  const agg = new Map<number, { v: Hit; qty: number; codes: Set<string>; lines: number[] }>();
  input.forEach((l, i) => {
    const line = Number(l.line) || i + 1;
    const code = String(l.code ?? '').trim();
    if (!code) return;
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || !Number.isInteger(qty)) return errors.push({ line, code, error: 'จำนวนต้องเป็นจำนวนเต็ม' });
    if (mode !== 'add' && qty < 0) return errors.push({ line, code, error: 'จำนวนติดลบไม่ได้' });
    if (Math.abs(qty) > 999999) return errors.push({ line, code, error: 'จำนวนมากเกินไป' });
    const v = find.get(code, code, code) as Hit | undefined;
    if (!v) return errors.push({ line, code, error: 'ไม่พบบาร์โค้ด/รหัส SKU นี้' });
    const a = agg.get(v.id) ?? { v, qty: 0, codes: new Set<string>(), lines: [] };
    a.qty += qty;
    a.codes.add(code);
    a.lines.push(line);
    agg.set(v.id, a);
  });

  const rows = [...agg.values()].map(({ v, qty, codes, lines }) => {
    const after = mode === 'add' ? v.stock + qty : mode === 'set' ? qty : v.stock;
    const diff = mode === 'check' ? qty - v.stock : after - v.stock;
    return {
      id: v.id, productId: v.productId, code: v.code, name: v.name, label: variantLabel(v), sku: v.sku, barcode: v.barcode,
      input: [...codes].join(', '), lines, qty, before: v.stock, after, diff, active: !!v.active,
      // เพิ่ม/ลบสต็อก: ยอดติดลบเดิม + จำนวนที่เติม เช่น -8 + 10 = 2 · ปิด "ขายได้แม้สต็อกหมด" → ห้ามจบที่ติดลบ (ยกเว้นยอดดีขึ้น)
      error: mode === 'add' && after < 0 && qty < 0 && !allowNegativeStock() ? `ยอดจะติดลบ (${after})` : null,
    };
  });
  const bad = rows.filter((r) => r.error).length + errors.length;
  const summary = {
    skus: rows.length,
    units: rows.reduce((a, r) => a + r.qty, 0),
    match: rows.filter((r) => r.diff === 0).length,
    over: rows.filter((r) => r.diff > 0).length,
    short: rows.filter((r) => r.diff < 0).length,
    errors: bad,
  };

  let applied = 0;
  if (body.apply && mode !== 'check') {
    if (bad) throw new HttpError(422, `มี ${bad} รายการที่ไม่ถูกต้อง — แก้ไขก่อนยืนยัน`);
    tx(() => {
      for (const r of rows) {
        // คิดจากยอดล่าสุด ณ ตอนยืนยัน (กันยอดเปลี่ยนระหว่างดูตัวอย่าง)
        const cur = (db.prepare('SELECT stock FROM variants WHERE id = ?').get(r.id) as { stock: number }).stock;
        const next = mode === 'add' ? cur + r.qty : r.qty;
        if (next < 0 && next < cur && !allowNegativeStock()) throw new HttpError(409, `${r.name} (${r.label}): ยอดจะติดลบ`);
        if (next === cur) continue;
        db.prepare('UPDATE variants SET stock = ? WHERE id = ?').run(next, r.id);
        q.insMove.run(r.id, next - cur, next, CMD_REASON[mode], me.name);
        r.before = cur;
        r.after = next;
        r.diff = next - cur;
        applied++;
      }
      const pids = [...new Set(rows.map((r) => r.productId))];
      for (const pid of pids) db.prepare("UPDATE products SET updated_at = datetime('now', 'localtime') WHERE id = ?").run(pid);
    });
  }
  return { mode, rows, errors, summary, applied: body.apply ? applied : null };
}

// ---------------- จัดการหลายสินค้าพร้อมกัน ----------------
export type BulkAction = 'activate' | 'deactivate' | 'category' | 'zero' | 'delete' | 'vat' | 'exempt';

/**
 * activate/deactivate = เปิด/ปิดแสดงขาย · category = ย้ายหมวดหมู่ · zero = ล้างสต็อกเป็น 0 · delete = ลบสินค้า
 * ลบ: สินค้าที่ยังไม่เคยขาย → ลบจริง · เคยขายแล้ว → ซ่อนถาวร (บิลเก่ายังเปิดดูได้) และคืนรหัส/บาร์โค้ดให้ใช้ใหม่ได้
 */
export function bulkProducts(body: { ids?: number[]; action?: string; categoryId?: string }, me: Me) {
  requireFeature(me, 'stock', 'edit');
  const action = (['activate', 'deactivate', 'category', 'zero', 'delete', 'vat', 'exempt'] as const).find((a) => a === body.action);
  if (!action) throw new HttpError(422, 'ไม่รู้จักคำสั่ง');
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 1000);
  if (!ids.length) throw new HttpError(422, 'ยังไม่ได้เลือกสินค้า');
  if (action === 'category' && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(String(body.categoryId ?? ''))) {
    throw new HttpError(422, 'กรุณาเลือกหมวดหมู่');
  }
  const now = "datetime('now', 'localtime')";
  let done = 0;
  let archived = 0;
  tx(() => {
    for (const id of ids) {
      const p = db.prepare('SELECT id, sku FROM products WHERE id = ? AND deleted_at IS NULL').get(id) as { id: number; sku: string } | undefined;
      if (!p) continue;
      switch (action) {
        case 'activate':
        case 'deactivate':
          db.prepare(`UPDATE products SET active = ?, updated_at = ${now} WHERE id = ?`).run(action === 'activate' ? 1 : 0, id);
          break;
        case 'category':
          db.prepare(`UPDATE products SET category_id = ?, updated_at = ${now} WHERE id = ?`).run(body.categoryId, id);
          break;
        // เสีย VAT / ยกเว้น VAT (มีผลกับบิลใหม่ — บิลเดิมเก็บค่าตอนขายไว้แล้ว)
        case 'vat':
        case 'exempt':
          db.prepare(`UPDATE products SET vat_exempt = ?, updated_at = ${now} WHERE id = ?`).run(action === 'exempt' ? 1 : 0, id);
          break;
        case 'zero': {
          const vs = q.variants.all(id) as VariantRow[];
          for (const v of vs) {
            if (v.stock === 0) continue;
            db.prepare('UPDATE variants SET stock = 0 WHERE id = ?').run(v.id);
            q.insMove.run(v.id, -v.stock, 0, 'ล้างสต็อก (เลือกหลายรายการ)', me.name);
          }
          db.prepare(`UPDATE products SET updated_at = ${now} WHERE id = ?`).run(id);
          break;
        }
        case 'delete': {
          const sold = db.prepare('SELECT 1 FROM order_items oi JOIN variants v ON v.id = oi.variant_id WHERE v.product_id = ? LIMIT 1').get(id);
          if (sold) {
            // เก็บไว้แบบซ่อน: ปิดขาย, ซ่อนทุก SKU, ปล่อยรหัส/บาร์โค้ดให้ใช้ใหม่ได้
            db.prepare(`UPDATE products SET active = 0, deleted_at = ${now}, barcode = NULL, sku = sku || '~ลบ' || id WHERE id = ?`).run(id);
            db.prepare(
              `UPDATE variants SET active = 0, barcode = NULL, sku = sku || '~ลบ' || id,
                      extra = CASE WHEN instr(extra, char(1)) = 0 THEN extra || char(1) || 'ลบแล้ว-' || id ELSE extra END
                WHERE product_id = ?`,
            ).run(id);
            archived++;
          } else {
            db.prepare('DELETE FROM stock_moves_all WHERE variant_id IN (SELECT id FROM variants_all WHERE product_id = ?)').run(id);
            db.prepare('DELETE FROM variants_all WHERE product_id = ?').run(id);
            db.prepare('DELETE FROM products WHERE id = ?').run(id);
          }
          break;
        }
      }
      done++;
    }
  });
  return { action, done, archived };
}
