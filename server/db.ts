// SQLite database layer (ใช้ node:sqlite ที่มากับ Node.js — ไม่ต้องติดตั้ง native module)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { seed } from './seed.ts';

export const DB_PATH = resolve(process.env.DB_PATH ?? 'data/pos.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const tableExists = (name: string) => !!db.prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?").get(name);
/** ฐานข้อมูลที่แยกข้อมูลตามสาขาแล้ว (ตาราง variants → variants_all ฯลฯ) */
const MIGRATED = tableExists('variants_all');

// ---------- โครงสร้างเดิม (ร้านเดียว) — ใช้กับฐานข้อมูลที่ยังไม่แยกสาขา ----------
if (!MIGRATED) {
db.exec(`

  CREATE TABLE IF NOT EXISTS categories (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    name_en   TEXT NOT NULL,
    icon      TEXT NOT NULL,
    sort      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sku         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    price       REAL NOT NULL CHECK (price >= 0),
    art         TEXT NOT NULL DEFAULT 'tshirt',
    tint        TEXT NOT NULL DEFAULT '#E8EEF9',
    image_url   TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS variants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku        TEXT NOT NULL UNIQUE,
    size       TEXT NOT NULL,
    color      TEXT NOT NULL,
    color_hex  TEXT NOT NULL,
    extra      TEXT NOT NULL DEFAULT '',      -- คุณสมบัติที่ 3 เช่น ดีไซน์/ลาย/ความยาว
    stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    price      REAL,                          -- NULL = ใช้ราคาของสินค้า
    cost       REAL,                          -- NULL = ใช้ต้นทุนของสินค้า
    active     INTEGER NOT NULL DEFAULT 1,    -- สวิตช์แสดงขาย
    sort       INTEGER NOT NULL DEFAULT 0,
    UNIQUE (product_id, size, color, extra)
  );

  CREATE TABLE IF NOT EXISTS staff (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS promos (
    code      TEXT PRIMARY KEY,
    label     TEXT NOT NULL,
    type      TEXT NOT NULL CHECK (type IN ('percent', 'amount')),
    value     REAL NOT NULL,
    min_total REAL NOT NULL DEFAULT 0,
    active    INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no       TEXT NOT NULL UNIQUE,
    customer_name  TEXT,
    salesperson    TEXT,
    order_type     TEXT NOT NULL,
    subtotal       REAL NOT NULL,
    discount       REAL NOT NULL DEFAULT 0,
    vat            REAL NOT NULL,
    total          REAL NOT NULL,
    promo_code     TEXT,
    payment_method TEXT NOT NULL,
    cash_received  REAL,
    change_due     REAL,
    status         TEXT NOT NULL DEFAULT 'paid',
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id   INTEGER NOT NULL REFERENCES variants(id),
    product_name TEXT NOT NULL,
    sku          TEXT NOT NULL,
    size         TEXT NOT NULL,
    color        TEXT NOT NULL,
    qty          INTEGER NOT NULL CHECK (qty > 0),
    unit_price   REAL NOT NULL,
    line_total   REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
  CREATE INDEX IF NOT EXISTS idx_variants_product  ON variants(product_id);
  CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_items_order       ON order_items(order_id);
`);

// ---------- migrations (รองรับฐานข้อมูลเดิมที่สร้างไปแล้ว) ----------
function addColumn(table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('orders', 'updated_at', 'TEXT');
addColumn('orders', 'edit_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'void_reason', 'TEXT');

db.exec(`
  -- ประวัติการแก้ไขบิล (เปลี่ยนสินค้า / คืนเงิน / เก็บเงินเพิ่ม / ยกเลิก)
  CREATE TABLE IF NOT EXISTS order_edits (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL DEFAULT 'edit',      -- edit | void
    edited_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    staff          TEXT NOT NULL,
    reason         TEXT NOT NULL,
    summary        TEXT NOT NULL,
    old_total      REAL NOT NULL,
    new_total      REAL NOT NULL,
    diff           REAL NOT NULL,                     -- + เก็บเพิ่ม / - คืนเงิน
    settle_method  TEXT,
    cash_received  REAL,
    change_due     REAL,
    before_json    TEXT NOT NULL,
    after_json     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_edits_order  ON order_edits(order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);

// ---------- กะการขาย / ลิ้นชักเงินสด ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_no       INTEGER NOT NULL,                 -- กะที่เท่าไรของวัน
    business_date  TEXT NOT NULL,                    -- YYYY-MM-DD (วันที่เปิดกะ)
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    opened_by      TEXT NOT NULL,
    opening_cash   REAL NOT NULL CHECK (opening_cash >= 0),
    opening_note   TEXT,
    closed_at      TEXT,
    closed_by      TEXT,
    counted_cash   REAL,                             -- เงินที่นับได้จริงตอนปิดกะ
    expected_cash  REAL,                             -- เงินที่ควรมีในลิ้นชัก
    diff           REAL,                             -- นับได้ - ควรมี (+ เกิน / - ขาด)
    denominations  TEXT,                             -- JSON การนับแบงก์/เหรียญ
    close_note     TEXT,
    cash_sales     REAL,                             -- snapshot ตอนปิดกะ
    cash_in        REAL,
    cash_out       REAL,
    total_sales    REAL,
    bill_count     INTEGER
  );
  -- เปิดได้ทีละ 1 กะ
  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_shift ON shifts(status) WHERE status = 'open';
  CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(business_date);

  -- นำเงินเข้า/ออกลิ้นชักระหว่างกะ (เช่น แลกเหรียญ, จ่ายค่าส่งของ)
  CREATE TABLE IF NOT EXISTS cash_movements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id   INTEGER NOT NULL REFERENCES shifts(id),
    kind       TEXT NOT NULL CHECK (kind IN ('in', 'out')),
    amount     REAL NOT NULL CHECK (amount > 0),
    reason     TEXT NOT NULL,
    staff      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_moves_shift ON cash_movements(shift_id);

  -- สมุดรับ-จ่ายเงินตามวิธีชำระ (ขาย / เก็บเพิ่ม-คืนเงินจากการแก้ไขบิล / ยกเลิกบิล)
  CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id   INTEGER NOT NULL REFERENCES shifts(id),
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    kind       TEXT NOT NULL CHECK (kind IN ('sale', 'edit', 'void')),
    method     TEXT NOT NULL,
    amount     REAL NOT NULL,                        -- + รับเข้า / - จ่ายคืน
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments(shift_id);
`);
addColumn('orders', 'shift_id', 'INTEGER');
// ต้นทุนสินค้า (ใช้คำนวณกำไรขั้นต้น) — ค่าเริ่มต้นประมาณ 45% ของราคาขาย แก้ได้ภายหลัง
addColumn('products', 'cost', 'REAL');
db.exec('UPDATE products SET cost = ROUND(price * 0.45) WHERE cost IS NULL');
db.exec("CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at)");

const count = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
if (count.n === 0) {
  seed(db);
  console.log('[db] seeded demo catalogue');
}
db.exec('UPDATE products SET cost = ROUND(price * 0.45) WHERE cost IS NULL'); // สินค้าใหม่จาก seed

// ---------- ระบบสต็อก: ปรับโครงสร้างตาราง variants (ฐานข้อมูลเดิม) ----------
{
  const vcols = (db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]).map((c) => c.name);
  if (!vcols.includes('extra')) {
    // สร้างตารางใหม่เพื่อเปลี่ยน UNIQUE (product_id, size, color) → (…, extra) — id เดิมคงไว้ บิลเก่าอ้างอิงได้ตามเดิม
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE variants_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          sku        TEXT NOT NULL UNIQUE,
          size       TEXT NOT NULL,
          color      TEXT NOT NULL,
          color_hex  TEXT NOT NULL,
          extra      TEXT NOT NULL DEFAULT '',
          stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
          price      REAL,
          cost       REAL,
          active     INTEGER NOT NULL DEFAULT 1,
          sort       INTEGER NOT NULL DEFAULT 0,
          UNIQUE (product_id, size, color, extra)
        );
        INSERT INTO variants_new (id, product_id, sku, size, color, color_hex, stock, sort)
          SELECT id, product_id, sku, size, color, color_hex, stock, id FROM variants;
        DROP TABLE variants;
        ALTER TABLE variants_new RENAME TO variants;
        CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    console.log('[db] ปรับตาราง variants สำหรับระบบสต็อกแล้ว');
  }
}
addColumn('products', 'barcode', 'TEXT');
addColumn('products', 'note', 'TEXT');
addColumn('products', 'low_stock', 'INTEGER NOT NULL DEFAULT 3');
addColumn('products', 'attrs', 'TEXT');
addColumn('products', 'updated_at', 'TEXT');
addColumn('order_items', 'extra', "TEXT NOT NULL DEFAULT ''");
// บาร์โค้ด (กำหนดเอง) ของแต่ละ SKU — ใช้พิมพ์ป้าย label และสแกนขาย
addColumn('variants', 'barcode', 'TEXT');
// ลบสินค้า (สินค้าที่เคยขายแล้วจะถูกเก็บไว้แบบซ่อน เพื่อให้บิลเก่ายังอ้างอิงได้)
addColumn('products', 'deleted_at', 'TEXT');
// ค่าธรรมเนียมการชำระเงินของบิล (ร้านเป็นผู้จ่าย) — ตั้งค่าได้ที่ ตั้งค่า → วิธีชำระเงิน
addColumn('orders', 'fee', 'REAL NOT NULL DEFAULT 0');
addColumn('orders', 'fee_payer', "TEXT NOT NULL DEFAULT 'shop'"); // customer = บวกในยอดบิลแล้ว
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL AND barcode != '';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_barcode ON variants(barcode) WHERE barcode IS NOT NULL AND barcode != '';
  -- ประวัติการเปลี่ยนแปลงสต็อก (รับเข้า/ปรับยอด)
  CREATE TABLE IF NOT EXISTS stock_moves (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL REFERENCES variants(id),
    delta      INTEGER NOT NULL,
    balance    INTEGER NOT NULL,
    reason     TEXT NOT NULL,
    staff      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_stock_moves_variant ON stock_moves(variant_id);
`);

// สร้างนิยามคุณสมบัติ (attrs) ให้สินค้าเดิมจาก SKU ที่มีอยู่
{
  const rows = db.prepare('SELECT id FROM products WHERE attrs IS NULL').all() as { id: number }[];
  const vs = db.prepare('SELECT size, color, color_hex AS hex FROM variants WHERE product_id = ? ORDER BY sort, id');
  const upd = db.prepare('UPDATE products SET attrs = ? WHERE id = ?');
  for (const r of rows) {
    const list = vs.all(r.id) as { size: string; color: string; hex: string }[];
    const colors = [...new Map(list.filter((v) => v.color !== '-').map((v) => [v.color, { value: v.color, hex: v.hex }])).values()];
    const sizes = [...new Set(list.filter((v) => v.size !== '-').map((v) => v.size))].map((value) => ({ value }));
    const attrs = [];
    if (colors.length) attrs.push({ type: 'color', name: 'สี', options: colors });
    if (sizes.length) attrs.push({ type: 'size', name: 'ไซซ์', options: sizes });
    upd.run(JSON.stringify(attrs), r.id);
  }
}

} // end !MIGRATED

// =====================================================================
// หลายสาขาในฐานข้อมูลเดียว
// - สินค้า/หมวดหมู่/SKU ใช้ร่วมกันทุกสาขา (เพิ่มที่สาขาหลัก ทุกสาขาเห็นทันที)
// - สต็อก + ราคาที่ตั้งเอง ของแต่ละสาขาอยู่ใน branch_stock
// - บิล กะ การรับ-จ่ายเงิน ความเคลื่อนไหวสต็อก มี branch_id
// - ทุก request ตั้ง "สาขาปัจจุบัน" (setBranch) → view ชื่อเดิม (orders, variants …) เห็นเฉพาะข้อมูลของสาขานั้น
//   โค้ดเดิมที่ query ตาราง orders/variants จึงทำงานได้โดยไม่ต้องแก้
// =====================================================================
const SCOPED = ['orders', 'shifts', 'cash_movements', 'payments', 'stock_moves'] as const;

function readSetting(section: string): Record<string, any> {
  if (!tableExists('settings')) return {};
  const r = db.prepare('SELECT value FROM settings WHERE section = ?').get(section) as { value: string } | undefined;
  try {
    return r ? JSON.parse(r.value) : {};
  } catch {
    return {};
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    code           TEXT NOT NULL DEFAULT '',
    address        TEXT NOT NULL DEFAULT '',
    vat_registered INTEGER NOT NULL DEFAULT 0,
    phone          TEXT NOT NULL DEFAULT '',
    photo          TEXT NOT NULL DEFAULT '',
    is_main        INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    deleted_at     TEXT
  );
`);
{
  const cols = (db.prepare('PRAGMA table_info(branches)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('is_main')) db.exec('ALTER TABLE branches ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0');
  // สาขาตามทะเบียนภาษี: '00000' = สำนักงานใหญ่ · '00001' … = สาขาที่ (ว่าง = ยังไม่ระบุ)
  if (!cols.includes('tax_branch_no')) db.exec("ALTER TABLE branches ADD COLUMN tax_branch_no TEXT NOT NULL DEFAULT ''");
  // คอลัมน์ที่เลิกใช้: ที่อยู่แยกช่อง (รวมเป็น address) · url / key_id ของระบบเชื่อมสาขาแบบแยกเครื่อง (เลิกแล้ว — ทุกสาขาใช้เซิร์ฟเวอร์เดียว)
  for (const c of ['country', 'province', 'postcode', 'tax_id', 'url', 'key_id']) if (cols.includes(c)) db.exec(`ALTER TABLE branches DROP COLUMN ${c}`);
}

/** สาขาหลัก = ข้อมูลร้านเดิม (ตั้งค่า → ข้อมูลร้าน) */
function ensureMainBranch(): number {
  const cur = db.prepare('SELECT id FROM branches WHERE is_main = 1 AND deleted_at IS NULL').get() as { id: number } | undefined;
  if (cur) return cur.id;
  const shop = readSetting('shop');
  const pay = readSetting('payments');
  // จด VAT: ตามที่ร้านเคยตั้งไว้ · ไม่เคยตั้ง → ดูว่าเคยมีบิลที่คิด VAT ไหม (ข้อมูลเดิม) · ร้านใหม่ = ยังไม่จด VAT
  // (ร้านใหม่ขายได้ทันที — เปิดจด VAT + ตั้งอัตราได้ที่ ตั้งค่า → ภาษี (VAT))
  let hadVat = false;
  for (const t of ['orders_all', 'orders']) {
    try {
      hadVat = !!db.prepare(`SELECT 1 FROM ${t} WHERE vat > 0 LIMIT 1`).get();
      break;
    } catch {
      /* ตารางยังไม่มี */
    }
  }
  const vatRegistered = pay.vat?.enabled === false ? 0 : pay.vat?.enabled === true || hadVat ? 1 : 0;
  const r = db
    .prepare('INSERT INTO branches (name, code, address, vat_registered, phone, photo, is_main) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(
      String(shop.branchName || shop.name || 'สาขาหลัก'), String(shop.branchCode || 'B01'), String(shop.address ?? ''),
      vatRegistered, String(shop.phone ?? ''), String(shop.photoUrl ?? ''),
    );
  return Number(r.lastInsertRowid);
}
const MAIN_ID = ensureMainBranch();

// พนักงาน ↔ สาขาที่ดูแล (ผู้จัดการเห็นทุกสาขา ไม่ต้องกำหนด)
db.exec(`
  CREATE TABLE IF NOT EXISTS staff_branches (
    staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    PRIMARY KEY (staff_id, branch_id)
  );
`);
if (!MIGRATED) {
  // พนักงานเดิมทุกคน → ดูแลสาขาหลัก
  db.prepare('INSERT OR IGNORE INTO staff_branches (staff_id, branch_id) SELECT id, ? FROM staff').run(MAIN_ID);
}

if (!MIGRATED) {
  // สำรองฐานข้อมูลก่อนปรับโครงสร้าง (ย้อนกลับได้)
  const hasData = (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n > 0;
  if (hasData) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const backup = resolve(dirname(DB_PATH), `pos-backup-before-branches-${stamp}.db`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    console.log(`[db] สำรองฐานข้อมูลก่อนแยกสาขา → ${backup}`);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of SCOPED) {
      db.exec(`ALTER TABLE ${t} RENAME TO ${t}_all`);
      db.exec(`ALTER TABLE ${t}_all ADD COLUMN branch_id INTEGER`);
      db.prepare(`UPDATE ${t}_all SET branch_id = ?`).run(MAIN_ID);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_branch ON ${t}_all(branch_id)`);
    }
    // เปิดกะได้ทีละ 1 กะ "ต่อสาขา"
    db.exec(`DROP INDEX IF EXISTS idx_one_open_shift;
             CREATE UNIQUE INDEX idx_one_open_shift ON shifts_all(branch_id) WHERE status = 'open';`);
    db.exec(`ALTER TABLE variants RENAME TO variants_all`);
    db.exec(`
      CREATE TABLE branch_stock (
        branch_id  INTEGER NOT NULL REFERENCES branches(id),
        variant_id INTEGER NOT NULL REFERENCES variants_all(id) ON DELETE CASCADE,
        stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        price      REAL,                 -- NULL = ใช้ราคาของสาขาหลัก
        PRIMARY KEY (branch_id, variant_id)
      );
    `);
    db.prepare('INSERT INTO branch_stock (branch_id, variant_id, stock) SELECT ?, id, stock FROM variants_all').run(MAIN_ID);
    // เลิกใช้ระบบเชื่อมสาขาแบบแยกเครื่อง (API key สิทธิ์ "เชื่อมสาขา")
    if (tableExists('api_keys')) db.exec("UPDATE api_keys SET revoked = 1 WHERE scope = 'sync'");
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log('[db] แยกข้อมูลตามสาขาแล้ว (ทุกสาขาใช้ฐานข้อมูลเดียว)');
}

// ---------- สต็อกติดลบได้ (ตั้งค่า → สต็อก → ขายได้แม้สต็อกหมด) ----------
// ตาราง branch_stock เดิมมี CHECK (stock >= 0) → สร้างตารางใหม่โดยไม่มีเงื่อนไขนี้ (ข้อมูลเดิมคงอยู่ครบ)
// การกันไม่ให้ติดลบตอนปิดสวิตช์ ทำที่โค้ดตอนขาย (UPDATE ... WHERE stock >= ?)
{
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'branch_stock'").get() as { sql: string } | undefined)?.sql ?? '';
  if (/CHECK\s*\(\s*stock\s*>=\s*0\s*\)/i.test(sql)) {
    if (DB_PATH !== ':memory:') {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      const backup = resolve(dirname(DB_PATH), `pos-backup-before-negative-stock-${stamp}.db`);
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      console.log(`[db] สำรองฐานข้อมูลก่อนปรับตารางสต็อก → ${backup}`);
    }
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE branch_stock_new (
          branch_id  INTEGER NOT NULL REFERENCES branches(id),
          variant_id INTEGER NOT NULL REFERENCES variants_all(id) ON DELETE CASCADE,
          stock      INTEGER NOT NULL DEFAULT 0,
          price      REAL,
          PRIMARY KEY (branch_id, variant_id)
        );
        INSERT INTO branch_stock_new (branch_id, variant_id, stock, price) SELECT branch_id, variant_id, stock, price FROM branch_stock;
        DROP TABLE branch_stock;
        ALTER TABLE branch_stock_new RENAME TO branch_stock;
      `);
      db.exec('COMMIT');
      console.log('[db] เปิดให้สต็อกติดลบได้ (ใช้เมื่อเปิด "ขายได้แม้สต็อกหมด")');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// ---------- สาขาปัจจุบันของ request (ตาราง temp → ไม่ถูกบันทึกลงไฟล์) ----------
db.exec(`
  CREATE TEMP TABLE IF NOT EXISTS ctx (k INTEGER PRIMARY KEY CHECK (k = 1), branch_id INTEGER NOT NULL, main_id INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0);
  DELETE FROM temp.ctx;
`);
db.prepare('INSERT INTO temp.ctx (k, branch_id, main_id) VALUES (1, ?, ?)').run(MAIN_ID, MAIN_ID);

const colsOf = (t: string) => (db.prepare(`PRAGMA main.table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const CTX = '(SELECT branch_id FROM temp.ctx)';

// ปิดกะ: ยอดจริงของช่องทางที่ไม่ใช่เงินสด (บัตร / QR / โอน) — JSON { method: { system, count, actual, diff } }
// ต้องเพิ่มก่อนสร้าง view ด้านล่าง (trigger UPDATE ของ view อ้างชื่อคอลัมน์ตอนสร้าง)
if (!colsOf('shifts_all').includes('tenders')) db.exec('ALTER TABLE shifts_all ADD COLUMN tenders TEXT');

// ภาษีมูลค่าเพิ่ม (ข้อกำหนดกรมสรรพากร) — เก็บค่าที่ใช้จริงในบิลแต่ละใบ (ดู tax.ts)
// vat_rate = อัตรา % ณ วันที่ออกบิล · vat_base = ฐานภาษี (มูลค่าก่อน VAT ของสินค้าที่เสีย VAT) · exempt_amount = มูลค่าสินค้ายกเว้น VAT
// terminal_id = เครื่อง POS ที่ออกบิล · voided_* = ผู้ทำรายการ / ผู้อนุมัติ / เวลา ยกเลิกบิล (บิลไม่ถูกลบ)
{
  const oc = colsOf('orders_all');
  const add = (c: string, def: string) => {
    if (!oc.includes(c)) db.exec(`ALTER TABLE orders_all ADD COLUMN ${c} ${def}`);
  };
  add('vat_rate', 'REAL');
  add('vat_base', 'REAL');
  add('exempt_amount', 'REAL NOT NULL DEFAULT 0');
  add('terminal_id', 'INTEGER');
  add('voided_at', 'TEXT');
  add('voided_by', 'TEXT');
  add('void_approver', 'TEXT');
  if (!oc.includes('vat_base')) {
    // บิลเดิม: อัตราคำนวณย้อนจากยอด VAT ที่บันทึกไว้ (ไม่มีสินค้ายกเว้น VAT)
    db.exec(`UPDATE orders_all SET
               vat_rate = CASE WHEN vat > 0 AND total - vat > 0 THEN ROUND(vat * 100.0 / (total - vat), 2) ELSE 0 END,
               vat_base = ROUND(total - vat, 2)
             WHERE vat_base IS NULL`);
    // บิลที่ยกเลิกไว้ก่อนหน้า: ดึงผู้ยกเลิก/เวลา จากประวัติการแก้ไข
    db.exec(`UPDATE orders_all SET
               voided_at = (SELECT e.edited_at FROM order_edits e WHERE e.order_id = orders_all.id AND e.kind = 'void' ORDER BY e.id DESC LIMIT 1),
               voided_by = (SELECT e.staff FROM order_edits e WHERE e.order_id = orders_all.id AND e.kind = 'void' ORDER BY e.id DESC LIMIT 1)
             WHERE status = 'void' AND voided_at IS NULL`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_terminal ON orders_all(terminal_id, id)');
  // สินค้าเสีย VAT / ยกเว้น VAT (+ snapshot ในรายการของบิล)
  if (!colsOf('products').includes('vat_exempt')) db.exec('ALTER TABLE products ADD COLUMN vat_exempt INTEGER NOT NULL DEFAULT 0');
  if (!colsOf('order_items').includes('vat_exempt')) db.exec('ALTER TABLE order_items ADD COLUMN vat_exempt INTEGER NOT NULL DEFAULT 0');
}

for (const t of SCOPED) {
  const cols = colsOf(`${t}_all`).filter((c) => c !== 'id' && c !== 'branch_id');
  db.exec(`
    DROP VIEW IF EXISTS temp.${t};
    CREATE TEMP VIEW ${t} AS SELECT * FROM main.${t}_all WHERE ${CTX} = 0 OR branch_id = ${CTX};
    CREATE TEMP TRIGGER ${t}_upd INSTEAD OF UPDATE ON ${t} BEGIN
      UPDATE ${t}_all SET ${cols.map((c) => `${c} = NEW.${c}`).join(', ')} WHERE id = OLD.id;
      UPDATE ctx SET n = n + 1;
    END;
    CREATE TEMP TRIGGER ${t}_del INSTEAD OF DELETE ON ${t} BEGIN
      DELETE FROM ${t}_all WHERE id = OLD.id;
      UPDATE ctx SET n = n + 1;
    END;
    -- เพิ่มข้อมูลใหม่ (INSERT INTO ${t}_all) → ติดสาขาปัจจุบันให้อัตโนมัติ
    CREATE TEMP TRIGGER ${t}_branch AFTER INSERT ON main.${t}_all WHEN NEW.branch_id IS NULL BEGIN
      UPDATE ${t}_all SET branch_id = COALESCE(NULLIF(${CTX}, 0), (SELECT main_id FROM temp.ctx)) WHERE id = NEW.id;
    END;
  `);
}

{
  const vcols = colsOf('variants_all');
  const keep = vcols.filter((c) => c !== 'stock' && c !== 'price');
  const shared = keep.filter((c) => c !== 'id');
  const priceChanged = `(c.branch_id <> c.main_id AND NEW.price IS NOT OLD.price)`;
  db.exec(`
    DROP VIEW IF EXISTS temp.variants;
    CREATE TEMP VIEW variants AS
      SELECT ${keep.map((c) => `v.${c}`).join(', ')},
        CASE WHEN c.branch_id = 0 THEN (SELECT COALESCE(SUM(x.stock), 0) FROM main.branch_stock x WHERE x.variant_id = v.id)
             ELSE COALESCE(bs.stock, 0) END AS stock,
        COALESCE(bs.price, v.price) AS price,
        v.price AS main_price,
        bs.price AS branch_price
      FROM main.variants_all v
      CROSS JOIN temp.ctx c
      LEFT JOIN main.branch_stock bs ON bs.variant_id = v.id AND bs.branch_id = c.branch_id;

    CREATE TEMP TRIGGER variants_upd INSTEAD OF UPDATE ON variants BEGIN
      SELECT RAISE(ABORT, 'กรุณาเลือกสาขาก่อนแก้สต็อก/ราคา') FROM temp.ctx c
        WHERE c.branch_id = 0 AND (NEW.stock IS NOT OLD.stock OR NEW.price IS NOT OLD.price);
      UPDATE variants_all SET ${shared.map((c) => `${c} = NEW.${c}`).join(', ')},
        price = CASE WHEN (SELECT branch_id = main_id FROM temp.ctx) THEN NEW.price ELSE price END
        WHERE id = OLD.id;
      INSERT INTO branch_stock (branch_id, variant_id, stock, price)
        SELECT c.branch_id, OLD.id, NEW.stock, CASE WHEN ${priceChanged} THEN NEW.price END
        FROM temp.ctx c
        WHERE c.branch_id <> 0 AND (NEW.stock IS NOT OLD.stock OR ${priceChanged})
        ON CONFLICT (branch_id, variant_id) DO UPDATE SET stock = excluded.stock, price = COALESCE(excluded.price, branch_stock.price);
      UPDATE ctx SET n = n + 1;
    END;
    CREATE TEMP TRIGGER variants_del INSTEAD OF DELETE ON variants BEGIN
      DELETE FROM variants_all WHERE id = OLD.id;
      UPDATE ctx SET n = n + 1;
    END;
  `);
}

const setCtx = db.prepare('UPDATE temp.ctx SET branch_id = ?');
const getCtx = db.prepare('SELECT branch_id AS b, n FROM temp.ctx');

/** id ของสาขาหลัก */
export const mainBranchId = () => MAIN_ID;
/** ตั้งสาขาปัจจุบัน (0 = ทุกสาขา — อ่านอย่างเดียว ใช้กับรายงานรวม) */
export function setBranch(id: number) {
  setCtx.run(id);
}
export function currentBranch(): number {
  return (getCtx.get() as { b: number }).b;
}
/** จำนวนแถวที่ถูกแก้ผ่าน view (changes ของ SQLite นับ INSTEAD OF trigger ไม่ได้) */
export function countChanges(fn: () => unknown): number {
  const before = (getCtx.get() as { n: number }).n;
  fn();
  return (getCtx.get() as { n: number }).n - before;
}
/** ใช้ข้อมูลของสาขาอื่นชั่วคราว (เช่น รายงานรวมทุกสาขา) */
export function withBranch<T>(id: number, fn: () => T): T {
  const prev = currentBranch();
  setBranch(id);
  try {
    return fn();
  } finally {
    setBranch(prev);
  }
}

/** Run fn inside a transaction; rolls back on any thrown error. */
let txDepth = 0;
/** transaction — เรียกซ้อนกันได้ (ชั้นในใช้ SAVEPOINT: ผิดพลาดแล้วย้อนเฉพาะชั้นนั้น) */
export function tx<T>(fn: () => T): T {
  const sp = txDepth > 0 ? `sp${txDepth}` : null;
  db.exec(sp ? `SAVEPOINT ${sp}` : 'BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.exec(sp ? `RELEASE ${sp}` : 'COMMIT');
    return result;
  } catch (err) {
    txDepth--;
    db.exec(sp ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    throw err;
  }
}
