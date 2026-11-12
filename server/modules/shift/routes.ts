// เส้นทาง API ของ module shift
import { json, readBody, type Ctx } from '../../core/http.ts';
import { emit } from '../notify/events.ts';
import { cashMove, closeShift, currentShift, listShifts, openShift, shiftDetail } from './shifts.ts';

export async function shiftRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };

  // ----- กะการขาย -----
  if (path === '/api/shifts/current' && req.method === 'GET') return ok(200, currentShift());
  if (path === '/api/shifts/open' && req.method === 'POST') {
    const sh = openShift({ ...((await readBody(req)) as object), staff: me.name });
    emit('shift.opened', { shiftNo: sh.shiftNo, openingCash: sh.openingCash, openedBy: sh.openedBy, staff: me.name });
    return ok(201, sh);
  }
  if (path === '/api/shifts/current/cash' && req.method === 'POST') {
    const b = (await readBody(req)) as { kind?: string; amount?: number; reason?: string };
    const out = cashMove({ ...b, staff: me.name });
    emit('cash.moved', { kind: b.kind, amount: Number(b.amount), reason: b.reason ?? '', staff: me.name, shiftNo: out.shift?.shiftNo });
    return ok(201, out);
  }
  if (path === '/api/shifts/current/close' && req.method === 'POST') {
    const closed = closeShift({ ...((await readBody(req)) as object), staff: me.name }) as Record<string, unknown>;
    emit('shift.closed', closed);
    return ok(200, closed);
  }
  if (path === '/api/shifts' && req.method === 'GET') {
    const p = url.searchParams;
    return ok(200, listShifts({
      from: p.get('from') ?? undefined, to: p.get('to') ?? undefined,
      limit: Number(p.get('limit') ?? 50), offset: Number(p.get('offset') ?? 0),
    }));
  }
  const sm = path.match(/^\/api\/shifts\/(\d+)$/);
  if (sm && req.method === 'GET') return ok(200, shiftDetail(Number(sm[1])));

  return false;
}
