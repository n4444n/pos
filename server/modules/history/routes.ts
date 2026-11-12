// เส้นทาง API ของ module history
import { json, send, type Ctx } from '../../core/http.ts';
import { history, historyCsv, type HistoryQuery } from './history.ts';

export async function historyRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };
  const raw = (s: number, b: Buffer | string, t: string, c?: string) => { send(req, res, s, b, t, c); return true; };

  // ----- ประวัติการขาย / แก้ไขบิล -----
  if (req.method === 'GET' && (path === '/api/history' || path === '/api/history.csv')) {
    const p = url.searchParams;
    const f: HistoryQuery = {
      from: p.get('from') ?? undefined, to: p.get('to') ?? undefined,
      timeFrom: p.get('timeFrom') ?? undefined, timeTo: p.get('timeTo') ?? undefined,
      q: p.get('q') ?? undefined, status: p.get('status') ?? undefined, payment: p.get('payment') ?? undefined,
      limit: Number(p.get('limit') ?? 50), offset: Number(p.get('offset') ?? 0),
    };
    if (path === '/api/history') return ok(200, history(f));
    res.setHeader('Content-Disposition', `attachment; filename="sales-${f.from ?? 'all'}-${f.to ?? 'all'}.csv"`);
    return raw(200, historyCsv(f), 'text/csv; charset=utf-8');
  }

  return false;
}
