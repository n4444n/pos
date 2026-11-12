// เส้นทาง API ของ module sales
import { json, readBody, type Ctx } from '../../core/http.ts';
import { approveVoid, clientIp } from '../../core/auth.ts';
import { editOrder, orderDetail, voidOrder } from '../history/history.ts';
import { emit } from '../notify/events.ts';
import { beamOfOrder } from '../payment/beam.ts';
import { deleteHeld, holdBill, listHeld, recallHeld } from './held.ts';
import { bootstrap, createOrder, recentOrders, type OrderBody } from './orders.ts';

export async function salesRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };

  if (req.method === 'GET' && path === '/api/bootstrap') return ok(200, bootstrap(req.headers['x-pos-terminal']));

  if (req.method === 'GET' && path === '/api/orders')
    return ok(200, recentOrders(Number(url.searchParams.get('limit') ?? 20)));
  if (req.method === 'POST' && path === '/api/orders') {
    const body = (await readBody(req)) as OrderBody;
    body.salesperson = body.salesperson || me.name; // ค่าเริ่มต้น = ผู้ที่ล็อกอิน
    return ok(201, createOrder(body, req.headers['x-pos-terminal']));
  }

  // ----- พักบิล -----
  if (path === '/api/held' && req.method === 'GET') return ok(200, listHeld());
  if (path === '/api/held' && req.method === 'POST') return ok(201, holdBill((await readBody(req)) as Record<string, unknown>, me.name));
  {
    const hm = /^\/api\/held\/(\d+)(\/recall)?$/.exec(path);
    if (hm && hm[2] && req.method === 'POST') return ok(200, recallHeld(Number(hm[1])));
    if (hm && !hm[2] && req.method === 'DELETE') return ok(200, deleteHeld(Number(hm[1])));
  }

  const m = path.match(/^\/api\/orders\/(\d+)(\/void)?$/);
  if (m) {
    const id = Number(m[1]);
    // แนบข้อมูล Beam ของบิล (รหัสการชำระเงิน) ไว้กระทบยอดกับรายงานฝั่ง Beam
    if (!m[2] && req.method === 'GET') return ok(200, { ...orderDetail(id), beam: beamOfOrder(id) });
    if (!m[2] && req.method === 'PUT') {
      const b = (await readBody(req)) as Record<string, unknown>;
      const out = editOrder(id, { ...b, staff: me.name });
      if (!b.dryRun && 'order' in out && out.order) {
        const o = out.order as { orderNo: string; total: number };
        emit('order.edited', { id, orderNo: o.orderNo, oldTotal: o.total - out.diff, newTotal: o.total, diff: out.diff, reason: b.reason ?? '', staff: me.name });
      }
      return ok(200, out);
    }
    if (m[2] && req.method === 'POST') {
      // ยกเลิกบิลต้องยืนยันด้วย PIN — บันทึกชื่อเจ้าของ PIN เป็นผู้อนุมัติ
      const body = (await readBody(req)) as { pin?: string; reason?: string; refundMethod?: string };
      const approver = approveVoid(body.pin, clientIp(req));
      const by = approver.id === me.id ? approver.name : `${approver.name} (อนุมัติ) · ทำรายการโดย ${me.name}`;
      const out = voidOrder(id, { reason: body.reason, refundMethod: body.refundMethod, staff: by, operator: me.name, approver: approver.name }) as Record<string, any>;
      emit('order.voided', { id, orderNo: out.order?.orderNo ?? out.orderNo, total: out.order?.total ?? out.total, reason: body.reason ?? '', staff: by });
      return ok(200, out);
    }
  }

  return false;
}
