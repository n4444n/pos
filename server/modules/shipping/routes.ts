// เส้นทาง API ของระบบส่งของ (ใบส่งของ DO) — ผู้จัดการเท่านั้น เพราะเป็นการย้ายสต็อกข้ามสาขา
import { requireFeature } from '../../core/auth.ts';
import { json, readBody, send, type Ctx } from '../../core/http.ts';
import { XLSX_TYPE } from '../../core/xlsx.ts';
import { shipmentXlsx } from './export.ts';
import { shipmentReport, shipmentReportXlsx } from './report.ts';
import {
  adjustShipment, cancelShipment, createShipment, deleteShippedShipment, editShippedItems, holdShipment,
  listShipments, restoreShipment, resumeShipment, scanShipment, setShipmentItem, shipmentDetail, shipShipment, updateShipment,
} from './shipments.ts';

const DETAIL = /^\/api\/shipments\/(\d+)(?:\/(scan|ship|cancel|restore|hold|resume|received|adjust|items\/(\d+)))?$/;
const EXPORT = /^\/api\/shipments\/(\d+)\/export\.xlsx$/;

export async function shippingRoutes({ req, res, url, path, method, me }: Ctx): Promise<boolean> {
  if (!path.startsWith('/api/shipments')) return false;

  if (path === '/api/shipments' && method === 'GET') {
    requireFeature(me, 'shipments', 'view');
    json(req, res, 200, listShipments());
    return true;
  }
  if (path === '/api/shipments' && method === 'POST') {
    requireFeature(me, 'shipments', 'edit');
    json(req, res, 201, createShipment((await readBody(req)) as never, me));
    return true;
  }

  // รายงานการส่ง: ใบส่งของที่ส่งออกแล้วในช่วงวันที่ (+ Excel รวมรายการสินค้า)
  if ((path === '/api/shipments/report' || path === '/api/shipments/report.xlsx') && method === 'GET') {
    requireFeature(me, 'shipments', 'view');
    const f = Object.fromEntries(url.searchParams.entries()) as Record<string, string>;
    if (path === '/api/shipments/report') {
      json(req, res, 200, shipmentReport(f));
      return true;
    }
    const { file, range } = shipmentReportXlsx(f);
    res.setHeader('Content-Disposition', `attachment; filename="shipment-report-${range.from}-to-${range.to}.xlsx"`);
    send(req, res, 200, file, XLSX_TYPE);
    return true;
  }

  // ใบส่งของเป็น Excel (หน้าตาเดียวกับใบพิมพ์ A4)
  const se = EXPORT.exec(path);
  if (se && method === 'GET') {
    requireFeature(me, 'shipments', 'view');
    const { file, docNo } = shipmentXlsx(Number(se[1]));
    res.setHeader('Content-Disposition', `attachment; filename="${docNo.replace(/[^\w.-]/g, '_')}.xlsx"`);
    send(req, res, 200, file, XLSX_TYPE);
    return true;
  }

  const sh = DETAIL.exec(path);
  if (sh) {
    const id = Number(sh[1]);
    // เปิดดูใบส่งของ ใช้สิทธิ์ "ดูได้" ก็พอ · แก้/ลบ ต้อง "แก้ไขได้"
    if (!sh[2] && method === 'GET') {
      requireFeature(me, 'shipments', 'view');
      json(req, res, 200, shipmentDetail(id));
      return true;
    }
    requireFeature(me, 'shipments', 'edit');
    const ok = (data: unknown) => {
      json(req, res, 200, data);
      return true;
    };
    // ลบใบที่ส่งออกแล้วถาวร (ลบเอกสารอย่างเดียว ไม่แตะสต็อก)
    if (!sh[2] && method === 'DELETE') return ok(deleteShippedShipment(id, me));
    if (!sh[2] && method === 'PATCH') return ok(updateShipment(id, (await readBody(req)) as never));
    if (sh[2] === 'scan' && method === 'POST') return ok(scanShipment(id, (await readBody(req)) as never));
    if (sh[2] === 'ship' && method === 'POST') return ok(shipShipment(id, me));
    if (sh[2] === 'cancel' && method === 'POST') return ok(cancelShipment(id, (await readBody(req)) as never, me));
    if (sh[2] === 'restore' && method === 'POST') return ok(restoreShipment(id));
    // รายงานการส่ง → ปรับสต็อก: แก้จำนวนที่รับจริง · โอนเข้าสต็อก
    if (sh[2] === 'received' && method === 'PUT') return ok(editShippedItems(id, (await readBody(req)) as never, me));
    if (sh[2] === 'adjust' && method === 'POST') return ok(adjustShipment(id, me));
    if (sh[2] === 'hold' && method === 'POST') return ok(holdShipment(id, me));
    if (sh[2] === 'resume' && method === 'POST') return ok(resumeShipment(id));
    if (sh[3] && method === 'PUT') return ok(setShipmentItem(id, Number(sh[3]), (await readBody(req)) as never));
  }

  return false;
}
