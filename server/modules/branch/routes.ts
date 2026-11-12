// เส้นทาง API ของ module branch
import { json, readBody, type Ctx } from '../../core/http.ts';
import { requireFeature, switchBranch } from '../../core/auth.ts';
import { createBranch, deleteBranches, getBranch, listBranches, nextCode, resetBranchPrices, updateBranch } from '../../core/branches.ts';
import { mainBranchId } from '../../core/db.ts';

export async function branchRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };

  // ----- สาขา: สาขาที่เข้าได้ + สลับสาขา -----
  if (path === '/api/branches' && req.method === 'GET') {
    const list = listBranches().filter((b) => me.branchIds.includes(b.id)).map((b) => ({ ...b, current: b.id === me.branchId }));
    return ok(200, { current: list.find((b) => b.current) ?? null, list });
  }
  if (path === '/api/branches/switch' && req.method === 'POST') {
    return ok(200, switchBranch(req, url, me, ((await readBody(req)) as { id?: unknown }).id));
  }

  // ----- จัดการสาขา (ผู้จัดการ) -----
  if (path === '/api/branches/manage' && req.method === 'GET') {
    requireFeature(me, 'branches', 'view');
    return ok(200, { currentId: me.branchId, mainId: mainBranchId(), nextCode: nextCode(), list: listBranches() });
  }
  if (path === '/api/branches' && req.method === 'POST') { requireFeature(me, 'branches', 'edit'); return ok(201, createBranch((await readBody(req)) as never)); }
  if (path === '/api/branches/delete' && req.method === 'POST') { requireFeature(me, 'branches', 'edit'); return ok(200, deleteBranches(((await readBody(req)) as { ids?: unknown }).ids)); }
  if (path === '/api/branches/reset-prices' && req.method === 'POST') { requireFeature(me, 'branches', 'edit'); return ok(200, resetBranchPrices(((await readBody(req)) as { variantIds?: unknown }).variantIds)); }
  {
    const bm = /^\/api\/branches\/(\d+)$/.exec(path);
    if (bm && req.method === 'PUT') { requireFeature(me, 'branches', 'edit'); return ok(200, updateBranch(Number(bm[1]), (await readBody(req)) as never)); }
    if (bm && req.method === 'GET') { requireFeature(me, 'branches', 'view'); return ok(200, getBranch(Number(bm[1]))); }
  }

  return false;
}
