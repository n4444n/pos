// Beam Checkout — รับเงินผ่านเครื่อง Beam Bolt หน้าร้าน (โหมด Pairing)
//
// ลำดับการใช้งาน
//   1) ตั้งค่า → Beam Checkout: ใส่ Merchant ID + API Key แล้วกดทดสอบการเชื่อมต่อ
//   2) ผูกเครื่อง: เครื่อง Bolt เลือกโหมด Pairing → ได้รหัสผูกเครื่อง 6 หลัก → กรอกในหน้าตั้งค่า
//      ระบบเรียก POST /api/v1/bolt-connections แล้วเก็บ boltConnectionId ไว้กับสาขา (หรือเครื่อง POS)
//   3) ขาย: สร้าง Bolt Intent ส่งยอดไปขึ้นบนเครื่อง → ลูกค้าแตะบัตร/เสียบบัตร/สแกน QR
//      → ถามผลเป็นระยะ (polling) → จ่ายสำเร็จค่อยออกบิลและตัดสต็อก
//
// กติกาที่มาจากเอกสารของ Beam และต้องรักษาไว้
//   - เครื่องต้องค้างอยู่หน้าจอ "Ready for payments" ไม่งั้นคำสั่งจะถูกทิ้งเงียบ ๆ
//   - เว้น ~5 วินาทีหลังเครื่องเชื่อมต่อ หรือหลังรายการก่อนหน้าถูกยกเลิก/หมดอายุ ก่อนส่งรายการใหม่
//   - รายการที่ยกเลิก/หมดอายุไปแล้ว "ยังมีโอกาสจ่ายสำเร็จตามมาทีหลัง" → ต้องเช็คผลซ้ำเสมอ
//   - POST/PATCH ทุกครั้งแนบ x-beam-idempotency-key กันยิงซ้ำตอนเน็ตกระตุก (Beam จำคีย์ไว้ 12 ชม.)
//
// ความปลอดภัย: API Key อยู่ในตาราง settings เท่านั้น ไม่เคยส่งให้หน้าจอ (forAdmin ปิดบังไว้)
// และเรียก Beam จากเซิร์ฟเวอร์ฝั่งนี้เท่านั้น ไม่ให้เบราว์เซอร์คุยกับ Beam ตรง ๆ
import { randomUUID } from 'node:crypto';
import { currentBranch, db } from './db.ts';
import { HttpError } from './common.ts';
import { getSettings, setBeamUsable } from './settings.ts';

const PLAYGROUND = 'https://playground.api.beamcheckout.com';
const PRODUCTION = 'https://api.beamcheckout.com';
// ทดสอบด้วยเซิร์ฟเวอร์จำลองบนเครื่อง: BEAM_API_URL=http://127.0.0.1:4100 (ไม่ตั้ง = ใช้ของ Beam จริง)
const OVERRIDE = String(process.env.BEAM_API_URL ?? '').replace(/\/+$/, '');

db.exec(`
  CREATE TABLE IF NOT EXISTS beam_connections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id     INTEGER NOT NULL,
    -- 0 = ใช้ได้ทั้งสาขา · >0 = ผูกกับเครื่อง POS เครื่องนั้นเครื่องเดียว
    -- (ใช้ 0 แทน NULL เพราะ SQLite ยอมให้ NULL ซ้ำกันได้ใน UNIQUE)
    terminal_id   INTEGER NOT NULL DEFAULT 0,
    connection_id TEXT    NOT NULL,
    device_id     TEXT    NOT NULL,
    device_name   TEXT    NOT NULL DEFAULT '',
    env           TEXT    NOT NULL DEFAULT 'playground',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (branch_id, terminal_id)
  );
`);

export interface BeamConnection {
  id: number;
  branchId: number;
  terminalId: number;
  connectionId: string;
  deviceId: string;
  deviceName: string;
  env: string;
  createdAt: string;
}

