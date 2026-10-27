// ตัวช่วย HTTP ที่ใช้ร่วมกัน (ไม่มี dependency ภายนอก)
import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };

export function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...headers });
  res.end(JSON.stringify(data));
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export function readBody(req: IncomingMessage, limit = 16_000): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new HttpError(413, 'ข้อมูลใหญ่เกินไป'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        fail(new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'));
      }
    });
    req.on('error', fail);
  });
}

export const clientIp = (req: IncomingMessage) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';

/** ที่อยู่สาธารณะที่ผู้ใช้เห็น — ผ่าน ngrok/Caddy ได้ https://<โดเมน> · เปิดตรงได้ http://localhost:3100 */
export function publicBase(req: IncomingMessage) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

/** ค่าทุกตัวของ cookie ชื่อนี้ (เบราว์เซอร์ส่งซ้ำได้เมื่อมีหลาย Path) */
export function cookies(req: IncomingMessage, name: string) {
  const out: string[] = [];
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'g');
  for (const m of String(req.headers.cookie ?? '').matchAll(re)) out.push(decodeURIComponent(m[1]));
  return out;
}

export function cookie(req: IncomingMessage, name: string) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(String(req.headers.cookie ?? ''));
  return m ? decodeURIComponent(m[1]) : '';
}

export const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
export function int(v: unknown, min: number, max: number) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `ค่าต้องอยู่ระหว่าง ${min}–${max}`);
  return n;
}

/** กันเดา license / รหัสผ่าน: ผิดเกิน 10 ครั้งใน 10 นาที → พัก (ต่อ IP) */
const fails = new Map<string, { n: number; until: number }>();
export function guard(ip: string) {
  const f = fails.get(ip);
  if (f && f.n >= 10 && f.until > Date.now()) throw new HttpError(429, 'ลองผิดหลายครั้งเกินไป กรุณารอ 10 นาที');
}
export function failed(ip: string) {
  const f = fails.get(ip);
  const fresh = !f || f.until < Date.now();
  fails.set(ip, { n: fresh ? 1 : f!.n + 1, until: Date.now() + 10 * 60_000 });
}

/** ล้างรายการที่หมดเวลาแล้ว (กันหน่วยความจำโตไม่หยุดเมื่อมีคนลองสุ่มจากหลาย IP) */
export function pruneGuards() {
  const now = Date.now();
  for (const [ip, f] of fails) if (f.until < now) fails.delete(ip);
}

/** ทำงานกับ key เดียวกันทีละงาน (กันกดเปิดใช้งานพร้อมกัน 2 เครื่องแล้วสร้างร้านซ้ำ) */
const locks = new Map<string, Promise<unknown>>();
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next.finally(() => locks.get(key) === next && locks.delete(key)).catch(() => {});
  return next;
}
