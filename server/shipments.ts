// ส่งของจากโรงงาน (ใบส่งของ / DO): สแกนบาร์โค้ดใส่ใบส่ง → ส่งออก
// ตอนส่งออก: ตัดสต็อกจากสาขาที่เลือก (หรือไม่ตัด) และเพิ่มสต็อกให้สาขาปลายทาง
import { db, tx, withBranch } from './db.ts';
import { HttpError } from './common.ts';
import { getBranch, listBranches } from './branches.ts';
import { allowNegativeStock } from './settings.ts';
import { variantLabel } from './products.ts';
import type { Me } from './auth.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS shipments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_no         TEXT NOT NULL UNIQUE,              -- DO-2026-0001
    dest_branch_id INTEGER NOT NULL REFERENCES branches(id),
    -- สาขาที่ตัดสต็อกตอนส่ง (NULL = ไม่ตัดสต็อก เช่น ของผลิตใหม่จากโรงงาน)
    source_branch_id INTEGER REFERENCES branches(id),
    bags           INTEGER NOT NULL DEFAULT 1,
    note           TEXT,
    status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'shipped', 'cancelled')),
    created_by     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    shipped_by     TEXT,
    shipped_at     TEXT
  );
  CREATE TABLE IF NOT EXISTS shipment_items (
    shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    variant_id  INTEGER NOT NULL,
    qty         INTEGER NOT NULL CHECK (qty > 0),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (shipment_id, variant_id)
  );
