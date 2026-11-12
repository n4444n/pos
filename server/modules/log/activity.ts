// กิจกรรมของร้านสำหรับแอปมือถือ (หน้ากระดิ่ง) — GET /api/activity?since=<id>
// - คัดจาก LOG (audit_log) เฉพาะเรื่องที่เจ้าของร้านควรรู้ แล้วเติมยอดเงิน / จำนวนชิ้นจากเอกสารจริง
// - ส่งเฉพาะข้อความที่สรุปแล้ว — ไม่ส่ง detail ดิบ, IP, PIN หรือข้อมูลลับ
// - สิทธิ์ตามเมนู (ไม่จำกัดเฉพาะผู้ดูแลระบบแบบหน้า LOG) + เฉพาะสาขาที่ผู้ใช้เข้าได้
// - อ่านจากตาราง *_all โดยตรง → ไม่เปลี่ยนสาขาของ session
// สัญญา API: dashboard-mobile-pos/ACTIVITY_API.md · หน้า LOG เดิม (auditLog.ts) ไม่เปลี่ยน
// ไฟล์นี้เตรียมคำสั่ง SQL ตั้งแต่ตอนโหลด จึงต้องให้ไฟล์ที่ "สร้างตาราง" โหลดก่อน
// (เดิมอาศัยลำดับ import ใน index.ts ซึ่งมองไม่เห็น — ตอนนี้ประกาศให้ชัด)
import './auditLog.ts'; // audit_log
import '../tax/taxDocs.ts'; // credit_notes
import '../shipping/shipments.ts'; // shipments · shipment_items
import { db } from '../../core/db.ts';
import { round2 } from '../../core/common.ts';
import { expenseCategories } from '../expense/expenses.ts';
import { ROLE_LABEL, type Feature } from '../../core/perms.ts';
import type { Me } from '../../core/auth.ts';

export type Topic = 'sale_high' | 'stock_adjust' | 'security';
const TOPICS: Topic[] = ['sale_high', 'stock_adjust', 'security'];
type Level = 'info' | 'warn' | 'bad';
type RefKind = 'order' | 'shipment' | 'expense' | 'shift' | 'stock' | 'report';

export interface ActivityItem {
  id: number;
  at: string;
  type: string;
  topic: Topic | null;
  level: Level;
  branchId: number | null;
  branchName: string | null;
  staff: string | null;
  title: string;
  detail: string | null;
  amount: number | null;
  units: number | null;
  ref: { kind: RefKind; id?: number | null; no?: string | null; branchId?: number | null } | null;
}

interface LogRow { id: number; at: string; staff: string | null; role: string | null; branchId: number | null; method: string; path: string; ref: string | null; detail: string | null }

