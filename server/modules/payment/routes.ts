// เส้นทาง API ของ module payment
import { json, readBody, type Ctx } from '../../core/http.ts';
import { approveManager, clientIp, requireFeature } from '../../core/auth.ts';
import { HttpError } from '../../core/common.ts';
import { currentBranch } from '../../core/db.ts';
import { getSettings, publicSettings } from '../../core/settings.ts';
import { beamCheckoutInfo, beamStatus, cancelIntent, getIntentRow, markBilled, openIntents, pairDevice, refreshIntent, startIntent, testConnection, unpairDevice } from './beam.ts';
import { createOrder, quoteTotal, type OrderBody } from '../sales/orders.ts';
import { requireShift } from '../shift/shifts.ts';

export async function paymentRoutes({ req, res, url, path, me }: Ctx): Promise<boolean> {
  const ok = (s: number, d: unknown) => { json(req, res, s, d); return true; };

  // ----- Beam Checkout (เครื่องรับบัตร Bolt) -----
  if (path === '/api/beam' && req.method === 'GET') { requireFeature(me, 'settings', 'view'); return ok(200, beamStatus()); }
  // หน้าขายใช้ตอนรับเงิน — พนักงานขายต้องเรียกได้ จึงใช้สิทธิ์ "หน้าขาย" ไม่ใช่ "ตั้งค่า"
  // (ส่งเฉพาะวิธีรับเงิน/เวลารอ/ชื่อเครื่อง — ไม่มีกุญแจหรือ Merchant ID)
  if (path === '/api/beam/checkout' && req.method === 'GET') {
    requireFeature(me, 'sales', 'edit');
    return ok(200, beamCheckoutInfo(Number(req.headers['x-pos-terminal']) || 0));
  }
  if (path === '/api/beam/test' && req.method === 'POST') { requireFeature(me, 'settings', 'edit'); return ok(200, await testConnection()); }
  if (path === '/api/beam/pair' && req.method === 'POST') {
    requireFeature(me, 'settings', 'edit');
    const b = (await readBody(req)) as { pairingCode?: unknown; terminalId?: unknown };
    return ok(200, await pairDevice(b.pairingCode, Number(b.terminalId) || 0));
  }
  if (path === '/api/beam/pair' && req.method === 'DELETE') {
    requireFeature(me, 'settings', 'edit');
    return ok(200, await unpairDevice(Number(url.searchParams.get('terminal')) || 0));
  }
  // ----- Beam: รับเงินหน้าร้าน (ขั้นตอน: ส่งยอด → ลูกค้าจ่าย → ถามผล → ออกบิล) -----
  if (path === '/api/beam/charge' && req.method === 'POST') {
    requireFeature(me, 'sales', 'edit');
    const body = (await readBody(req)) as OrderBody & { method?: string; pin?: unknown };
    requireShift(); // ต้องเปิดกะก่อน ไม่งั้นรับเงินแล้วออกบิลไม่ได้
    const cfg = getSettings().beam;
    const method = String(body.method ?? cfg.methods[0] ?? '');
    // ผู้จัดการยืนยันก่อนเงินออก (ตั้งปิดได้ในหน้าตั้งค่า) — ใช้สิทธิ์ระดับ "ประวัติการขาย" คือระดับผู้จัดการขึ้นไป
    const approvedBy = cfg.requireManager ? approveManager(body.pin, clientIp(req), 'history') : '';
    const { total } = quoteTotal(body, 'beam');
    const cart = { ...body, pin: undefined, paymentMethod: 'beam', salesperson: body.salesperson || me.name };
    const refId = `${currentBranch()}-${Date.now()}`;
    const r = await startIntent({
      amount: total, method, refId, note: `${publicSettings().shop.name} · ${me.name}`,
      terminalId: Number(req.headers['x-pos-terminal']) || 0, staff: me.name, approvedBy, cart,
    });
    return ok(201, { ...r, total, approvedBy });
  }
  {
    const bm = /^\/api\/beam\/charge\/([^/]+)(\/bill|\/cancel)?$/.exec(path);
    if (bm) {
      requireFeature(me, 'sales', 'edit');
      const id = decodeURIComponent(bm[1]);
      // ถามผลจาก Beam (หน้าจอเรียกซ้ำทุก 2 วินาที) — ไม่ออกบิลที่นี่ เพื่อให้การออกบิลถูกบันทึกลง LOG เสมอ
      if (!bm[2] && req.method === 'GET') {
        const row = await refreshIntent(id);
        return ok(200, { status: row.status, result: row.result, chargeId: row.chargeId, orderId: row.orderId, amount: row.amount });
      }
      if (bm[2] === '/cancel' && req.method === 'POST') {
        const row = await cancelIntent(id);
        return ok(200, { status: row.status, result: row.result });
      }
      // ออกบิลหลังรับเงินสำเร็จ — ตัดสต็อกตรงนี้ (ไม่ใช่ตอนกดชำระ)
      if (bm[2] === '/bill' && req.method === 'POST') {
        const row = getIntentRow(id) ?? (await refreshIntent(id));
        if (row.status === 'BILLED' && row.orderId) return ok(200, { already: true, orderId: row.orderId });
        if (row.status !== 'PAID') throw new HttpError(409, 'รายการนี้ยังไม่ได้รับเงิน — ออกบิลไม่ได้');
        // เงินของลูกค้าออกไปแล้ว ถ้าออกบิลไม่ผ่านต้องบอกให้ชัดว่าติดอะไรและต้องทำอะไรต่อ
        // (รายการยังค้างอยู่ในระบบ กดออกบิลซ้ำได้เสมอ — ห้ามทิ้งให้เงินหาย)
        let out;
        try {
          out = createOrder(JSON.parse(row.cart) as OrderBody, req.headers['x-pos-terminal'], true);
        } catch (e) {
          const why = e instanceof HttpError ? e.message : 'เกิดข้อผิดพลาดระหว่างออกบิล';
          const how = e instanceof HttpError && e.code === 'NO_SHIFT'
            ? 'เปิดกะก่อน แล้วกดออกบิลอีกครั้ง'
            : 'แก้ตามข้อความด้านบน (เช่น เติมสต็อก หรือเปิดแสดงขายสินค้า) แล้วกดออกบิลอีกครั้ง — ถ้าทำไม่ได้ ต้องคืนเงินลูกค้าผ่านแผงควบคุมของ Beam';
          throw new HttpError(409, `รับเงินแล้ว ${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท แต่ออกบิลไม่สำเร็จ: ${why} · ${how}`, 'BEAM_BILL_FAILED');
        }
        markBilled(id, out.order.id);
        // ยอดที่เรียกเก็บกับยอดบิลต้องตรงกัน ถ้าไม่ตรง (เช่นมีคนแก้ราคาระหว่างรอจ่าย) ต้องรู้ทันที
        const mismatch = Math.abs(out.order.total - row.amount) > 0.009 ? { charged: row.amount, billed: out.order.total } : null;
        return ok(201, { ...out, chargeId: row.chargeId, mismatch });
      }
    }
  }
  // บิลที่จ่ายแล้วแต่ยังไม่ได้ออกบิล (เปิดโปรแกรมแล้วเช็คครั้งเดียว — กันเงินหายเวลาไฟดับกลางคัน)
  // ถามซ้ำทุกรายการที่ยังไม่ได้ออกบิล ไม่ใช่เฉพาะที่รออยู่ — เอกสาร Beam ระบุว่ารายการที่
  // ยกเลิก/หมดอายุไปแล้ว ยังมีโอกาสที่เงินจะเข้าตามมาทีหลัง ถ้าไม่ถามซ้ำจะได้เงินแต่ไม่มีบิล
  if (path === '/api/beam/pending' && req.method === 'GET') {
    requireFeature(me, 'sales', 'edit');
    const rows = [];
    for (const it of openIntents()) {
      const r = it.status === 'PAID' ? it : await refreshIntent(it.intentId).catch(() => it);
      if (r.status === 'PAID') rows.push({ intentId: r.intentId, amount: r.amount, chargeId: r.chargeId, staff: r.staff, createdAt: r.createdAt });
    }
    return ok(200, { rows });
  }

  return false;
}