`);
// พักใบส่งของ (Hold): ยังเป็น draft แต่ล็อกการสแกนไว้จนกว่าจะกด "ทำต่อ" — รายการที่สแกนแล้วอยู่ครบ
{
  const cols = (db.prepare('PRAGMA main.table_info(shipments)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('held_at')) db.exec('ALTER TABLE shipments ADD COLUMN held_at TEXT');
  if (!cols.includes('held_by')) db.exec('ALTER TABLE shipments ADD COLUMN held_by TEXT');
  // ยกเลิก: ใคร/เมื่อไร/เหตุผล — ใบที่ยกเลิกเก็บไว้ 3 วันแล้วลบถาวร
  if (!cols.includes('cancelled_at')) db.exec('ALTER TABLE shipments ADD COLUMN cancelled_at TEXT');
  if (!cols.includes('cancelled_by')) db.exec('ALTER TABLE shipments ADD COLUMN cancelled_by TEXT');
  if (!cols.includes('cancel_reason')) db.exec('ALTER TABLE shipments ADD COLUMN cancel_reason TEXT');
  // ใบที่ยกเลิกไว้ก่อนมีระบบนี้ → เริ่มนับ 3 วันจากตอนนี้
  db.exec("UPDATE shipments SET cancelled_at = datetime('now', 'localtime') WHERE status = 'cancelled' AND cancelled_at IS NULL");
  // เลขที่ใบส่งของต่อเนื่อง (ไม่ใช้เลขซ้ำแม้ใบที่ยกเลิกถูกลบไปแล้ว)
  db.exec('CREATE TABLE IF NOT EXISTS shipment_seq (year INTEGER PRIMARY KEY, n INTEGER NOT NULL)');
  db.exec(`INSERT OR IGNORE INTO shipment_seq (year, n)
           SELECT CAST(substr(doc_no, 4, 4) AS INTEGER), MAX(CAST(substr(doc_no, 9) AS INTEGER)) FROM shipments GROUP BY substr(doc_no, 4, 4)`);
}
/** เก็บใบที่ยกเลิกไว้กี่วันก่อนลบถาวร */
export const CANCEL_KEEP_DAYS = 3;

interface Row {
  id: number; docNo: string; destBranchId: number; sourceBranchId: number | null; bags: number; note: string | null;
  status: 'draft' | 'shipped' | 'cancelled'; createdBy: string | null; createdAt: string; shippedBy: string | null; shippedAt: string | null;
  heldAt: string | null; heldBy: string | null; units: number; lines: number;
  cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null; purgeAt: string | null;
}

const COLS = `s.id, s.doc_no AS docNo, s.dest_branch_id AS destBranchId, s.source_branch_id AS sourceBranchId, s.bags, s.note, s.status,
  s.created_by AS createdBy, s.created_at AS createdAt, s.shipped_by AS shippedBy, s.shipped_at AS shippedAt,
  s.held_at AS heldAt, s.held_by AS heldBy,
  s.cancelled_at AS cancelledAt, s.cancelled_by AS cancelledBy, s.cancel_reason AS cancelReason,
  CASE WHEN s.status = 'cancelled' THEN datetime(s.cancelled_at, '+3 days') END AS purgeAt,
  COALESCE((SELECT SUM(qty) FROM shipment_items i WHERE i.shipment_id = s.id), 0) AS units,
  (SELECT COUNT(*) FROM shipment_items i WHERE i.shipment_id = s.id) AS lines`;

const q = {
  list: db.prepare(`SELECT ${COLS} FROM shipments s WHERE s.status <> 'cancelled' ORDER BY s.id DESC LIMIT 200`),
  listCancelled: db.prepare(`SELECT ${COLS} FROM shipments s WHERE s.status = 'cancelled' ORDER BY s.cancelled_at DESC LIMIT 200`),
  one: db.prepare(`SELECT ${COLS} FROM shipments s WHERE s.id = ?`),
  nextSeq: db.prepare('INSERT INTO shipment_seq (year, n) VALUES (?, 1) ON CONFLICT (year) DO UPDATE SET n = n + 1 RETURNING n'),
  insert: db.prepare('INSERT INTO shipments (doc_no, dest_branch_id, source_branch_id, bags, note, created_by) VALUES (?, ?, ?, ?, ?, ?)'),
  update: db.prepare('UPDATE shipments SET dest_branch_id = ?, source_branch_id = ?, bags = ?, note = ? WHERE id = ?'),
  // เรียงตามลำดับที่สแกนเข้ามา (rowid) — ของใหม่อยู่บนสุด
  // ห้ามเรียงด้วย updated_at: กดเพิ่ม/ลดจำนวนแล้วแถวจะเด้งไปอยู่บนสุด ทำให้สับสน
  items: db.prepare(
    `SELECT i.variant_id AS variantId, i.qty, v.sku, v.barcode, v.size, v.color, v.extra, p.name, p.id AS productId, p.sku AS productSku
       FROM shipment_items i
       JOIN main.variants_all v ON v.id = i.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE i.shipment_id = ? ORDER BY i.rowid DESC`,
  ),
  find: db.prepare(
    `SELECT v.id, v.sku, v.size, v.color, v.extra, p.name
       FROM main.variants_all v JOIN products p ON p.id = v.product_id
      WHERE instr(v.extra, char(1)) = 0 AND (UPPER(v.barcode) = UPPER(?) OR UPPER(v.sku) = UPPER(?))
      ORDER BY (UPPER(v.barcode) = UPPER(?)) DESC LIMIT 1`,
  ),
  itemQty: db.prepare('SELECT qty FROM shipment_items WHERE shipment_id = ? AND variant_id = ?'),
  upsert: db.prepare(
    `INSERT INTO shipment_items (shipment_id, variant_id, qty) VALUES (?, ?, ?)
     ON CONFLICT (shipment_id, variant_id) DO UPDATE SET qty = excluded.qty, updated_at = datetime('now', 'localtime')`,
  ),
  delItem: db.prepare('DELETE FROM shipment_items WHERE shipment_id = ? AND variant_id = ?'),
  stockOf: db.prepare('SELECT stock FROM variants WHERE id = ?'),
  addStock: db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?'),
  insMove: db.prepare('INSERT INTO stock_moves_all (variant_id, delta, balance, reason, staff) VALUES (?, ?, ?, ?, ?)'),
  ship: db.prepare("UPDATE shipments SET status = 'shipped', shipped_by = ?, shipped_at = datetime('now', 'localtime') WHERE id = ? AND status = 'draft'"),
  cancel: db.prepare(
    "UPDATE shipments SET status = 'cancelled', cancelled_at = datetime('now', 'localtime'), cancelled_by = ?, cancel_reason = ?, held_at = NULL, held_by = NULL WHERE id = ? AND status = 'draft'",
  ),
  restore: db.prepare(
    "UPDATE shipments SET status = 'draft', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL WHERE id = ? AND status = 'cancelled' AND shipped_at IS NULL",
  ),
  purgeIds: db.prepare(`SELECT id FROM shipments WHERE status = 'cancelled' AND cancelled_at <= datetime('now', 'localtime', '-${3} days')`.replace('${3}', '3')),
  purgeItems: db.prepare('DELETE FROM shipment_items WHERE shipment_id = ?'),
  purgeOne: db.prepare("DELETE FROM shipments WHERE id = ? AND status = 'cancelled'"),
  delShipped: db.prepare("DELETE FROM shipments WHERE id = ? AND status = 'shipped'"),
  hold: db.prepare("UPDATE shipments SET held_at = datetime('now', 'localtime'), held_by = ? WHERE id = ? AND status = 'draft'"),
  resume: db.prepare("UPDATE shipments SET held_at = NULL, held_by = NULL WHERE id = ? AND status = 'draft'"),
};

const branchName = (id: number | null) => (id ? getBranch(id)?.name ?? `สาขา #${id}` : null);
const present = (r: Row) => ({ ...r, destBranchName: branchName(r.destBranchId), sourceBranchName: branchName(r.sourceBranchId) });

