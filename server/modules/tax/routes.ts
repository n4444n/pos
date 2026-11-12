// เส้นทาง API ของ module tax
import { json, send, readBody, type Ctx } from '../../core/http.ts';
import { approveVoid, clientIp, requireFeature } from '../../core/auth.ts';
import { currentBranch, mainBranchId, setBranch } from '../../core/db.ts';
import { XLSX_TYPE } from '../../core/xlsx.ts';
import { emit } from '../notify/events.ts';
import { addRate, addTerminal, deleteRate, deleteTerminal, saveBranchTax, saveTaxCompany, taxAdmin, updateRate, updateTerminal } from './tax.ts';
import { cancelTaxInvoice, createCreditNote, creditNoteDoc, issueTaxInvoice, taxInvoiceDoc } from './taxDocs.ts';
import { taxReport, taxReportXlsx } from './taxReport.ts';

export async function taxRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };
  const raw = (s: number, b: Buffer | string, t: string, c?: string) => { send(req, res, s, b, t, c); return true; };

  // ----- ตั้งค่า (ผู้จัดการ) -----
  // ----- ภาษีมูลค่าเพิ่ม (ผู้จัดการ) -----
  if (path.startsWith('/api/tax')) {
    // เครื่องนี้เลือกเครื่อง POS ได้ทุกคน (ดูรายการเครื่องของสาขา)
    if (path === '/api/tax/terminals' && req.method === 'GET') {
      const b = currentBranch() || mainBranchId();
      return ok(200, taxAdmin().terminals.filter((t) => t.branchId === b && t.active));
    }
    requireFeature(me, 'settings', 'edit');
    if (path === '/api/tax' && req.method === 'GET') return ok(200, taxAdmin());
    if (path === '/api/tax/company' && req.method === 'PUT') return ok(200, saveTaxCompany((await readBody(req)) as never));
    if (path === '/api/tax/rates' && req.method === 'POST') return ok(201, addRate((await readBody(req)) as never, me.name));
    if (path === '/api/tax/terminals' && req.method === 'POST') return ok(201, addTerminal((await readBody(req)) as never));
    const tm = /^\/api\/tax\/(branches|rates|terminals)\/(\d+)$/.exec(path);
    if (tm) {
      const id = Number(tm[2]);
      if (tm[1] === 'branches' && req.method === 'PUT') return ok(200, saveBranchTax(id, (await readBody(req)) as never));
      if (tm[1] === 'rates' && req.method === 'PUT') return ok(200, updateRate(id, (await readBody(req)) as never));
      if (tm[1] === 'rates' && req.method === 'DELETE') return ok(200, deleteRate(id));
      if (tm[1] === 'terminals' && req.method === 'PUT') return ok(200, updateTerminal(id, (await readBody(req)) as never));
      if (tm[1] === 'terminals' && req.method === 'DELETE') return ok(200, deleteTerminal(id));
    }
    // รายงานภาษีขาย: สรุปรายวันต่อเครื่อง + รายบิล + บิลยกเลิก (+ Excel)
    if ((path === '/api/tax/report' || path === '/api/tax/report.xlsx') && req.method === 'GET') {
      const sp = url.searchParams;
      const bq = sp.get('branch');
      if (bq === 'all') setBranch(0);
      else if (bq && me.branchIds.includes(Number(bq))) setBranch(Number(bq));
      const f = Object.fromEntries(sp.entries()) as Record<string, string>;
      if (path === '/api/tax/report') return ok(200, taxReport(f));
      const { file, range } = taxReportXlsx(f);
      res.setHeader('Content-Disposition', `attachment; filename="sales-tax-report-${range.from}-to-${range.to}.xlsx"`);
      return raw(200, file, XLSX_TYPE);
    }
  }

  // ----- ใบกำกับภาษีเต็มรูป / ใบลดหนี้ (taxDocs.ts) -----
  const td = path.match(/^\/api\/orders\/(\d+)\/(tax-invoice|credit-note)$/);
  if (td && req.method === 'POST') {
    const body = (await readBody(req)) as Record<string, unknown>;
    if (td[2] === 'tax-invoice') return ok(201, issueTaxInvoice(Number(td[1]), body, me.name));
    // รับคืนสินค้า = คืนเงิน → ยืนยันด้วย PIN ผู้มีสิทธิ์ยกเลิกบิล (เหมือนยกเลิกบิล)
    const approver = approveVoid(body.pin as string | undefined, clientIp(req));
    const out = createCreditNote(Number(td[1]), body, { operator: me.name, approver: approver.name });
    emit('order.edited', { id: out.orderId, orderNo: out.orderNo, oldTotal: out.orderTotal, newTotal: out.orderTotal, diff: -out.total, reason: `ใบลดหนี้ ${out.docNo} · ${out.reason}`, staff: me.name });
    return ok(201, out);
  }
  const tv = path.match(/^\/api\/tax-invoices\/(\d+)(\/cancel)?$/);
  if (tv) {
    if (!tv[2] && req.method === 'GET') return ok(200, taxInvoiceDoc(Number(tv[1])));
    if (tv[2] && req.method === 'POST') {
      requireFeature(me, 'taxReport', 'edit');
      const body = (await readBody(req)) as { reason?: string };
      return ok(200, cancelTaxInvoice(Number(tv[1]), body.reason, me.name));
    }
  }
  const cn = path.match(/^\/api\/credit-notes\/(\d+)$/);
  if (cn && req.method === 'GET') return ok(200, creditNoteDoc(Number(cn[1])));

  return false;
}
