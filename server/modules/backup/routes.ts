// เส้นทาง API ของ module backup
import { json, readBody, branchParam, receiveFile, type Ctx } from '../../core/http.ts';
import { approveManager, clientIp, requireFeature } from '../../core/auth.ts';
import { HttpError } from '../../core/common.ts';
import { createDevice, listDevices, revokeDevice } from './autoBackup.ts';
import { backupBuffer, backupFileName, dropUpload, newUploadPath, previewUpload, restoreBranches } from './backup.ts';

export async function backupRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };

  // ----- สำรอง / กู้คืนข้อมูล (ผู้จัดการ) -----
  if (path.startsWith('/api/backup/')) {
    requireFeature(me, 'settings', 'edit');
    if (req.method === 'GET' && path === '/api/backup/download') {
      const branch = branchParam(url);
      const buf = backupBuffer(branch);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.sqlite3', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="backup.db"; filename*=UTF-8''${encodeURIComponent(backupFileName(branch))}`,
        'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff',
      });
      res.end(buf); return true;
    }
    if (req.method === 'POST' && path === '/api/backup/upload') {
      const up = newUploadPath();
      await receiveFile(req, up.path, 500 * 1024 * 1024);
      try {
        return ok(200, previewUpload(up.id));
      } catch (e) {
        dropUpload(up.id);
        throw e;
      }
    }
    if (req.method === 'POST' && path === '/api/backup/restore') {
      const body = (await readBody(req)) as { id?: string; branchIds?: unknown; pin?: string };
      const by = approveManager(body.pin, clientIp(req), 'settings');
      const ids = Array.isArray(body.branchIds) ? body.branchIds.map(Number).filter(Number.isInteger) : [];
      return ok(200, restoreBranches(String(body.id ?? ''), ids, by));
    }
    // เครื่องที่สำรองอัตโนมัติ (ออกกุญแจ / รายการ / ยกเลิก)
    if (req.method === 'GET' && path === '/api/backup/devices') return ok(200, listDevices());
    if (req.method === 'POST' && path === '/api/backup/devices') {
      const body = (await readBody(req)) as { name?: string };
      return ok(201, createDevice(body.name, me.name));
    }
    if (req.method === 'POST' && path === '/api/backup/devices/revoke') {
      const body = (await readBody(req)) as { id?: number };
      revokeDevice(body.id);
      return ok(200, { ok: true });
    }
    if (req.method === 'POST' && path === '/api/backup/discard') {
      const body = (await readBody(req)) as { id?: string };
      if (/^[a-f0-9]{24}$/.test(String(body.id))) dropUpload(String(body.id));
      return ok(200, { ok: true });
    }
    throw new HttpError(404, 'Not found');
  }

  return false;
}
