// เส้นทาง API ของ module log
import { json, send, type Ctx } from '../../core/http.ts';
import { XLSX_TYPE } from '../../core/xlsx.ts';
import { listActivity } from './activity.ts';
import { listLogs, logsXlsx, requireLogAccess } from './auditLog.ts';

export async function logRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };
  const raw = (s: number, b: Buffer | string, t: string, c?: string) => { send(req, res, s, b, t, c); return true; };

  // ----- LOG: บันทึกการใช้งาน (ผู้ดูแลระบบเท่านั้น) -----
  if ((path === '/api/logs' || path === '/api/logs.xlsx') && req.method === 'GET') {
    requireLogAccess(me);
    const f = Object.fromEntries(url.searchParams.entries());
    if (path === '/api/logs') return ok(200, listLogs(f));
    const { file, range } = logsXlsx(f);
    res.setHeader('Content-Disposition', `attachment; filename="log-${range.from}-to-${range.to}.xlsx"`);
    return raw(200, file, XLSX_TYPE);
  }

  // ----- กิจกรรมของร้านสำหรับแอปมือถือ (คัดจาก LOG · สิทธิ์ตามเมนู · ไม่ส่งข้อมูลดิบ) -----
  if (path === '/api/activity' && req.method === 'GET') {
    const p = url.searchParams;
    return ok(200, listActivity(me, { since: p.get('since'), limit: p.get('limit'), topics: p.get('topics'), minSale: p.get('minSale') }));
  }

  return false;
}
