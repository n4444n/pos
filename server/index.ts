// POS API + static web server — ไม่มี dependency ภายนอก (node:http + node:sqlite)
// รัน: node --experimental-strip-types server/index.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { db, DB_PATH, setBranch } from './core/db.ts';
import { getSettings } from './core/settings.ts';

import { apiKeyOf, authenticateKey } from './core/apikeys.ts';
import { listBranches } from './core/branches.ts';
import { authenticate, clientIp, login, logout, PIN_LENGTH, tokenOf, type Me } from './core/auth.ts';
import { type Ctx, bodyOfReq, branchOfReq, branchParam, json, meOfReq, readBody, resultOfReq, send } from './core/http.ts';

import { logRoutes } from './modules/log/routes.ts';
import { backupRoutes } from './modules/backup/routes.ts';
import { branchRoutes } from './modules/branch/routes.ts';
import { staffRoutes } from './modules/staff/routes.ts';
import { promoRoutes } from './modules/promo/routes.ts';
import { historyRoutes } from './modules/history/routes.ts';
import { stockRoutes } from './modules/stock/routes.ts';
import { taxRoutes } from './modules/tax/routes.ts';
import { settingsRoutes } from './modules/settings/routes.ts';
import { paymentRoutes } from './modules/payment/routes.ts';
import { reportRoutes } from './modules/report/routes.ts';
import { expenseRoutes } from './modules/expense/routes.ts';
import { shiftRoutes } from './modules/shift/routes.ts';
import { salesRoutes } from './modules/sales/routes.ts';
import { shippingRoutes } from './modules/shipping/routes.ts';
import { HttpError } from './core/common.ts';

import { internalAllowed, shopStats } from './core/internal.ts';
import { recordAudit } from './modules/log/auditLog.ts';

import { backupBuffer, backupFileName } from './modules/backup/backup.ts';
import { dataStamp, deviceByKey } from './modules/backup/autoBackup.ts';

import { readUpload } from './modules/stock/products.ts';

const PORT = Number(process.env.PORT ?? 3000);
const WEB_DIR = resolve(process.env.WEB_DIR ?? 'dist');