// ---------------------------------------------------------------- ชนิดกิจกรรม ← method + path ใน LOG
type Kind = { type: string; topic?: Topic; need: (me: Me) => boolean };
const view = (me: Me, f: Feature) => (me.perms[f] ?? 'none') !== 'none';
const sales = (me: Me) => view(me, 'history') || view(me, 'reports');
const adminOnly = (me: Me & { keyId?: number }) => !me.keyId && me.role === 'admin';
const KINDS: [method: string, re: RegExp, kind: Kind][] = [
  ['POST', /^\/api\/orders$/, { type: 'order.high', topic: 'sale_high', need: sales }],
  ['POST', /^\/api\/orders\/(\d+)\/void$/, { type: 'order.voided', need: sales }],
  ['PUT', /^\/api\/orders\/(\d+)$/, { type: 'order.edited', need: sales }],
  ['POST', /^\/api\/orders\/(\d+)\/credit-note$/, { type: 'order.refunded', need: sales }],
  ['POST', /^\/api\/shifts\/open$/, { type: 'shift.opened', need: (me) => view(me, 'shifts') }],
  ['POST', /^\/api\/shifts\/current\/close$/, { type: 'shift.closed', need: (me) => view(me, 'shifts') }],
  ['POST', /^\/api\/shifts\/current\/cash$/, { type: 'cash.moved', need: (me) => view(me, 'shifts') }],
  ['POST', /^\/api\/expenses$/, { type: 'expense.created', need: (me) => view(me, 'expenses') }],
  ['POST', /^\/api\/expenses\/(\d+)\/void$/, { type: 'expense.voided', need: (me) => view(me, 'expenses') }],
  ['POST', /^\/api\/shipments\/(\d+)\/ship$/, { type: 'shipment.shipped', need: (me) => view(me, 'shipments') }],
  ['POST', /^\/api\/shipments\/(\d+)\/adjust$/, { type: 'shipment.adjusted', need: (me) => view(me, 'shipments') }],
  ['POST', /^\/api\/shipments\/(\d+)\/cancel$/, { type: 'shipment.cancelled', need: (me) => view(me, 'shipments') }],
  ['POST', /^\/api\/stock\/command$/, { type: 'stock.adjusted', topic: 'stock_adjust', need: (me) => view(me, 'stock') }],
  ['POST', /^\/api\/backup\/restore$/, { type: 'security.backup_restored', topic: 'security', need: adminOnly }],
  ['*', /^\/api\/perms\/([a-z]+)(\/reset)?$/, { type: 'security.perms_changed', topic: 'security', need: adminOnly }],
  ['*', /^\/api\/staff(?:\/(\d+))?$/, { type: 'security.staff_changed', topic: 'security', need: adminOnly }],
];
function kindOf(method: string, path: string): { kind: Kind; m: RegExpExecArray } | null {
  for (const [meth, re, kind] of KINDS) {
    if (meth !== '*' && meth !== method) continue;
    if (method === 'GET') continue;
    const m = re.exec(path);
    if (m) return { kind, m };
  }
  return null;
}
// ตัดแถวที่ไม่เกี่ยวออกตั้งแต่ใน SQL (เร็ว) แล้วค่อยแยกชนิดด้วย regex
const PATH_SQL = `l.status < 400 AND l.method <> 'GET' AND (
  l.path LIKE '/api/orders%' OR l.path LIKE '/api/shifts/%' OR l.path LIKE '/api/expenses%' OR l.path LIKE '/api/shipments/%'
  OR l.path = '/api/stock/command' OR l.path = '/api/backup/restore' OR l.path LIKE '/api/perms/%' OR l.path LIKE '/api/staff%')`;

// ---------------------------------------------------------------- ข้อมูลประกอบ (เติมยอดเงิน / จำนวนชิ้น)
const q = {
  maxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM audit_log'),
  branches: db.prepare('SELECT id, name FROM branches'),
  orderByNo: db.prepare(`SELECT o.id, o.order_no AS no, o.total, o.branch_id AS branchId, o.payment_method AS method,
      (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id) AS units
    FROM orders_all o WHERE o.order_no = ?`),
  orderById: db.prepare(`SELECT o.id, o.order_no AS no, o.total, o.branch_id AS branchId, o.void_reason AS voidReason,
      (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id) AS units
    FROM orders_all o WHERE o.id = ?`),
  edit: db.prepare(`SELECT diff, new_total AS total, reason FROM order_edits
    WHERE order_id = ? AND kind = 'edit' AND edited_at <= ? ORDER BY id DESC LIMIT 1`),
  creditNote: db.prepare(`SELECT doc_no AS no, total, reason FROM credit_notes
    WHERE order_id = ? AND issued_at <= ? ORDER BY id DESC LIMIT 1`),
  shiftOpened: db.prepare(`SELECT id, shift_no AS no, opening_cash AS cash FROM shifts_all
    WHERE branch_id = ? AND opened_at <= ? ORDER BY id DESC LIMIT 1`),
  shiftClosed: db.prepare(`SELECT id, shift_no AS no, diff, total_sales AS sales, bill_count AS bills FROM shifts_all
    WHERE branch_id = ? AND status = 'closed' AND closed_at <= ? ORDER BY closed_at DESC, id DESC LIMIT 1`),
  cash: db.prepare(`SELECT kind, amount, reason FROM cash_movements_all
    WHERE branch_id = ? AND created_at <= ? ORDER BY id DESC LIMIT 1`),
  expenseNew: db.prepare(`SELECT id, amount, category, description, vendor FROM expenses
    WHERE branch_id = $b AND ($who IS NULL OR staff = $who) AND created_at <= $at ORDER BY id DESC LIMIT 1`),
  expense: db.prepare('SELECT id, amount, category, description, void_reason AS reason FROM expenses WHERE id = ?'),
  expenseCats: db.prepare('SELECT DISTINCT category FROM expense_items WHERE expense_id = ?'),
  shipment: db.prepare(`SELECT s.id, s.doc_no AS no, s.source_branch_id AS src, s.dest_branch_id AS dest, s.bags, s.cancel_reason AS reason,
      (SELECT COALESCE(SUM(qty), 0) FROM shipment_items i WHERE i.shipment_id = s.id) AS units
    FROM shipments s WHERE s.id = ?`),
  stockMoves: db.prepare(`SELECT COUNT(DISTINCT variant_id) AS skus, COALESCE(SUM(delta), 0) AS delta, COALESCE(SUM(ABS(delta)), 0) AS moved
    FROM stock_moves_all WHERE branch_id = $b AND reason LIKE 'คำสั่ง:%' AND ($who IS NULL OR IFNULL(staff, '') = $who)
      AND created_at BETWEEN datetime($at, '-60 seconds') AND $at`),
  staffName: db.prepare('SELECT name FROM staff WHERE id = ?'),
};

