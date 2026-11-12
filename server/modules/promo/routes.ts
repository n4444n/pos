// เส้นทาง API ของ module promo
import { json, readBody, type Ctx } from '../../core/http.ts';
import { requireFeature } from '../../core/auth.ts';
import { availablePromos, createPromo, deletePromo, listPromos, previewFor, updatePromo } from './promos.ts';
import { checkPromo } from '../sales/orders.ts';

export async function promoRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };

  // ----- โปรโมชั่น / ส่วนลด -----
  if (path === '/api/promos' && req.method === 'GET') { requireFeature(me, 'promos', 'view'); return ok(200, listPromos()); }
  if (path === '/api/promos' && req.method === 'POST') { requireFeature(me, 'promos', 'edit'); return ok(201, createPromo((await readBody(req)) as never)); }
  if (path === '/api/promos/available' && req.method === 'GET') {
    return ok(200, availablePromos(Math.max(0, Number(url.searchParams.get('subtotal') ?? 0) || 0)));
  }
  if (path === '/api/promos/preview' && req.method === 'GET') {
    return ok(200, previewFor(Math.max(0, Number(url.searchParams.get('subtotal') ?? 0) || 0)));
  }
  {
    const pc = /^\/api\/promos\/([A-Za-z0-9_-]{2,20})$/.exec(path);
    if (pc && req.method === 'PUT') { requireFeature(me, 'promos', 'edit'); return ok(200, updatePromo(pc[1].toUpperCase(), (await readBody(req)) as never)); }
    if (pc && req.method === 'DELETE') { requireFeature(me, 'promos', 'edit'); return ok(200, deletePromo(pc[1].toUpperCase())); }
  }
  if (req.method === 'GET' && path.startsWith('/api/promos/')) {
    const code = decodeURIComponent(path.slice('/api/promos/'.length));
    return ok(200, checkPromo(code, Number(url.searchParams.get('subtotal') ?? 0)));
  }

  return false;
}