// ---------- http helpers ----------
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Branch, X-POS-Terminal',
      });
      return res.end();
    }
    if (path.startsWith('/api/')) {
      if (req.method === 'GET' && path === '/api/health') return json(req, res, 200, { ok: true }); // ไม่เปิดเผยที่อยู่ไฟล์ฐานข้อมูล

      // ----- API ภายใน (เซิร์ฟเวอร์ license เรียก) — ไม่มี token ที่ถูกต้อง = ไม่มีเส้นทางนี้ -----
      if (path.startsWith('/api/internal/')) {
        if (!internalAllowed(req)) throw new HttpError(404, 'Not found');
        if (req.method === 'GET' && path === '/api/internal/stats') return json(req, res, 200, shopStats());
        if (req.method === 'GET' && path === '/api/internal/backup') return send(req, res, 200, backupBuffer(branchParam(url)), 'application/vnd.sqlite3');
        throw new HttpError(404, 'Not found');
      }

      // ----- สำรองอัตโนมัติลงคอมของร้าน (แอปเดสก์ท็อป) — ใช้กุญแจของเครื่อง (X-Backup-Key) ไม่ต้องเข้าสู่ระบบ -----
      if (req.method === 'GET' && (path === '/api/backup/auto' || path === '/api/backup/auto/info')) {
        deviceByKey(String(req.headers['x-backup-key'] ?? ''), clientIp(req));
        if (path === '/api/backup/auto/info') {
          const branches = listBranches().map((b) => ({ id: b.id, name: b.name, code: b.code, isMain: b.isMain }));
          return json(req, res, 200, { shop: getSettings().shop.name, branches });
        }
        const branch = branchParam(url);
        // ข้อมูลไม่เปลี่ยนตั้งแต่รอบก่อน (แอปส่ง X-Backup-Since มา) → 304 ไม่ต้องสร้างไฟล์ซ้ำ
        const stamp = dataStamp();
        if (String(req.headers['x-backup-since'] ?? '') === stamp) {
          res.writeHead(304, { 'X-Backup-Stamp': stamp, 'Cache-Control': 'no-store' });
          return res.end();
        }
        const buf = backupBuffer(branch);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.sqlite3', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="backup.db"; filename*=UTF-8''${encodeURIComponent(backupFileName(branch))}`,
          'X-Content-Type-Options': 'nosniff', 'X-Backup-Stamp': stamp,
        });
        return res.end(buf);
      }

      // ----- เข้าสู่ระบบด้วย PIN (ไม่ต้องมี token) -----
      if (req.method === 'POST' && path === '/api/auth/login') {
        const body = (await readBody(req)) as { pin?: string };
        const r = login(body.pin, clientIp(req));
        meOfReq.set(req, r.staff);
        return json(req, res, 200, r);
      }
      if (req.method === 'GET' && path === '/api/auth/config') return json(req, res, 200, { pinLength: PIN_LENGTH, shop: { name: getSettings().shop.name } });

      // ----- ทุก API ด้านล่างต้องเข้าสู่ระบบ -----
      const apiKey = apiKeyOf(req);
      const me: Me = apiKey ? authenticateKey(apiKey, req.method ?? 'GET', req) : authenticate(req, url);
      // ข้อมูลทั้งหมดของ request นี้เป็นของสาขาที่เลือกไว้
      setBranch(me.branchId);
      branchOfReq.set(req, me.branchId);
      meOfReq.set(req, me);

      // ----- เส้นทางของแต่ละ module — โค้ดอยู่ที่ modules/<ชื่อ>/routes.ts -----
      // ลำดับสำคัญ 2 จุด (ต้องเหมือนก่อนแยก module): tax มาก่อน sales เพราะ /api/orders/:id/tax-invoice
      // ต้องชนก่อน /api/orders/:id · และ branch (รายชื่อสาขา/สลับสาขา) มาก่อน staff
      const c: Ctx = { req, res, url, path, method: req.method ?? 'GET', me };
      if (await logRoutes(c)) return;
      if (await backupRoutes(c)) return;
      if (await branchRoutes(c)) return;

      if (req.method === 'GET' && path === '/api/auth/me') return json(req, res, 200, me);
      if (req.method === 'POST' && path === '/api/auth/logout') return json(req, res, 200, logout(tokenOf(req, url)));

      if (await staffRoutes(c)) return;
      if (await promoRoutes(c)) return;
      if (await historyRoutes(c)) return;
      if (await stockRoutes(c)) return;
      if (await taxRoutes(c)) return;
      if (await settingsRoutes(c)) return;
      if (await paymentRoutes(c)) return;
      if (await shippingRoutes(c)) return;
      if (await reportRoutes(c)) return;
      if (await expenseRoutes(c)) return;
      if (await shiftRoutes(c)) return;
      if (await salesRoutes(c)) return;

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
    if (path.startsWith('/api/')) {
      console.log(`${req.method} ${path} ${res.statusCode} ${(performance.now() - started).toFixed(1)}ms`);
      // LOG: ทุกการกระทำที่เปลี่ยนข้อมูล + เข้า/ออกระบบ + ดาวน์โหลดไฟล์ (ไม่บันทึก token ใน query)
      const qs = new URLSearchParams(url.searchParams);
      qs.delete('token');
      recordAudit({
        method: req.method ?? 'GET', path, query: qs.toString(), status: res.statusCode, ip: clientIp(req),
        me: meOfReq.get(req) ?? null, branchId: branchOfReq.get(req) ?? null, body: bodyOfReq.get(req), result: resultOfReq.get(req),
      });
    }
  }
});

// POS_HOST=127.0.0.1 (บน VPS) = รับเฉพาะคำขอที่ผ่านประตูของเซิร์ฟเวอร์ license · ไม่ตั้ง = ทุกเครือข่าย (ใช้ในร้าน/LAN)
server.listen(PORT, process.env.POS_HOST || undefined, () => {
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