function row(id: number) {
  const r = q.one.get(id) as Row | undefined;
  if (!r) throw new HttpError(404, 'ไม่พบใบส่งของ');
  return r;
}
/** ใบที่ยังแก้ได้ (ยังไม่ส่ง) · active = ต้องไม่ได้พักไว้ด้วย */
function draft(id: number, active = true) {
  const r = row(id);
  if (r.status === 'cancelled') throw new HttpError(409, `${r.docNo} ถูกยกเลิกแล้ว — กู้คืนเป็นฉบับร่างก่อนจึงแก้ไขได้`);
  if (r.status !== 'draft') throw new HttpError(409, 'ใบส่งของนี้ส่งออกแล้ว รายการถูกล็อก');
  if (active && r.heldAt) throw new HttpError(409, `${r.docNo} ถูกพักไว้ — กด "ทำต่อ" ก่อนสแกน/แก้ไข`);
  return r;
}

/** พักใบส่งของไว้ (เช่น พักเที่ยง) — รายการที่สแกนแล้วอยู่ครบ */
export function holdShipment(id: number, me: Me) {
  draft(id, false);
  q.hold.run(me.name, id);
  return shipmentDetail(id);
}
/** ทำต่อจากที่พักไว้ */
export function resumeShipment(id: number) {
  draft(id, false);
  q.resume.run(id);
  return shipmentDetail(id);
}
function branchId(v: unknown, label: string, allowNull: boolean): number | null {
  if (allowNull && (v === null || v === undefined || v === '' || v === 0)) return null;
  const id = Number(v);
  if (!Number.isInteger(id) || !getBranch(id)) throw new HttpError(422, `กรุณาเลือก${label}`);
  return id;
}

/** รายการใบส่งของ + สาขาทั้งหมด (ใช้เลือกปลายทาง / สาขาที่ตัดสต็อก) */
export function listShipments() {
  return {
    list: (q.list.all() as Row[]).map(present),
    cancelled: (q.listCancelled.all() as Row[]).map(present),
    keepDays: CANCEL_KEEP_DAYS,
    branches: listBranches().map((b) => ({ id: b.id, name: b.name, code: b.code, isMain: b.isMain })),
  };
}

export function shipmentDetail(id: number) {
  const r = row(id);
  const items = (q.items.all(id) as { variantId: number; qty: number; sku: string; barcode: string | null; size: string; color: string; extra: string; name: string; productId: number; productSku: string }[])
    .map((i) => ({ ...i, label: variantLabel(i) }));
  // สต็อกปัจจุบันของสาขาที่จะตัด (ไว้เตือนก่อนส่ง)
  const sourceStock = r.sourceBranchId
    ? withBranch(r.sourceBranchId, () => Object.fromEntries(items.map((i) => [i.variantId, (q.stockOf.get(i.variantId) as { stock: number } | undefined)?.stock ?? 0])))
    : null;
  return { shipment: present(r), items, sourceStock };
}

