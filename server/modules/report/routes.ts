// เส้นทาง API ของ module report
import { json, send, type Ctx } from '../../core/http.ts';
import { requireFeature } from '../../core/auth.ts';
import { currentBranchInfo } from '../../core/branches.ts';
import { currentBranch, setBranch } from '../../core/db.ts';
import { XLSX_TYPE } from '../../core/xlsx.ts';
import { dashboard, dashboardCsv } from './dashboard.ts';
import { daySummary } from './dayreport.ts';
import { reportXlsx } from './reportExport.ts';
import { billReport, billReportXlsx, productReport, productReportXlsx, salesReport, salesReportXlsx } from './reports.ts';

export async function reportRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };
  const raw = (s: number, b: Buffer | string, t: string, c?: string) => { send(req, res, s, b, t, c); return true; };

  // ----- รายงาน / Dashboard (ผู้จัดการ) -----
  if ((path === '/api/dashboard' || path === '/api/dashboard.csv' || path === '/api/dashboard.xlsx') && req.method === 'GET') {
    requireFeature(me, 'reports', 'view');
    const f = { from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined };
    // ?branch=all = รวมทุกสาขา · ?branch=<id> = สาขาที่เลือก
    const bq = url.searchParams.get('branch');
    if (bq === 'all') setBranch(0);
    else if (bq && me.branchIds.includes(Number(bq))) setBranch(Number(bq));
    if (path === '/api/dashboard') return ok(200, dashboard(f));
    if (path === '/api/dashboard.xlsx') {
      const d = dashboard(f);
      const bName = currentBranchInfo().name;
      const scope = currentBranch() === 0 ? 'รวมทุกสาขา' : bName.startsWith('สาขา') ? bName : `สาขา ${bName}`;
      res.setHeader('Content-Disposition', `attachment; filename="report-${d.range.from}-to-${d.range.to}.xlsx"`);
      return raw(200, reportXlsx(f, scope), XLSX_TYPE);
    }
    res.setHeader('Content-Disposition', `attachment; filename="report-${f.from ?? ''}-${f.to ?? ''}.csv"`);
    return raw(200, dashboardCsv(f), 'text/csv; charset=utf-8');
  }

  // ----- รายงานย่อย: ยอดขาย / สินค้า (ผู้จัดการ) -----
  {
    const rm = /^\/api\/reports\/(sales|products|bills)(\.xlsx)?$/.exec(path);
    if (rm && req.method === 'GET') {
      requireFeature(me, 'reports', 'view');
      const sp = url.searchParams;
      const bq = sp.get('branch');
      if (bq === 'all') setBranch(0);
      else if (bq && me.branchIds.includes(Number(bq))) setBranch(Number(bq));
      const f = Object.fromEntries(sp.entries()) as Record<string, string>;
      if (!rm[2]) return ok(200, rm[1] === 'sales' ? salesReport(f) : rm[1] === 'bills' ? billReport(f) : productReport(f));
      const bName = currentBranchInfo().name;
      const scope = currentBranch() === 0 ? 'รวมทุกสาขา' : bName.startsWith('สาขา') ? bName : `สาขา ${bName}`;
      if (rm[1] === 'bills') {
        const r = billReport({ ...f, limit: 1 }).range;
        res.setHeader('Content-Disposition', `attachment; filename="bills-report-${r.from}-to-${r.to}.xlsx"`);
        return raw(200, billReportXlsx(f, scope, currentBranch() === 0), XLSX_TYPE);
      }
      const r = rm[1] === 'sales' ? salesReport(f).range : { from: f.from ?? '', to: f.to ?? '' };
      res.setHeader('Content-Disposition', `attachment; filename="${rm[1]}-report-${r.from}-to-${r.to}.xlsx"`);
      return raw(200, rm[1] === 'sales' ? salesReportXlsx(f, scope) : productReportXlsx(f, scope), XLSX_TYPE);
    }
  }

  if (path === '/api/reports/day' && req.method === 'GET') return ok(200, daySummary(url.searchParams.get('date') ?? undefined));

  return false;
}
