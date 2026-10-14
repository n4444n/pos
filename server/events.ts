// เหตุการณ์ในระบบ → การแจ้งเตือน LINE (การ์ด Flex) / WhatsApp (ข้อความ) / Webhook (JSON ให้ระบบภายนอก)
// ตั้งค่าที่ ตั้งค่า → การแจ้งเตือน & API
import { createHmac } from 'node:crypto';
import { db, withBranch } from './db.ts';
import { getSettings, publicSettings, type Settings } from './settings.ts';
import { listBranches } from './branches.ts';
import {
  EVENTS, eventByName, eventMeta, flexMessage, plainText, sampleVars, type EventKey, type NotifyItem,
} from './notify.ts';

export type EventName =
  | 'order.created' | 'order.edited' | 'order.voided' | 'stock.low' | 'stock.out'
  | 'shift.opened' | 'shift.closed' | 'cash.moved' | 'expense.created' | 'report.daily';

const baht = (n: number) => `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const PAY: Record<string, string> = { cash: 'เงินสด', promptpay: 'พร้อมเพย์ (QR)', card: 'บัตรเครดิต/เดบิต', transfer: 'โอนผ่านธนาคาร' };
const payLabel = (m: string) => getSettings().payments.methods.find((x) => x.id === m)?.label ?? PAY[m] ?? m;

async function post(url: string, body: string, headers: Record<string, string>, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers }, signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
  } catch (e) {
    const m = (e as Error).name === 'AbortError' ? 'หมดเวลาเชื่อมต่อ' : (e as Error).message === 'fetch failed' ? 'เชื่อมต่อปลายทางไม่ได้ — ตรวจสอบอินเทอร์เน็ตของเครื่องที่รันระบบ หรือ URL' : (e as Error).message;
    return { ok: false, status: 0, body: m };
  } finally {
    clearTimeout(t);
  }
}

// ---------- ช่องทาง ----------
/** LINE Messaging API (push) — messages = text หรือ flex */
export function sendLine(messages: unknown[], cfg: Settings['notify']['line']) {
  return post('https://api.line.me/v2/bot/message/push', JSON.stringify({ to: cfg.to, messages }), { Authorization: `Bearer ${cfg.token}` });
}

/** WhatsApp Cloud API (Meta) */
export function sendWhatsApp(text: string, cfg: Settings['notify']['whatsapp']) {
  return post(
    `https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`,
    JSON.stringify({ messaging_product: 'whatsapp', to: cfg.to, type: 'text', text: { preview_url: false, body: text.slice(0, 4000) } }),
    { Authorization: `Bearer ${cfg.token}` },
  );
}

function sendWebhook(event: string, data: unknown) {
  const h = getSettings().notify.webhook;
  if (!h.url) return Promise.resolve({ ok: false, status: 0, body: 'ยังไม่ได้ตั้ง Webhook URL' });
  const shop = publicSettings().shop; // ชื่อ/รหัสของสาขาที่เกิดเหตุการณ์
  const body = JSON.stringify({ event, at: new Date().toISOString(), shop: shop.name, branch: shop.branchCode, branchName: shop.branchName, data });
  const headers: Record<string, string> = { 'X-POS-Event': event };
  if (h.secret) headers['X-POS-Signature'] = 'sha256=' + createHmac('sha256', h.secret).update(body).digest('hex');
  return post(h.url, body, headers);
}

const lineReady = (n: Settings['notify']) => n.line.enabled && !!n.line.token && !!n.line.to;
const waReady = (n: Settings['notify']) => n.whatsapp.enabled && !!n.whatsapp.token && !!n.whatsapp.phoneNumberId && !!n.whatsapp.to;

// ---------- ข้อมูลเหตุการณ์ → ตัวแปรในข้อความ ----------
type Any = Record<string, any>;
function commonVars(): Record<string, string> {
  const shop = publicSettings().shop;
  const d = new Date();
  return {
    shop: shop.name, branch: shop.branchName, branchCode: shop.branchCode,
    date: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    staff: '-',
  };
}

function varsFor(key: EventKey, d: Any): { vars: Record<string, string>; items: NotifyItem[] } {
  const v = commonVars();
  if (d.staff) v.staff = String(d.staff);
  const items: NotifyItem[] = [];
  switch (key) {
    case 'sale':
      Object.assign(v, {
        orderNo: d.orderNo, total: baht(d.total), subtotal: baht(d.subtotal ?? d.total), discount: baht(d.discount ?? 0), fee: baht(d.fee ?? 0),
        payment: payLabel(d.paymentMethod), count: String(d.itemCount ?? 0), customer: d.customer || '-', orderType: d.orderType ?? '-',
        staff: d.salesperson || v.staff,
      });
      for (const it of d.items ?? []) items.push({ name: it.name, detail: `${it.label ? it.label + ' ' : ''}× ${it.qty}`, value: baht(it.price * it.qty) });
      break;
    case 'void':
      Object.assign(v, { orderNo: d.orderNo, total: baht(d.total), reason: d.reason || '-' });
      break;
    case 'edit': {
      const diff = Number(d.diff ?? 0);
      Object.assign(v, {
        orderNo: d.orderNo ?? '-', oldTotal: baht(d.oldTotal ?? 0), newTotal: baht(d.newTotal ?? 0),
        diff: diff === 0 ? '฿0' : diff > 0 ? `+${baht(diff)} (เก็บเพิ่ม)` : `-${baht(-diff)} (คืนเงิน)`, reason: d.reason || '-',
      });
      break;
    }
    case 'lowStock':
    case 'outStock':
      v.count = String((d.items ?? []).length);
      for (const it of d.items ?? []) items.push({ name: it.name, detail: it.label ?? '', value: Number(it.stock) > 0 ? `เหลือ ${it.stock}` : 'หมด' });
      break;
    case 'shiftOpen':
      Object.assign(v, { shiftNo: String(d.shiftNo ?? ''), openingCash: baht(d.openingCash ?? 0), staff: d.openedBy || v.staff });
      break;
    case 'shiftClose': {
      const verdict = d.verdict === 'match' ? 'ยอดตรง ✅' : d.verdict === 'short' ? 'เงินขาด ❌' : d.verdict === 'over' ? 'เงินเกิน ⚠️' : '-';
      const diff = Number(d.diff ?? 0);
      Object.assign(v, {
        shiftNo: String(d.shiftNo ?? ''), sales: baht(d.totalSales ?? 0), bills: String(d.billCount ?? 0), expected: baht(d.expectedCash ?? 0),
        counted: baht(d.countedCash ?? 0), diff: diff === 0 ? '฿0' : diff > 0 ? `+${baht(diff)}` : `-${baht(-diff)}`, verdict, staff: d.closedBy || v.staff,
      });
      break;
    }
    case 'cash':
      Object.assign(v, { kind: d.kind === 'in' ? 'นำเงินเข้า' : 'นำเงินออก', amount: baht(d.amount ?? 0), reason: d.reason || '-' });
      break;
    case 'expense':
      Object.assign(v, {
        amount: baht(d.amount ?? 0), category: d.categoryName ?? d.category ?? '-', description: d.description || '-',
        source: d.sourceName ?? d.source ?? '-', vendor: d.vendor || '-', refNo: d.refNo || '-',
      });
      break;
    case 'daily':
      Object.assign(v, {
        date: d.dateLabel ?? v.date, sales: baht(d.sales ?? 0), bills: String(d.bills ?? 0), units: String(d.units ?? 0),
        avg: baht(d.bills ? d.sales / d.bills : 0), voids: String(d.voids ?? 0), top: d.top || '-',
      });
      for (const b of d.branches ?? []) items.push({ name: b.name, detail: `${b.bills} บิล`, value: baht(b.sales) });
      break;
  }
  for (const k of Object.keys(v)) v[k] = String(v[k] ?? '');
  return { vars: v, items };
}

/** ส่งการแจ้งเตือนของเหตุการณ์หนึ่งไปทุกช่องทางที่เปิดไว้ */
async function deliver(key: EventKey, vars: Record<string, string>, items: NotifyItem[]) {
  const n = getSettings().notify;
  const ch = n.events[key];
  const tpl = n.templates[key];
  if (ch.line && lineReady(n)) {
    const r = await sendLine([flexMessage(tpl, n.style, vars, items)], n.line);
    if (!r.ok) console.warn('[notify] LINE', key, r.status, r.body);
  }
  if (ch.whatsapp && waReady(n)) {
    const r = await sendWhatsApp(plainText(tpl, vars, items), n.whatsapp);
    if (!r.ok) console.warn('[notify] WhatsApp', key, r.status, r.body);
  }
}

/** ส่งเหตุการณ์ออก (ไม่รอผล — ไม่ทำให้การขายช้าลง) */
export function emit(event: EventName, data: Any) {
  try {
    const meta = eventByName(event);
    if (!meta) return;
    const n = getSettings().notify;
    const ch = n.events[meta.key];
    if (!ch?.on) return;
    // เงื่อนไขเพิ่มเติม
    if (meta.key === 'sale' && n.options.saleMin > 0 && Number(data.total) < n.options.saleMin) return;
    if (meta.key === 'shiftClose' && n.options.shiftMismatchOnly && data.verdict === 'match') return;
    if (ch.webhook && n.webhook.enabled) void sendWebhook(event, data).then((r) => !r.ok && console.warn('[webhook]', event, r.status, r.body));
    // สร้างข้อความตอนนี้ (ยังเป็นสาขาของเหตุการณ์) แล้วค่อยส่ง
    const { vars, items } = varsFor(meta.key, data);
    void deliver(meta.key, vars, items);
  } catch (e) {
    console.warn('[events]', event, (e as Error).message);
  }
}

// ---------- ทดสอบส่ง (หน้าตั้งค่า) ----------
const pick = (o: Record<string, string>, ks: string[]) => Object.fromEntries(ks.map((k) => [k, o[k]]));
export async function testNotify(channel: string, eventKey?: string) {
  const n = getSettings().notify;
  const key = (EVENTS.find((e) => e.key === eventKey)?.key ?? 'sale') as EventKey;
  const vars = { ...sampleVars(key), ...pick(commonVars(), ['shop', 'branch', 'branchCode', 'date', 'time']) };
  const items = eventMeta(key).sampleItems;
  if (channel === 'line') {
    if (!n.line.token || !n.line.to) return { ok: false, status: 0, body: 'กรุณากรอก Channel access token และ ID ผู้รับ แล้วบันทึกก่อน' };
    return sendLine([flexMessage(n.templates[key], n.style, vars, items)], n.line);
  }
  if (channel === 'whatsapp') {
    const w = n.whatsapp;
    if (!w.token || !w.phoneNumberId || !w.to) return { ok: false, status: 0, body: 'กรุณากรอก Access token, Phone number ID และเบอร์ผู้รับ แล้วบันทึกก่อน' };
    return sendWhatsApp(plainText(n.templates[key], vars, items), w);
  }
  if (channel === 'webhook') {
    if (!n.webhook.url) return { ok: false, status: 0, body: 'กรุณากรอก Webhook URL แล้วบันทึกก่อน' };
    return sendWebhook('ping', { message: 'ทดสอบ webhook', sample: eventMeta(key).name });
  }
  return { ok: false, status: 0, body: 'ไม่รู้จักช่องทาง' };
}

/** รายการเหตุการณ์ + ตัวแปร + ข้อมูลตัวอย่าง — หน้าตั้งค่าใช้แสดงตัวอย่างการ์ด */
export function notifyCatalog() {
  const c = commonVars();
  return EVENTS.map((e) => ({
    key: e.key, name: e.name, label: e.label, desc: e.desc, hasItems: e.hasItems,
    placeholders: [['shop', 'ชื่อร้าน'], ['branch', 'ชื่อสาขา'], ['branchCode', 'รหัสสาขา'], ['date', 'วันที่'], ['time', 'เวลา'], ['staff', 'พนักงาน'], ...e.placeholders],
    sample: { ...sampleVars(e.key), shop: c.shop, branch: c.branch, branchCode: c.branchCode },
    sampleItems: e.sampleItems,
    defaultTemplate: e.template,
  }));
}

// ---------- สรุปยอดขายประจำวัน (ส่งอัตโนมัติ) ----------
function todayLocal() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, hm: `${p(d.getHours())}:${p(d.getMinutes())}` };
}
export function dailySummary(date: string) {
  const per = db
    .prepare(
      `SELECT branch_id AS id, COUNT(*) AS bills, COALESCE(SUM(total), 0) AS sales FROM orders_all
        WHERE status != 'void' AND substr(created_at, 1, 10) = ? GROUP BY branch_id`,
    )
    .all(date) as { id: number; bills: number; sales: number }[];
  const units = (db.prepare(
    `SELECT COALESCE(SUM(oi.qty), 0) AS n FROM order_items oi JOIN orders_all o ON o.id = oi.order_id WHERE o.status != 'void' AND substr(o.created_at, 1, 10) = ?`,
  ).get(date) as { n: number }).n;
  const voids = (db.prepare(`SELECT COUNT(*) AS n FROM orders_all WHERE status = 'void' AND substr(created_at, 1, 10) = ?`).get(date) as { n: number }).n;
  const top = db.prepare(
    `SELECT oi.product_name AS name, SUM(oi.qty) AS q FROM order_items oi JOIN orders_all o ON o.id = oi.order_id
      WHERE o.status != 'void' AND substr(o.created_at, 1, 10) = ? GROUP BY oi.product_name ORDER BY q DESC LIMIT 1`,
  ).get(date) as { name: string; q: number } | undefined;
  const all = listBranches();
  const branches = all.map((b) => ({ name: b.name, ...(per.find((x) => x.id === b.id) ?? { bills: 0, sales: 0 }) }));
  const sales = per.reduce((a, x) => a + x.sales, 0);
  const bills = per.reduce((a, x) => a + x.bills, 0);
  const d = new Date(`${date}T12:00:00`);
  return {
    date, dateLabel: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
    sales, bills, units, voids, top: top ? `${top.name} (${top.q} ชิ้น)` : '', branches,
  };
}

function lastDailySent(): string {
  const r = db.prepare("SELECT value FROM settings WHERE section = 'notifyState'").get() as { value: string } | undefined;
  try {
    return r ? JSON.parse(r.value).dailySent ?? '' : '';
  } catch {
    return '';
  }
}
function markDailySent(date: string) {
  db.prepare(
    `INSERT INTO settings (section, value) VALUES ('notifyState', ?) ON CONFLICT(section) DO UPDATE SET value = excluded.value, updated_at = datetime('now', 'localtime')`,
  ).run(JSON.stringify({ dailySent: date }));
}

setInterval(() => {
  try {
    const n = getSettings().notify;
    if (!n.events.daily.on) return;
    const { date, hm } = todayLocal();
    if (hm < n.options.dailyTime || lastDailySent() === date) return;
    markDailySent(date);
    // สรุปรวมทุกสาขา — {shop}/{branch} ในการ์ด = สาขาหลัก
    withBranch(0, () => emit('report.daily', dailySummary(date)));
  } catch (e) {
    console.warn('[daily]', (e as Error).message);
  }
}, 30_000).unref();
