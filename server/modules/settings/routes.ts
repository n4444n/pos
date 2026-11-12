// เส้นทาง API ของ module settings
import { json, readBody, type Ctx } from '../../core/http.ts';
import { createKey, listKeys, revokeKey } from '../../core/apikeys.ts';
import { requireFeature } from '../../core/auth.ts';
import { billNoSettings, saveBillNo } from '../../core/billNo.ts';
import { forAdmin, getSettings, saveSection } from '../../core/settings.ts';
import { notifyCatalog, testNotify } from '../notify/events.ts';

export async function settingsRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };

  if (path === '/api/billno' && req.method === 'GET') { requireFeature(me, 'settings', 'view'); return ok(200, billNoSettings()); }
  if (path === '/api/billno' && req.method === 'PUT') { requireFeature(me, 'settings', 'edit'); return ok(200, saveBillNo((await readBody(req)) as Record<string, unknown>)); }

  if (path === '/api/settings' && req.method === 'GET') { requireFeature(me, 'settings', 'view'); return ok(200, { settings: forAdmin(), keys: listKeys() }); }
  {
    const sm2 = /^\/api\/settings\/([a-z]+)$/.exec(path);
    if (sm2 && req.method === 'PUT') {
      requireFeature(me, 'settings', 'edit');
      let body = (await readBody(req)) as Record<string, unknown>;
      if (sm2[1] === 'stock') body = { ...body, sync: getSettings().stock.sync };
      return ok(200, { settings: saveSection(sm2[1], body) });
    }
  }
  if (path === '/api/settings/notify/test' && req.method === 'POST') {
    requireFeature(me, 'settings', 'edit');
    const b = (await readBody(req)) as { channel?: string; event?: string };
    return ok(200, await testNotify(String(b.channel ?? ''), b.event ? String(b.event) : undefined));
  }
  if (path === '/api/settings/notify/catalog' && req.method === 'GET') { requireFeature(me, 'settings', 'view'); return ok(200, notifyCatalog()); }
  if (path === '/api/settings/keys' && req.method === 'POST') { requireFeature(me, 'settings', 'edit'); return ok(201, createKey((await readBody(req)) as never, me)); }
  {
    const km = /^\/api\/settings\/keys\/(\d+)$/.exec(path);
    if (km && req.method === 'DELETE') { requireFeature(me, 'settings', 'edit'); return ok(200, revokeKey(Number(km[1]))); }
  }

  return false;
}
