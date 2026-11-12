// เส้นทาง API ของ module staff
import { json, readBody, type Ctx } from '../../core/http.ts';
import { createStaff, listStaff, requireFeature, updateStaff } from '../../core/auth.ts';
import { permCatalog, resetPerms, savePerms } from '../../core/perms.ts';

export async function staffRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };

  // ----- จัดการพนักงาน (ผู้จัดการ) -----
  // ----- สิทธิ์ตามบทบาท (ดูได้ถ้าเปิดเมนูพนักงานได้ · แก้ได้เฉพาะคนที่แก้เมนูพนักงานได้) -----
  if (path === '/api/perms' && req.method === 'GET') { requireFeature(me, 'staff', 'view'); return ok(200, permCatalog()); }
  {
    const pm = /^\/api\/perms\/([a-z]+)(\/reset)?$/.exec(path);
    if (pm && req.method === 'PUT' && !pm[2]) {
      requireFeature(me, 'staff', 'edit');
      return ok(200, savePerms(pm[1], ((await readBody(req)) as { perms?: Record<string, string> }).perms ?? {}));
    }
    if (pm && req.method === 'POST' && pm[2]) { requireFeature(me, 'staff', 'edit'); return ok(200, resetPerms(pm[1])); }
  }
  if (path === '/api/staff' && req.method === 'GET') { requireFeature(me, 'staff', 'view'); return ok(200, listStaff()); }
  if (path === '/api/staff' && req.method === 'POST') { requireFeature(me, 'staff', 'edit'); return ok(201, createStaff((await readBody(req)) as never, me)); }
  const st = path.match(/^\/api\/staff\/(\d+)$/);
  if (st && req.method === 'PUT') { requireFeature(me, 'staff', 'edit'); return ok(200, updateStaff(Number(st[1]), (await readBody(req)) as never, me)); }

  return false;
}
