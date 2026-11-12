// เส้นทาง API ของ module stock
import { json, send, readBody, type Ctx } from '../../core/http.ts';
import { requireFeature } from '../../core/auth.ts';
import { requireMain } from '../../core/branches.ts';
import { currentBranch, mainBranchId } from '../../core/db.ts';
import { XLSX_TYPE } from '../../core/xlsx.ts';
import { importProducts } from './productImport.ts';
import { bulkProducts, bulkUpdateSkus, createCategory, getProduct, listCategories, listProducts, listSkus, patchVariant, saveBranchStock, saveProduct, saveUpload, saveUploadVariants, setProductActive, stockCommand, stockSummary, uploadsMissingVariants } from './products.ts';
import { stockXlsx } from './stockExport.ts';

export async function stockRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };
  const raw = (s: number, b: Buffer | string, t: string, c?: string) => { send(req, res, s, b, t, c); return true; };

  // ----- สต็อกสินค้า -----
  if (path === '/api/products' && req.method === 'GET') {
    const p = url.searchParams;
    return ok(200, listProducts({ q: p.get('q') ?? undefined, category: p.get('category') ?? undefined, status: p.get('status') ?? undefined }, me));
  }
  if (path === '/api/products' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); requireMain(); return ok(201, saveProduct(null, (await readBody(req)) as never, me)); }
  if (path === '/api/products/import' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); requireMain(); return ok(200, importProducts((await readBody(req, 8_000_000)) as never, me)); }
  if (path === '/api/stock/alerts' && req.method === 'GET') return ok(200, stockSummary());
  // ส่งออกสต็อก (Excel) — ชีตแรกนำเข้ากลับได้ที่ "นำเข้าสินค้า" · ?branch=all (ผู้จัดการ) = เพิ่มชีตสต็อกทุกสาขา
  if (path === '/api/stock/export.xlsx' && req.method === 'GET') {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    res.setHeader('Content-Disposition', `attachment; filename="stock-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.xlsx"`);
    return raw(200, stockXlsx(me), XLSX_TYPE);
  }

  if (path === '/api/products/bulk' && req.method === 'POST') {
    requireFeature(me, 'stock', 'edit');
    const body = (await readBody(req)) as { action?: string };
    if (body.action !== 'zero') requireMain(); // ล้างสต็อก = เฉพาะสาขานี้ · อย่างอื่นเปลี่ยนสินค้าทุกสาขา
    return ok(200, bulkProducts(body as never, me));
  }

  if (path === '/api/stock/command' && req.method === 'POST') return ok(200, stockCommand((await readBody(req, 2_000_000)) as never, me));
  if (path === '/api/stock/skus' && req.method === 'GET') {
    const sp = url.searchParams;
    const g = (k: string) => sp.get(k) ?? undefined;
    return ok(200, listSkus({ q: g('q'), category: g('category'), status: g('status'), sort: g('sort'), dir: g('dir'), page: g('page'), limit: g('limit') }, me));
  }
  {
    const vm = /^\/api\/variants\/(\d+)$/.exec(path);
    if (vm && req.method === 'PATCH') return requireMain(), ok(200, patchVariant(Number(vm[1]), (await readBody(req)) as { barcode?: string; active?: boolean }, me));
  }
  if (path === '/api/categories' && req.method === 'GET') return ok(200, listCategories());
  if (path === '/api/categories' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); requireMain(); return ok(201, createCategory((await readBody(req)) as never)); }
  if (path === '/api/uploads' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); return ok(201, saveUpload((await readBody(req, 6_000_000)) as never)); }
  if (path === '/api/uploads/variants' && req.method === 'GET') { requireFeature(me, 'stock', 'edit'); return ok(200, { urls: uploadsMissingVariants() }); }
  if (path === '/api/uploads/variants' && req.method === 'POST') { requireFeature(me, 'stock', 'edit'); return ok(200, saveUploadVariants((await readBody(req, 3_000_000)) as never)); }
  {
    const bm = /^\/api\/products\/(\d+)\/skus$/.exec(path);
    if (bm && req.method === 'PUT') { requireFeature(me, 'stock', 'edit'); return ok(200, bulkUpdateSkus(Number(bm[1]), (await readBody(req)) as never, me)); }
  }
  const pm = path.match(/^\/api\/products\/(\d+)(\/active)?$/);
  if (pm) {
    const pid = Number(pm[1]);
    if (!pm[2] && req.method === 'GET') return ok(200, getProduct(pid, me));
    if (!pm[2] && req.method === 'PUT') {
      requireFeature(me, 'stock', 'edit');
      const body = (await readBody(req)) as never;
      // สาขาย่อย: บันทึกได้เฉพาะจำนวน/ราคาขายของสาขา · สาขาหลัก: แก้สินค้าได้ทั้งหมด
      return ok(200, currentBranch() === mainBranchId() ? saveProduct(pid, body, me) : saveBranchStock(pid, body, me));
    }
    if (pm[2] && req.method === 'PUT') { requireFeature(me, 'stock', 'edit'); requireMain(); return ok(200, setProductActive(pid, !!((await readBody(req)) as { active?: boolean }).active)); }
  }

  return false;
}
