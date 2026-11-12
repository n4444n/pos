// เส้นทาง API ของ module expense
import { json, send, readBody, type Ctx } from '../../core/http.ts';
import { allBranchRole, requireFeature } from '../../core/auth.ts';
import { setBranch } from '../../core/db.ts';
import { XLSX_TYPE } from '../../core/xlsx.ts';
import { EXPENSE_SOURCES, createExpense, drawerLedger, expenseCategories, expensesCsv, expensesXlsx, listExpenses, recentShifts, saveExpenseCategories, type ExpenseQuery, updateExpense, voidExpense } from './expenses.ts';
import { emit } from '../notify/events.ts';

export async function expenseRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };
  const raw = (s: number, b: Buffer | string, t: string, c?: string) => { send(req, res, s, b, t, c); return true; };

  // ----- ค่าใช้จ่าย & สมุดลิ้นชัก -----
  if ((path === '/api/expenses' || path === '/api/expenses.csv' || path === '/api/expenses.xlsx') && req.method === 'GET') {
    const sp = url.searchParams;
    const f: ExpenseQuery = {
      from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, category: sp.get('category') ?? undefined,
      source: sp.get('source') ?? undefined, q: sp.get('q') ?? undefined, voided: sp.get('voided') ?? undefined,
    };
    if (sp.get('branch') === 'all' && allBranchRole(me.role)) setBranch(0);
    if (path === '/api/expenses') return ok(200, listExpenses(f));
    if (path === '/api/expenses.xlsx') {
      res.setHeader('Content-Disposition', `attachment; filename="expenses-${f.from ?? ''}-${f.to ?? ''}.xlsx"`);
      return raw(200, expensesXlsx(f), XLSX_TYPE);
    }
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${f.from ?? ''}-${f.to ?? ''}.csv"`);
    return raw(200, expensesCsv(f), 'text/csv; charset=utf-8');
  }
  if (path === '/api/expenses' && req.method === 'POST') {
    const e = createExpense((await readBody(req)) as never, me.name);
    const cats = expenseCategories();
    const names = [...new Set((e.items ?? []).map((i) => cats.find((c) => c.id === i.category)?.name ?? i.category))];
    emit('expense.created', { ...e, categoryName: names.join(', ') || e.category, sourceName: EXPENSE_SOURCES[e.source] ?? e.source, staff: me.name });
    return ok(201, e);
  }
  if (path === '/api/expenses/categories' && req.method === 'PUT') {
    requireFeature(me, 'expenses', 'edit');
    return ok(200, saveExpenseCategories(await readBody(req)));
  }
  if (path === '/api/expenses/drawer' && req.method === 'GET') {
    const id = Number(url.searchParams.get('shift') ?? 0) || undefined;
    return ok(200, { ...drawerLedger(id), shifts: recentShifts() });
  }
  {
    const em = /^\/api\/expenses\/(\d+)(\/void)?$/.exec(path);
    if (em && !em[2] && req.method === 'PUT') { requireFeature(me, 'expenses', 'edit'); return ok(200, updateExpense(Number(em[1]), (await readBody(req)) as never, me.name)); }
    if (em && em[2] && req.method === 'POST') {
      requireFeature(me, 'expenses', 'view');
      const b = (await readBody(req)) as { reason?: string };
      return ok(200, voidExpense(Number(em[1]), String(b.reason ?? ''), me.name));
    }
  }

  return false;
}
