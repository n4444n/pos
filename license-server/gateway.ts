// ประตูเดียวเข้าทุกร้าน (โหมดทดสอบ) — เปิดผ่าน ngrok ได้ด้วยลิงก์เดียว
//
//   แอป .exe     ส่ง header  X-POS-Shop: <slug> + X-POS-Machine: <รหัสเครื่อง>
//                → ตรวจทุกคำขอว่าเครื่องยังลงทะเบียนกับ license ร้านนี้ (ลบเครื่องในแผงควบคุม = ใช้ไม่ได้ทันที)
//   เบราว์เซอร์   เฉพาะผู้ดูแลที่เข้าสู่ระบบแผงควบคุมแล้ว: เปิด /shop/<slug> → จำร้านไว้ใน cookie → หน้า POS ของร้านนั้น
//                (ใช้ตรวจร้านจากแผงควบคุม · คนทั่วไปเปิดผ่านเบราว์เซอร์ไม่ได้)
//
// ร้านที่ถูกระงับ/หมดอายุ/หยุดอยู่ → ตอบ 503 (แอปเช็ก license แล้วพากลับหน้าเปิดใช้งาน)
// บน VPS (PROVISIONER=systemd) ไม่ใช้ส่วนนี้ — แต่ละร้านมีโดเมนย่อยของตัวเองผ่าน Caddy
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { db, getInstance, getLicenseBySlug, isExpired, SLUG_RE } from './store.ts';
import { clientIp, cookie, json, redirect, SEC_HEADERS } from './http.ts';

export const SHOP_HEADER = 'x-pos-shop';
export const MACHINE_HEADER = 'x-pos-machine';
const SHOP_COOKIE = 'pos_shop';

/** ร้านที่คำขอนี้ต้องการ: แอป (header + รหัสเครื่อง) หรือผู้ดูแลผ่านเบราว์เซอร์ (cookie) */
export function shopOf(req: IncomingMessage): { slug: string; machine: string } | null {
  const h = String(req.headers[SHOP_HEADER] ?? '');
  if (h) return SLUG_RE.test(h) ? { slug: h, machine: String(req.headers[MACHINE_HEADER] ?? '') } : null;
  const c = cookie(req, SHOP_COOKIE);
  return SLUG_RE.test(c) ? { slug: c, machine: '' } : null;
}

const machineOk = db.prepare('SELECT 1 FROM machines WHERE license_id = ? AND machine_id = ?');

/** /shop/<slug> → จำร้านใน cookie แล้วไปหน้าแรกของร้าน · /shop/ → ลืมร้าน กลับแผงควบคุม */
export function selectShop(req: IncomingMessage, res: ServerResponse, slug: string, admin: boolean) {
  if (slug && !admin) return redirect(res, '/admin'); // เปิดร้านผ่านเบราว์เซอร์ = เฉพาะผู้ดูแล
  const secure = String(req.headers['x-forwarded-proto'] ?? '') === 'https' ? '; Secure' : '';
  if (!slug || !SLUG_RE.test(slug)) {
    return redirect(res, '/admin', { 'Set-Cookie': `${SHOP_COOKIE}=; Path=/; Max-Age=0` });
  }
  redirect(res, '/', { 'Set-Cookie': `${SHOP_COOKIE}=${slug}; Path=/; SameSite=Lax; HttpOnly; Max-Age=2592000${secure}` });
}

function unavailable(req: IncomingMessage, res: ServerResponse, message: string, code: string, status = 503) {
  if ((req.url ?? '').startsWith('/api/')) return json(res, status, { ok: false, error: message, code }, { 'X-POS-License': code });
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-POS-License': code, ...SEC_HEADERS });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ระบบร้านปิดอยู่</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f4f6fb;color:#1e293b">
<div style="text-align:center;max-width:420px;padding:24px"><h2>ระบบร้านปิดอยู่</h2><p>${message}</p>
<p><a href="/shop/">เลือกร้านอื่น / แผงควบคุม</a></p></div></body>`);
}

/**
 * ส่งคำขอต่อไปเซิร์ฟเวอร์ POS ของร้าน (สตรีมทั้งสองทาง — รองรับไฟล์ใหญ่และ server-sent events)
 * admin = ผู้ดูแลที่เข้าสู่ระบบแผงควบคุมแล้ว (เปิดผ่านเบราว์เซอร์ได้โดยไม่ต้องมีรหัสเครื่อง)
 */
export function proxyToShop(req: IncomingMessage, res: ServerResponse, shop: { slug: string; machine: string }, admin: boolean) {
  const { slug } = shop;
  const l = getLicenseBySlug(slug);
  const inst = getInstance(slug);
  if (!l || !inst) return unavailable(req, res, 'ไม่พบร้านนี้ หรือร้านยังไม่ได้เปิดใช้งาน license', 'NOT_FOUND');
  if (!admin && !(shop.machine && machineOk.get(l.id, shop.machine))) {
    return unavailable(req, res, 'เครื่องนี้ไม่ได้ลงทะเบียนกับ license ของร้านนี้แล้ว — กรอก license ใหม่อีกครั้ง', 'MACHINE_UNKNOWN', 403);
  }
  if (l.status === 'revoked') return unavailable(req, res, 'license ของร้านนี้ถูกระงับ — ติดต่อผู้ขาย', 'REVOKED');
  if (isExpired(l)) return unavailable(req, res, 'license ของร้านนี้หมดอายุแล้ว — ติดต่อผู้ขายเพื่อต่ออายุ', 'EXPIRED');
  if (inst.state !== 'running') return unavailable(req, res, 'ระบบร้านถูกหยุดไว้ชั่วคราว', 'STOPPED');

  // API ภายในของร้าน (สถิติ/สำรองข้อมูล) ใช้ได้จากเซิร์ฟเวอร์ license เท่านั้น
  if (/^\/api\/internal(\/|$)/i.test(new URL(req.url ?? '/', 'http://x').pathname)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end('{"error":"Not found"}');
  }
  const headers = { ...req.headers };
  delete headers['x-pos-internal'];
  delete headers[SHOP_HEADER];
  delete headers[MACHINE_HEADER];
  // ไม่ส่ง cookie ของแผงควบคุมต่อให้ระบบร้าน
  if (headers.cookie) headers.cookie = String(headers.cookie).split(/;\s*/).filter((c) => !c.startsWith('lic_admin=')).join('; ');
  headers['x-forwarded-for'] = clientIp(req);
  headers['x-forwarded-proto'] ??= 'http';
  headers['x-forwarded-host'] ??= req.headers.host ?? '';

  const up = request({ host: '127.0.0.1', port: inst.port, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => {
    if (res.headersSent) res.destroy();
    else unavailable(req, res, 'ติดต่อระบบร้านไม่ได้ (เซิร์ฟเวอร์ร้านไม่ตอบ)', 'STOPPED');
  });
  req.on('aborted', () => up.destroy());
  res.on('close', () => up.destroy());
  req.pipe(up);
}