export function createShipment(body: { destBranchId?: unknown; sourceBranchId?: unknown; bags?: unknown; note?: string }, me: Me) {
  const dest = branchId(body.destBranchId, 'สาขาปลายทาง', false)!;
  const source = branchId(body.sourceBranchId, 'สาขาที่ตัดสต็อก', true);
  if (source === dest) throw new HttpError(422, 'สาขาที่ตัดสต็อกต้องไม่ใช่สาขาปลายทาง');
  const bags = Math.max(1, Math.min(999, Math.floor(Number(body.bags) || 1)));
  const id = tx(() => {
    const year = new Date().getFullYear();
    const { n: seq } = q.nextSeq.get(year) as { n: number };
    const n = seq - 1;
    const docNo = `DO-${year}-${String(n + 1).padStart(4, '0')}`;
    return Number(q.insert.run(docNo, dest, source, bags, body.note?.trim().slice(0, 300) || null, me.name).lastInsertRowid);
  });
  return shipmentDetail(id);
}

export function updateShipment(id: number, body: { destBranchId?: unknown; sourceBranchId?: unknown; bags?: unknown; note?: string }) {
  const r = draft(id);
  const dest = body.destBranchId !== undefined ? branchId(body.destBranchId, 'สาขาปลายทาง', false)! : r.destBranchId;
  const source = body.sourceBranchId !== undefined ? branchId(body.sourceBranchId, 'สาขาที่ตัดสต็อก', true) : r.sourceBranchId;
  if (source === dest) throw new HttpError(422, 'สาขาที่ตัดสต็อกต้องไม่ใช่สาขาปลายทาง');
  const bags = body.bags !== undefined ? Math.max(1, Math.min(999, Math.floor(Number(body.bags) || 1))) : r.bags;
  const note = body.note !== undefined ? body.note.trim().slice(0, 300) || null : r.note;
  q.update.run(dest, source, bags, note, id);
  return shipmentDetail(id);
}

/** สแกน 1 ครั้ง = เพิ่มตามจำนวนที่เลือก (ติดลบ = ลด) */
export function scanShipment(id: number, body: { code?: string; qty?: unknown }) {
  draft(id);
  const code = String(body.code ?? '').trim();
  if (!code) throw new HttpError(422, 'กรุณาสแกนหรือพิมพ์บาร์โค้ด');
  const add = Math.floor(Number(body.qty ?? 1));
  if (!Number.isFinite(add) || add === 0 || Math.abs(add) > 9999) throw new HttpError(422, 'จำนวนไม่ถูกต้อง');
  const v = q.find.get(code, code, code) as { id: number; sku: string; size: string; color: string; extra: string; name: string } | undefined;
  if (!v) throw new HttpError(404, `ไม่พบบาร์โค้ด/รหัส SKU "${code}"`);
  const cur = (q.itemQty.get(id, v.id) as { qty: number } | undefined)?.qty ?? 0;
  const next = Math.min(99999, cur + add);
  if (next <= 0) q.delItem.run(id, v.id);
  else q.upsert.run(id, v.id, next);
  return { ...shipmentDetail(id), scanned: { variantId: v.id, name: v.name, label: variantLabel(v), sku: v.sku, qty: Math.max(0, next), added: add } };
}

/** แก้จำนวนของรายการ (0 = ลบ) */
export function setShipmentItem(id: number, variantId: number, body: { qty?: unknown }) {
  draft(id);
  const qty = Math.floor(Number(body.qty));
  if (!Number.isFinite(qty) || qty < 0 || qty > 99999) throw new HttpError(422, 'จำนวนไม่ถูกต้อง');
  if (qty === 0) q.delItem.run(id, variantId);
  else q.upsert.run(id, variantId, qty);
  return shipmentDetail(id);
}