const baht = (n: number) => `฿${round2(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(round2(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const n0 = (n: number) => Math.round(n).toLocaleString('en-US');
const PAY: Record<string, string> = { cash: 'เงินสด', promptpay: 'QR พร้อมเพย์', card: 'บัตร', transfer: 'โอน', beam: 'เครื่องรับบัตร' };
const short = (s: unknown, max = 80) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t ? (t.length > max ? `${t.slice(0, max)}…` : t) : null;
};
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ') || null;

/** ข้อมูลที่ส่งมากับคำขอ (อ่านในเซิร์ฟเวอร์เท่านั้น — ไม่ส่งออก) */
function bodyOf(r: LogRow): Record<string, unknown> {
  if (!r.detail) return {};
  try {
    const d = JSON.parse(r.detail) as { data?: unknown };
    return d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? (d.data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface Opts { minSale: number; branchName: (id: number | null) => string | null; catName: (id: string) => string }
type Built = Omit<ActivityItem, 'id' | 'at' | 'type' | 'topic' | 'branchName' | 'staff'> & { branches?: (number | null)[] };

/** แปลงแถว LOG 1 แถวเป็นข้อความสรุป · null = ไม่แจ้ง */
function build(type: string, m: RegExpExecArray, r: LogRow, o: Opts): Built | null {
  const id = m[1] ? Number(m[1]) : null;
  // ผู้ทำรายการ (API key บันทึกชื่อใน LOG ต่างจากในเอกสาร → ไม่เทียบชื่อ)
  const who = r.role === 'api' ? null : r.staff ?? '';
  const base = { level: 'info' as Level, branchId: r.branchId, detail: null, amount: null, units: null, ref: null };
  switch (type) {
    case 'order.high': {
      const ord = r.ref ? (q.orderByNo.get(r.ref) as { id: number; no: string; total: number; branchId: number; method: string; units: number } | undefined) : undefined;
      if (!ord || ord.total < o.minSale) return null;
      return {
        ...base, branchId: ord.branchId,
        title: `ขาย ${baht(ord.total)} · บิล ${ord.no}`,
        detail: join(`${n0(ord.units)} ชิ้น`, PAY[ord.method] ?? ord.method),
        amount: ord.total, units: ord.units, ref: { kind: 'order', id: ord.id, no: ord.no, branchId: ord.branchId },
      };
    }
    case 'order.voided':
    case 'order.edited':
    case 'order.refunded': {
      if (type === 'order.edited' && bodyOf(r).dryRun) return null; // ดูตัวอย่างการแก้บิล (ยังไม่บันทึก)
      const ord = q.orderById.get(id) as { id: number; no: string; total: number; branchId: number; voidReason: string | null; units: number } | undefined;
      const no = ord?.no ?? r.ref;
      const ref = { kind: 'order' as const, id, no, branchId: ord?.branchId ?? r.branchId };
      const branchId = ord?.branchId ?? r.branchId;
      if (type === 'order.voided') {
        return {
          ...base, level: 'bad', branchId, ref,
          title: `ยกเลิกบิล ${no ?? ''}${ord ? ` · ${baht(ord.total)}` : ''}`.trim(),
          detail: join(short(ord?.voidReason) && `เหตุผล: ${short(ord?.voidReason)}`, ord && `${n0(ord.units)} ชิ้น`),
          amount: ord?.total ?? null, units: ord?.units ?? null,
        };
      }
      if (type === 'order.edited') {
        const e = q.edit.get(id, r.at) as { diff: number; total: number; reason: string } | undefined;
        const d = e ? round2(e.diff) : 0;
        return {
          ...base, level: 'warn', branchId, ref,
          title: `แก้ไขบิล ${no ?? ''}`.trim(),
          detail: join(!e ? null : d > 0 ? `เก็บเพิ่ม ${baht(d)}` : d < 0 ? `คืนเงิน ${baht(-d)}` : 'ยอดเท่าเดิม', e && `ยอดใหม่ ${baht(e.total)}`, short(e?.reason) && `เหตุผล: ${short(e?.reason)}`),
          amount: e ? d : null,
        };
      }
      const cn = q.creditNote.get(id, r.at) as { no: string; total: number; reason: string } | undefined;
      return {
        ...base, branchId, ref,
        title: cn ? `คืนเงิน ${baht(cn.total)} · บิล ${no ?? ''}`.trim() : `คืนเงิน · บิล ${no ?? ''}`.trim(),
        detail: join(cn && `ใบลดหนี้ ${cn.no}`, short(cn?.reason) && `เหตุผล: ${short(cn?.reason)}`),
        amount: cn?.total ?? null,
      };
    }
    case 'shift.opened': {
      const s = r.branchId ? (q.shiftOpened.get(r.branchId, r.at) as { id: number; no: number; cash: number } | undefined) : undefined;
      return {
        ...base, title: `เปิดกะ${s ? ` #${s.no}` : ''}`, detail: s ? `เงินทอนตั้งต้น ${baht(s.cash)}` : null,
        amount: s?.cash ?? null, ref: { kind: 'shift', id: s?.id ?? null, branchId: r.branchId },
      };
    }
    case 'shift.closed': {
      const s = r.branchId ? (q.shiftClosed.get(r.branchId, r.at) as { id: number; no: number; diff: number | null; sales: number | null; bills: number | null } | undefined) : undefined;
      const diff = round2(s?.diff ?? 0);
      return {
        ...base, level: Math.abs(diff) >= 0.01 ? 'bad' : 'info',
        title: `ปิดกะ${s ? ` #${s.no}` : ''}${s?.sales != null ? ` · ยอดขาย ${baht(s.sales)}` : ''}`,
        detail: s ? join(diff < 0 ? `เงินในลิ้นชักขาด ${baht(-diff)}` : diff > 0 ? `เงินในลิ้นชักเกิน ${baht(diff)}` : 'เงินในลิ้นชักตรง', s.bills != null && `${n0(s.bills)} บิล`) : null,
        amount: s?.sales ?? null, ref: { kind: 'shift', id: s?.id ?? null, branchId: r.branchId },
      };
    }
    case 'cash.moved': {
      const b = bodyOf(r);
      let kind = b.kind === 'in' || b.kind === 'out' ? b.kind : null;
      let amount = Number(b.amount);
      let reason = short(b.reason);
      if (!kind || !(amount > 0)) {
        const c = r.branchId ? (q.cash.get(r.branchId, r.at) as { kind: 'in' | 'out'; amount: number; reason: string } | undefined) : undefined;
        if (!c) return null;
        ({ kind, amount } = c);
        reason = short(c.reason);
      }
      return {
        ...base, title: `${kind === 'in' ? 'นำเงินเข้าลิ้นชัก' : 'นำเงินออกจากลิ้นชัก'} ${baht(amount)}`,
        detail: reason, amount: kind === 'in' ? amount : -amount, ref: { kind: 'shift', branchId: r.branchId },
      };
    }
    case 'expense.created':
    case 'expense.voided': {
      const e = (type === 'expense.created'
        ? r.branchId ? q.expenseNew.get({ b: r.branchId, who, at: r.at }) : undefined
        : q.expense.get(id)) as { id: number; amount: number; category: string; description: string; vendor?: string; reason?: string | null } | undefined;
      if (!e) return type === 'expense.voided' ? { ...base, title: 'ยกเลิกค่าใช้จ่าย', ref: { kind: 'expense', id } } : null;
      const cats = (q.expenseCats.all(e.id) as { category: string }[]).map((c) => o.catName(c.category));
      const cat = (cats.length ? [...new Set(cats)] : [o.catName(e.category)]).join(', ');
      return type === 'expense.created'
        ? { ...base, title: `ค่าใช้จ่าย ${baht(e.amount)} · ${cat}`, detail: join(short(e.description), short(e.vendor)), amount: e.amount, ref: { kind: 'expense', id: e.id } }
        : { ...base, title: `ยกเลิกค่าใช้จ่าย ${baht(e.amount)} · ${cat}`, detail: short(e.reason) && `เหตุผล: ${short(e.reason)}`, amount: e.amount, ref: { kind: 'expense', id: e.id } };
    }
    case 'shipment.shipped':
    case 'shipment.adjusted':
    case 'shipment.cancelled': {
      const s = q.shipment.get(id) as { id: number; no: string; src: number | null; dest: number; bags: number; reason: string | null; units: number } | undefined;
      const no = s?.no ?? r.ref ?? '';
      const route = s ? `${s.src ? o.branchName(s.src) ?? 'สาขา' : 'โรงงาน (ของใหม่)'} → ${o.branchName(s.dest) ?? 'สาขา'}` : null;
      const ref = { kind: 'shipment' as const, id, no: no || null };
      const units = s?.units ?? null;
      const branches = s ? [s.src, s.dest, r.branchId] : [r.branchId];
      if (type === 'shipment.cancelled') {
        return { ...base, level: 'bad', branches, title: `ยกเลิกใบส่งของ ${no}`.trim(), detail: join(route, short(s?.reason) && `เหตุผล: ${short(s?.reason)}`), units, ref };
      }
      return {
        ...base, branches, ref, units,
        title: type === 'shipment.shipped' ? `ส่งของ ${no}${units != null ? ` · ${n0(units)} ชิ้น` : ''}` : `ปลายทางรับของแล้ว ${no}${units != null ? ` · ${n0(units)} ชิ้น` : ''}`,
        detail: join(route, type === 'shipment.shipped' && s && `${n0(s.bags)} ถุง`, type === 'shipment.adjusted' && 'ปรับสต็อกแล้ว'),
      };
    }
    case 'stock.adjusted': {
      const b = bodyOf(r);
      if (!b.apply || (b.mode !== 'add' && b.mode !== 'set')) return null; // เช็คสต็อก / ดูตัวอย่าง ไม่แจ้ง
      const mv = r.branchId ? (q.stockMoves.get({ b: r.branchId, who, at: r.at }) as { skus: number; delta: number; moved: number }) : null;
      if (!mv?.skus) return null; // ยืนยันแล้วแต่ไม่มีอะไรเปลี่ยน
      const d = mv.delta;
      return {
        ...base, title: `${b.mode === 'add' ? 'เพิ่ม/ลบสต็อก' : 'ปรับยอดสต็อกใหม่'} ${n0(mv.skus)} SKU`,
        detail: d > 0 ? `รวม +${n0(d)} ชิ้น` : d < 0 ? `รวม −${n0(-d)} ชิ้น` : `เปลี่ยน ${n0(mv.moved)} ชิ้น (รวมสุทธิ 0)`,
        units: d, ref: { kind: 'stock', branchId: r.branchId },
      };
    }
    case 'security.backup_restored':
      return { ...base, level: 'bad', title: 'กู้คืนข้อมูลจากไฟล์สำรอง', detail: 'ข้อมูลของร้านถูกแทนที่ด้วยไฟล์สำรอง' };
    case 'security.perms_changed': {
      const role = ROLE_LABEL[m[1] as keyof typeof ROLE_LABEL] ?? m[1];
      return { ...base, level: 'warn', title: m[2] ? `คืนค่าสิทธิ์บทบาท ${role}` : `แก้ไขสิทธิ์บทบาท ${role}` };
    }
    case 'security.staff_changed': {
      const sid = m[1] ? Number(m[1]) : null;
      const name = short(r.ref, 40) ?? (sid ? (q.staffName.get(sid) as { name: string } | undefined)?.name ?? null : null);
      const verb = r.method === 'POST' ? 'เพิ่มพนักงาน' : r.method === 'DELETE' ? 'ลบพนักงาน' : 'แก้ไขข้อมูลพนักงาน';
      return { ...base, level: r.method === 'DELETE' ? 'warn' : 'info', title: name ? `${verb} ${name}` : verb };
    }
  }
  return null;
}

// ---------------------------------------------------------------- อ่านกิจกรรม
export interface ActivityQuery { since?: string | null; limit?: string | null; topics?: string | null; minSale?: string | null }

const DAYS_BACK = 7;
const BATCH = 400;
const SCAN_CAP = 6000; // ตรวจย้อนได้มากสุดต่อคำขอ (กันช้า เมื่อผู้ใช้ไม่มีสิทธิ์ดูเกือบทุกเรื่อง)

export function listActivity(me: Me & { keyId?: number }, f: ActivityQuery) {
  const maxId = (q.maxId.get() as { n: number }).n;
  // since มากกว่า id ล่าสุด (เช่น กู้คืนข้อมูลจากไฟล์สำรอง) → เริ่มใหม่จากรายการล่าสุด
  const asked = /^\d+$/.test(String(f.since ?? '')) ? Number(f.since) : null;
  const since = asked != null && asked <= maxId ? asked : null;
  const limit = Math.min(200, Math.max(1, Number(f.limit) || 100));
  // ไม่ส่ง topics = ทุกหัวข้อ · ส่งค่าว่าง = ปิดทุกหัวข้อที่เลือกได้
  const topics = f.topics == null ? new Set<Topic>(TOPICS) : new Set(String(f.topics).split(',').map((s) => s.trim()).filter((s): s is Topic => (TOPICS as string[]).includes(s)));
  const ms = Number(f.minSale);
  const minSale = f.minSale != null && f.minSale !== '' && Number.isFinite(ms) && ms >= 0 ? ms : 3000;

  const names = new Map((q.branches.all() as { id: number; name: string }[]).map((b) => [b.id, b.name]));
  const cats = new Map(expenseCategories().map((c) => [c.id, c.name]));
  const opts: Opts = { minSale, branchName: (id) => (id == null ? null : names.get(id) ?? null), catName: (id) => cats.get(id) ?? id };
  const mine = new Set(me.branchIds);
  const inBranch = (ids: (number | null | undefined)[]) => ids.some((b) => b != null && mine.has(b));

  const items: ActivityItem[] = [];
  let lastId = since ?? maxId;
  let scanned = 0;

  // since = ถามเฉพาะรายการใหม่ → ไล่จากเก่าไปใหม่ (รายการเกิน limit ได้ในรอบถัดไป)
  // ไม่มี since = รายการล่าสุด → ไล่จากใหม่ไปเก่า ย้อนไม่เกิน 7 วัน
  const sql = since != null
    ? `SELECT l.id, l.at, l.staff_name AS staff, l.role, l.branch_id AS branchId, l.method, l.path, l.ref, l.detail
         FROM audit_log l WHERE l.id > ? AND l.id <= ? AND ${PATH_SQL} ORDER BY l.id ASC LIMIT ${BATCH}`
    : `SELECT l.id, l.at, l.staff_name AS staff, l.role, l.branch_id AS branchId, l.method, l.path, l.ref, l.detail
         FROM audit_log l WHERE l.id < ? AND l.at >= datetime('now', 'localtime', '-${DAYS_BACK} days') AND ${PATH_SQL} ORDER BY l.id DESC LIMIT ${BATCH}`;
  const stmt = db.prepare(sql);
  let cursor = since != null ? since : maxId + 1;
  let done = false;

  while (!done && items.length < limit && scanned < SCAN_CAP) {
    const rows = (since != null ? stmt.all(cursor, maxId) : stmt.all(cursor)) as unknown as LogRow[];
    if (!rows.length) {
      if (since != null) lastId = maxId; // ตรวจครบถึงล่าสุดแล้ว
      break;
    }
    for (const r of rows) {
      cursor = r.id;
      scanned++;
      if (since != null) lastId = r.id;
      const hit = kindOf(r.method, r.path);
      if (!hit) continue;
      const { kind, m } = hit;
      if (kind.topic && !topics.has(kind.topic)) continue;
      if (!kind.need(me)) continue;
      const built = build(kind.type, m, r, opts);
      if (!built) continue;
      const { branches, ...rest } = built;
      // เฉพาะสาขาที่ผู้ใช้เข้าได้ (เรื่องระบบที่ไม่มีสาขา = ผู้ดูแลระบบเท่านั้น ตรวจไปแล้วด้านบน)
      if (!kind.type.startsWith('security.') && !inBranch(branches ?? [rest.branchId])) continue;
      items.push({
        id: r.id, at: r.at, type: kind.type, topic: kind.topic ?? null,
        ...rest,
        branchName: opts.branchName(rest.branchId),
        staff: r.staff,
      });
      if (items.length >= limit) { done = true; break; }
    }
    if (rows.length < BATCH && since != null && !done) lastId = maxId;
    if (rows.length < BATCH) break;
  }

  items.sort((a, b) => b.id - a.id);
  return { lastId, items };
}