const q = {
  byBranch: db.prepare('SELECT * FROM beam_connections WHERE branch_id = ? ORDER BY terminal_id'),
  pick: db.prepare('SELECT * FROM beam_connections WHERE branch_id = ? AND terminal_id = ?'),
  del: db.prepare('DELETE FROM beam_connections WHERE branch_id = ? AND terminal_id = ?'),
  put: db.prepare(
    `INSERT INTO beam_connections (branch_id, terminal_id, connection_id, device_id, device_name, env)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(branch_id, terminal_id) DO UPDATE SET
       connection_id = excluded.connection_id, device_id = excluded.device_id,
       device_name = excluded.device_name, env = excluded.env,
       created_at = datetime('now', 'localtime')`,
  ),
};

const row = (r: Record<string, unknown> | undefined): BeamConnection | null =>
  r
    ? {
        id: Number(r.id), branchId: Number(r.branch_id), terminalId: Number(r.terminal_id),
        connectionId: String(r.connection_id), deviceId: String(r.device_id),
        deviceName: String(r.device_name ?? ''), env: String(r.env ?? ''), createdAt: String(r.created_at),
      }
    : null;

/** เครื่องที่ผูกไว้สำหรับคำขอนี้ — หาเครื่องของ POS เครื่องนี้ก่อน ไม่มีค่อยใช้ตัวประจำสาขา */
export function connectionFor(terminalId = 0): BeamConnection | null {
  const b = currentBranch();
  const own = terminalId > 0 ? row(q.pick.get(b, terminalId) as Record<string, unknown> | undefined) : null;
  return own ?? row(q.pick.get(b, 0) as Record<string, unknown> | undefined);
}

export const connectionsOfBranch = () => (q.byBranch.all(currentBranch()) as Record<string, unknown>[]).map(row).filter((x): x is BeamConnection => !!x);

// ---------------------------------------------------------------- ตัวเรียก API ของ Beam
interface Creds { base: string; auth: string; env: 'playground' | 'production' }

function creds(): Creds {
  const b = getSettings().beam;
  if (!b.enabled) throw new HttpError(409, 'ยังไม่ได้เปิดใช้งาน Beam Checkout (ตั้งค่า → Beam Checkout)', 'BEAM_OFF');
  if (!b.merchantId || !b.apiKey) throw new HttpError(409, 'ยังไม่ได้ใส่ Merchant ID หรือ API Key ของ Beam', 'BEAM_NO_KEY');
  return {
    base: OVERRIDE || (b.env === 'production' ? PRODUCTION : PLAYGROUND),
    auth: 'Basic ' + Buffer.from(`${b.merchantId}:${b.apiKey}`).toString('base64'),
    env: b.env,
  };
}

/** เปิดใช้งานครบพร้อมเรียก API แล้วหรือยัง (ไม่โยน error — ใช้ตอนแสดงสถานะ) */
export function beamReady() {
  const b = getSettings().beam;
  return b.enabled && !!b.merchantId && !!b.apiKey;
}
// บอกหน้าขายว่าให้แสดงวิธีชำระ "เครื่องรับบัตร" ไหม
// ต้องผูกเครื่องกับสาขานี้ไว้แล้ว และเครื่องต้องอยู่โหมดเดียวกับที่ตั้งไว้
// (ผูกไว้คนละโหมด = ส่งยอดไม่ผ่านแน่นอน — ซ่อนไปเลยดีกว่าให้พนักงานไปเจอตอนท้าย)
setBeamUsable(() => {
  try {
    const c = connectionFor(0);
    return beamReady() && !!c && c.env === getSettings().beam.env;
  } catch {
    return false;
  }
});

interface CallOpts { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; timeoutMs?: number }