/**
 * ส่งออก: ล็อกใบส่งของ · ตัดสต็อกสาขาต้นทาง (ถ้าเลือก) · เพิ่มสต็อกสาขาปลายทาง
 * ทำทั้งหมดใน transaction เดียว — ถ้าสต็อกต้นทางไม่พอ (และไม่ได้เปิด "ขายได้แม้สต็อกหมด") จะไม่บันทึกอะไรเลย
 */
export function shipShipment(id: number, me: Me) {
  const r = draft(id);
  const items = q.items.all(id) as { variantId: number; qty: number; name: string; size: string; color: string; extra: string }[];
  if (!items.length) throw new HttpError(422, 'ยังไม่มีสินค้าในใบส่งของ');
  if (!getBranch(r.destBranchId)) throw new HttpError(422, 'ไม่พบสาขาปลายทาง');
  if (r.sourceBranchId && !getBranch(r.sourceBranchId)) throw new HttpError(422, 'ไม่พบสาขาที่ตัดสต็อก');
  const allowNeg = allowNegativeStock();
  tx(() => {
    if (r.sourceBranchId) {
      withBranch(r.sourceBranchId, () => {
        for (const it of items) {
          const cur = (q.stockOf.get(it.variantId) as { stock: number } | undefined)?.stock ?? 0;
          if (cur < it.qty && !allowNeg) {
            throw new HttpError(409, `${it.name} (${variantLabel(it)}) ที่${branchName(r.sourceBranchId)} มีแค่ ${cur} ชิ้น (ส่ง ${it.qty})`);
          }
          q.addStock.run(-it.qty, it.variantId);
          q.insMove.run(it.variantId, -it.qty, cur - it.qty, `ส่งของ ${r.docNo} → ${branchName(r.destBranchId)}`, me.name);
        }
      });
    }
    withBranch(r.destBranchId, () => {
      for (const it of items) {
        const cur = (q.stockOf.get(it.variantId) as { stock: number } | undefined)?.stock ?? 0;
        q.addStock.run(it.qty, it.variantId);
        q.insMove.run(it.variantId, it.qty, cur + it.qty, `รับของ ${r.docNo}${r.sourceBranchId ? ` จาก${branchName(r.sourceBranchId)}` : ' จากโรงงาน'}`, me.name);
      }
    });
    if (q.ship.run(me.name, id).changes !== 1) throw new HttpError(409, 'ใบส่งของนี้ส่งออกไปแล้ว');
  });
  return shipmentDetail(id);
}

/** ยกเลิกใบส่งของที่ยังไม่ส่ง (ไม่กระทบสต็อก) — เก็บไว้ 3 วันให้กู้คืนได้ แล้วลบถาวร */
export function cancelShipment(id: number, body: { reason?: string }, me: Me) {
  const r = row(id);
  if (r.status === 'shipped') throw new HttpError(409, `${r.docNo} ส่งออกแล้ว ยกเลิกไม่ได้`);
  if (r.status === 'cancelled') throw new HttpError(409, `${r.docNo} ถูกยกเลิกไปแล้ว`);
  const reason = String(body?.reason ?? '').trim().slice(0, 200);
  if (!reason) throw new HttpError(422, 'กรุณาระบุเหตุผลที่ยกเลิก');
  if (q.cancel.run(me.name, reason, id).changes !== 1) throw new HttpError(409, 'ยกเลิกไม่สำเร็จ ลองโหลดหน้าใหม่');
  return listShipments();
}

/**
 * ลบใบส่งของที่ส่งออกแล้วออกถาวร พร้อมคืนสต็อกกลับที่เดิม
 * - ดึงของออกจากสาขาปลายทาง (เท่าที่ส่งไป) และคืนเข้าสาขาต้นทาง (ถ้าตอนส่งมีการตัดสต็อก)
 * - ถ้าปลายทางขายของไปแล้วจนไม่พอคืน จะไม่ยอมลบ (กันสต็อกติดลบ) เว้นแต่ร้านอนุญาตสต็อกติดลบ
 * - บันทึกความเคลื่อนไหวสต็อกไว้ทั้งสองฝั่ง เพื่อให้ตรวจย้อนหลังได้ว่าของหายไปไหน
 */