async function call<T>(path: string, opts: CallOpts = {}): Promise<T> {
  const c = creds();
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Authorization: c.auth, Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  // POST/PATCH เท่านั้นที่ต้องมีคีย์กันซ้ำ (GET/DELETE ยิงซ้ำได้อยู่แล้ว)
  if (method === 'POST' || method === 'PATCH') headers['x-beam-idempotency-key'] = randomUUID();

  let res: Response;
  try {
    res = await fetch(c.base + path, {
      method, headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (e) {
    const msg = (e as Error).name === 'TimeoutError' ? 'Beam ไม่ตอบสนองในเวลาที่กำหนด' : `ติดต่อ Beam ไม่ได้ — ตรวจอินเทอร์เน็ต (${(e as Error).message})`;
    throw new HttpError(502, msg, 'BEAM_NETWORK');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    // รูปแบบ error ของ Beam: { code, message } — ถ้าไม่มีก็ใช้รหัส HTTP
    const code = String((data as { code?: unknown }).code ?? `HTTP${res.status}`);
    const msg = String((data as { message?: unknown }).message ?? `Beam ตอบกลับ ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new HttpError(409, `Beam ปฏิเสธกุญแจ — ตรวจ Merchant ID / API Key และโหมด (${c.env})`, 'BEAM_AUTH');
    throw new HttpError(502, `Beam: ${msg}`, `BEAM_${code}`);
  }
  return data as T;
}

// ---------------------------------------------------------------- ผูกเครื่อง (Bolt Connection)
interface ConnectionRes { boltConnectionId?: string; deviceId?: string; device?: { id?: string; name?: string } }

/** ผูกเครื่อง Bolt เข้ากับสาขานี้ด้วยรหัสที่เครื่องแสดง (terminalId = 0 คือใช้ได้ทั้งสาขา) */
export async function pairDevice(pairingCode: unknown, terminalId = 0) {
  const code = String(pairingCode ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new HttpError(422, 'รหัสผูกเครื่องไม่ถูกต้อง — ดูรหัสบนหน้าจอเครื่อง Bolt');
  const t = Math.max(0, Math.floor(Number(terminalId) || 0));

  const r = await call<ConnectionRes>('/api/v1/bolt-connections', { method: 'POST', body: { pairingCode: code }, timeoutMs: 30_000 });
  const connectionId = String(r.boltConnectionId ?? '');
  const deviceId = String(r.deviceId ?? r.device?.id ?? '');
  if (!connectionId) throw new HttpError(502, 'Beam ไม่ได้ส่งรหัสการเชื่อมต่อกลับมา');

  q.put.run(currentBranch(), t, connectionId, deviceId, String(r.device?.name ?? ''), getSettings().beam.env);
  return { ok: true as const, connection: connectionFor(t) };
}

/** ยกเลิกการผูกเครื่อง — ลบที่ Beam ก่อน แล้วค่อยลบของเรา (ลบที่ Beam ไม่ได้ก็ยังลบของเรา) */
export async function unpairDevice(terminalId = 0) {
  const t = Math.max(0, Math.floor(Number(terminalId) || 0));
  const c = row(q.pick.get(currentBranch(), t) as Record<string, unknown> | undefined);
  if (!c) throw new HttpError(404, 'ยังไม่ได้ผูกเครื่องไว้');
  let warning = '';
  try {
    await call(`/api/v1/bolt-connections/${encodeURIComponent(c.connectionId)}`, { method: 'DELETE' });
  } catch (e) {
    warning = `ลบที่ฝั่ง Beam ไม่สำเร็จ (${(e as Error).message}) — ลบออกจากระบบร้านแล้ว ถ้าเครื่องยังค้างให้ออกจากระบบที่เครื่อง`;
  }
  q.del.run(currentBranch(), t);
  return { ok: true as const, warning };
}

/** ทดสอบว่ากุญแจใช้ได้จริง — เรียก endpoint ที่ไม่สร้างอะไร */
export async function testConnection() {
  const b = getSettings().beam;
  await call('/api/v1/bolt-devices?limit=1', { timeoutMs: 20_000 });
  return { ok: true as const, env: b.env, merchantId: b.merchantId };
}

// ---------------------------------------------------------------- รายการชำระเงิน (Bolt Intent)
//
// ตาราง beam_intents = "ตะกร้าที่รอจ่าย" — เก็บไว้จนกว่าจะออกบิลสำเร็จ
// จุดประสงค์หลักคือกันเงินหาย: ถ้าลูกค้าจ่ายแล้วแต่ออกบิลไม่ทัน (ไฟดับ/เน็ตหลุด/ปิดโปรแกรม)
// เปิดโปรแกรมครั้งหน้าจะเห็นว่ามีรายการที่จ่ายแล้วแต่ยังไม่มีบิล แล้วออกบิลย้อนให้ได้
db.exec(`
  CREATE TABLE IF NOT EXISTS beam_intents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id   INTEGER NOT NULL,
    intent_id   TEXT    NOT NULL UNIQUE,
    ref_id      TEXT    NOT NULL,
    amount      REAL    NOT NULL,
    method      TEXT    NOT NULL,
    -- WAITING = รอลูกค้าจ่าย · PAID = จ่ายแล้ว (ยังไม่ออกบิล) · BILLED = ออกบิลแล้ว
    -- CANCELED / EXPIRED / FAILED = จบโดยไม่มีเงิน
    status      TEXT    NOT NULL DEFAULT 'WAITING',
    result      TEXT,
    charge_id   TEXT,
    order_id    INTEGER,
    -- ตะกร้าที่ลูกค้าสั่ง (JSON) — ใช้ออกบิลหลังจ่ายสำเร็จ
    cart        TEXT    NOT NULL,
    staff       TEXT    NOT NULL DEFAULT '',
    approved_by TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS ix_beam_intents_open ON beam_intents (branch_id, status);
`);

// เก็บประวัติรายการชำระเงิน 365 วัน (เท่ากับ LOG) แล้วลบอัตโนมัติ — ไม่ลบรายการที่ยังออกบิลไม่สำเร็จ
const purgeIntents = () =>
  db.prepare(
    `DELETE FROM beam_intents WHERE status <> 'PAID' AND created_at < datetime('now', 'localtime', '-365 days')`,
  ).run();
purgeIntents();
setInterval(purgeIntents, 24 * 60 * 60 * 1000).unref();

export interface IntentRow {
  id: number; branchId: number; intentId: string; refId: string; amount: number; method: string;
  status: 'WAITING' | 'PAID' | 'BILLED' | 'CANCELED' | 'EXPIRED' | 'FAILED';
  result: string | null; chargeId: string | null; orderId: number | null;
  cart: string; staff: string; approvedBy: string; createdAt: string; updatedAt: string;
}

const iq = {
  ins: db.prepare('INSERT INTO beam_intents (branch_id, intent_id, ref_id, amount, method, cart, staff, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  byIntent: db.prepare('SELECT * FROM beam_intents WHERE intent_id = ? AND branch_id = ?'),
  // รายการที่ต้องตามต่อ = ยังไม่ได้ออกบิล และ
  //   PAID            → ออกบิลค้างอยู่ ตามจนกว่าจะออกบิลได้ (ไม่มีกำหนดเวลา — เงินของลูกค้าอยู่ในมือเราแล้ว)
  //   สถานะอื่นใน 1 วัน → ต้องถาม Beam ซ้ำ เพราะเอกสารระบุว่ารายการที่ยกเลิก/หมดอายุไปแล้ว
  //                      ยังมีโอกาสที่เงินจะเข้าตามมาทีหลังได้ (รายการบนเครื่องอายุไม่เกิน 10 นาที
  //                      จึงเผื่อ 1 วันพอ แล้วเลิกถาม ไม่ให้ถามรายการเก่าไปเรื่อย ๆ)
  open: db.prepare(
    `SELECT * FROM beam_intents WHERE branch_id = ? AND status <> 'BILLED'
       AND (status = 'PAID' OR created_at >= datetime('now', 'localtime', '-1 day')) ORDER BY id`,
  ),
  setStatus: db.prepare("UPDATE beam_intents SET status = ?, result = ?, charge_id = COALESCE(?, charge_id), updated_at = datetime('now','localtime') WHERE intent_id = ?"),
  setOrder: db.prepare("UPDATE beam_intents SET status = 'BILLED', order_id = ?, updated_at = datetime('now','localtime') WHERE intent_id = ?"),
  ofOrder: db.prepare('SELECT charge_id, intent_id, method FROM beam_intents WHERE order_id = ?'),
};

const irow = (r: Record<string, unknown> | undefined): IntentRow | null =>
  r
    ? {
        id: Number(r.id), branchId: Number(r.branch_id), intentId: String(r.intent_id), refId: String(r.ref_id),
        amount: Number(r.amount), method: String(r.method), status: String(r.status) as IntentRow['status'],
        result: (r.result as string) ?? null, chargeId: (r.charge_id as string) ?? null,
        orderId: r.order_id == null ? null : Number(r.order_id), cart: String(r.cart),
        staff: String(r.staff ?? ''), approvedBy: String(r.approved_by ?? ''),
        createdAt: String(r.created_at), updatedAt: String(r.updated_at),
      }
    : null;

export const getIntentRow = (intentId: string) => irow(iq.byIntent.get(intentId, currentBranch()) as Record<string, unknown> | undefined);
export const openIntents = () => (iq.open.all(currentBranch()) as Record<string, unknown>[]).map(irow).filter((x): x is IntentRow => !!x);
export const markBilled = (intentId: string, orderId: number) => iq.setOrder.run(orderId, intentId);
/** ข้อมูล Beam ของบิล (ไว้แสดงในรายละเอียดบิลและกระทบยอดกับรายงานของ Beam) */
export const beamOfOrder = (orderId: number) => {
  const r = iq.ofOrder.get(orderId) as { charge_id?: string; intent_id?: string; method?: string } | undefined;
  return r ? { chargeId: r.charge_id ?? null, intentId: r.intent_id ?? null, method: r.method ?? '' } : null;
};

/** ชื่อฟิลด์ย่อยของ paymentMethod ตามเอกสาร เช่น QR_PROMPT_PAY → qrPromptPay */
const methodKey = (m: string) => m.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

interface IntentRes { boltIntentId?: string; id?: string; status?: string; result?: string | null; latestChargeId?: string | null }

/** ส่งยอดไปขึ้นบนเครื่อง — amount เป็นบาท (แปลงเป็นสตางค์ให้ตามที่ Beam ต้องการ) */
export async function startIntent(opts: { amount: number; method: string; refId: string; note?: string; terminalId?: number; staff: string; approvedBy: string; cart: unknown }) {
  const conn = connectionFor(opts.terminalId ?? 0);
  if (!conn) throw new HttpError(409, 'ยังไม่ได้ผูกเครื่อง Beam Bolt กับสาขานี้ (ตั้งค่า → Beam Checkout)', 'BEAM_NO_DEVICE');
  const b = getSettings().beam;
  if (conn.env !== b.env) throw new HttpError(409, 'เครื่องที่ผูกไว้เป็นคนละโหมดกับที่ตั้งอยู่ — ผูกเครื่องใหม่ก่อน', 'BEAM_ENV');
  if (!b.methods.includes(opts.method as never)) throw new HttpError(422, 'วิธีรับเงินนี้ไม่ได้เปิดใช้งานไว้');
  const satang = Math.round(opts.amount * 100);
  if (!(satang > 0)) throw new HttpError(422, 'ยอดเงินไม่ถูกต้อง');

  const r = await call<IntentRes>('/api/v1/bolt-intents', {
    method: 'POST',
    timeoutMs: 30_000,
    body: {
      amount: satang,
      currency: 'THB',
      boltConnectionId: conn.connectionId,
      expiryDurationInSec: b.timeoutSec,
      referenceId: opts.refId,
      internalNote: opts.note ?? '',
      mode: { type: 'PAIRING', deepLink: null },
      paymentMethod: { paymentMethodType: opts.method, [methodKey(opts.method)]: {} },
    },
  });
  const intentId = String(r.boltIntentId ?? r.id ?? '');
  if (!intentId) throw new HttpError(502, 'Beam ไม่ได้ส่งรหัสรายการกลับมา');

  iq.ins.run(currentBranch(), intentId, opts.refId, opts.amount, opts.method, JSON.stringify(opts.cart), opts.staff, opts.approvedBy);
  return { intentId, amount: opts.amount, method: opts.method, expirySec: b.timeoutSec, device: conn.deviceName || conn.deviceId };
}

/** ถามผลจาก Beam แล้วอัปเดตสถานะในตาราง — คืนแถวล่าสุด */
export async function refreshIntent(intentId: string): Promise<IntentRow> {
  const cur = getIntentRow(intentId);
  if (!cur) throw new HttpError(404, 'ไม่พบรายการชำระเงินนี้');
  if (cur.status === 'BILLED') return cur;

  const r = await call<IntentRes>(`/api/v1/bolt-intents/${encodeURIComponent(intentId)}`);
  const result = r.result ?? null;
  const charge = r.latestChargeId ?? null;
  // จ่ายสำเร็จถือเป็นที่สุด — แม้รายการจะถูกยกเลิก/หมดอายุไปก่อนหน้า เงินก็ออกจากลูกค้าแล้ว
  let status: IntentRow['status'] = cur.status;
  if (result === 'CH_SUCCEEDED' || r.status === 'PAID') status = 'PAID';
  else if (result === 'BI_CANCELED' || r.status === 'CANCELED') status = 'CANCELED';
  else if (result === 'BI_EXPIRED' || r.status === 'EXPIRED') status = 'EXPIRED';
  else if (result && result.startsWith('CH_')) status = 'FAILED';

  if (status !== cur.status || (charge && charge !== cur.chargeId)) iq.setStatus.run(status, result, charge, intentId);
  return getIntentRow(intentId)!;
}

/** ยกเลิกรายการบนเครื่อง (เงินยังไม่ออก) */
export async function cancelIntent(intentId: string) {
  const cur = getIntentRow(intentId);
  if (!cur) throw new HttpError(404, 'ไม่พบรายการชำระเงินนี้');
  if (cur.status === 'PAID' || cur.status === 'BILLED') throw new HttpError(409, 'ลูกค้าจ่ายเงินไปแล้ว ยกเลิกไม่ได้ — ถ้าต้องการคืนเงินให้ทำผ่านระบบคืนเงินของ Beam');
  await call(`/api/v1/bolt-intents/${encodeURIComponent(intentId)}/cancel`, { method: 'PATCH' });
  // ยังต้องถามผลซ้ำอีกรอบ: เอกสารระบุว่ารายการที่ยกเลิกแล้วยังมีโอกาสจ่ายสำเร็จตามมาได้
  return refreshIntent(intentId);
}

/**
 * ข้อมูลเท่าที่หน้าขายต้องใช้ตอนรับเงิน — พนักงานขายเรียกได้ (ไม่ต้องมีสิทธิ์ "ตั้งค่า")
 * ไม่มีกุญแจ ไม่มี Merchant ID ไม่มีโหมด ไม่มีรหัสเครื่อง — มีแค่ที่ต้องใช้วาดหน้าจอ
 */
export function beamCheckoutInfo(terminalId = 0) {
  const b = getSettings().beam;
  const conn = beamReady() ? connectionFor(terminalId) : null;
  return {
    /** พร้อมรับเงินจริง (เปิดใช้งาน + ใส่กุญแจ + ผูกเครื่องโหมดเดียวกันไว้แล้ว) */
    ready: !!conn && conn.env === b.env,
    methods: b.methods,
    requireManager: b.requireManager,
    timeoutSec: b.timeoutSec,
    device: conn?.deviceName ?? '',
  };
}

/** สถานะสำหรับหน้าตั้งค่า (ไม่เรียก Beam — แสดงผลเร็ว) */
export function beamStatus() {
  const b = getSettings().beam;
  return {
    enabled: b.enabled,
    env: b.env,
    configured: beamReady(),
    methods: b.methods,
    requireManager: b.requireManager,
    timeoutSec: b.timeoutSec,
    connections: connectionsOfBranch().map((c) => ({
      terminalId: c.terminalId, deviceId: c.deviceId, deviceName: c.deviceName, env: c.env, createdAt: c.createdAt,
      /** ผูกไว้คนละโหมดกับที่ตั้งอยู่ตอนนี้ → ใช้ไม่ได้ ต้องผูกใหม่ */
      stale: c.env !== b.env,
    })),
  };
}