export function deleteShippedShipment(id: number, me: Me) {
  const r = row(id);
  if (r.status !== 'shipped') throw new HttpError(409, `${r.docNo} ยังไม่ได้ส่งออก — ใช้ปุ่มยกเลิกในหน้าส่งของแทน`);
  const items = q.items.all(id) as { variantId: number; qty: number; name: string; size: string; color: string; extra: string }[];
  const allowNeg = allowNegativeStock();
  const docNo = r.docNo;
  tx(() => {
    // คืนของออกจากปลายทางก่อน — ถ้าของถูกขายไปแล้วจะไม่พอ ต้องหยุดตั้งแต่ตรงนี้
    withBranch(r.destBranchId, () => {
      for (const it of items) {
        const cur = (q.stockOf.get(it.variantId) as { stock: number } | undefined)?.stock ?? 0;
        if (cur < it.qty && !allowNeg) {
          throw new HttpError(
            409,
            `${it.name} (${variantLabel(it)}) ที่${branchName(r.destBranchId)} เหลือ ${cur} ชิ้น แต่ใบนี้ส่งไป ${it.qty} ชิ้น — ของถูกขาย/ย้ายไปแล้ว ลบใบนี้ไม่ได้`,
          );
        }
        q.addStock.run(-it.qty, it.variantId);
        q.insMove.run(it.variantId, -it.qty, cur - it.qty, `ลบใบส่งของ ${docNo} (คืนของกลับ)`, me.name);
      }
    });
    if (r.sourceBranchId) {
      withBranch(r.sourceBranchId, () => {
        for (const it of items) {
          const cur = (q.stockOf.get(it.variantId) as { stock: number } | undefined)?.stock ?? 0;
          q.addStock.run(it.qty, it.variantId);
          q.insMove.run(it.variantId, it.qty, cur + it.qty, `ลบใบส่งของ ${docNo} (รับของคืน)`, me.name);
        }
      });
    }
    q.purgeItems.run(id);
    if (q.delShipped.run(id).changes !== 1) throw new HttpError(409, 'ลบไม่สำเร็จ ลองโหลดหน้าใหม่');
  });
  console.log(`[shipments] ลบใบส่งของ ${docNo} ถาวร และคืนสต็อกแล้ว โดย ${me.name}`);
  return { ok: true as const, docNo, items: items.length };
}

/** กู้คืนใบที่ยกเลิก → กลับเป็นฉบับร่าง (เฉพาะใบที่ยังไม่เคยส่งออก) */
export function restoreShipment(id: number) {
  const r = row(id);
  if (r.status !== 'cancelled') throw new HttpError(409, `${r.docNo} ไม่ได้อยู่ในสถานะยกเลิก`);
  if (q.restore.run(id).changes !== 1) throw new HttpError(409, 'กู้คืนไม่ได้ — ใบนี้เคยส่งออกแล้ว');
  return shipmentDetail(id);
}

/** ลบใบที่ยกเลิกครบ 3 วันออกจากฐานข้อมูลถาวร (รายการสินค้าในใบลบด้วย) */
export function purgeCancelledShipments() {
  const ids = (q.purgeIds.all() as { id: number }[]).map((x) => x.id);
  if (!ids.length) return 0;
  tx(() => {
    for (const id of ids) {
      q.purgeItems.run(id);
      q.purgeOne.run(id);
    }
  });
  console.log(`[shipments] ลบใบส่งของที่ยกเลิกครบ ${CANCEL_KEEP_DAYS} วันแล้ว ${ids.length} ใบ`);
  return ids.length;
}
// ตรวจตอนเปิดเซิร์ฟเวอร์ และทุก 1 ชั่วโมง
purgeCancelledShipments();
setInterval(() => {
  try {
    purgeCancelledShipments();
  } catch (e) {
    console.error('[shipments] purge failed', e);
  }
}, 60 * 60 * 1000).unref();
