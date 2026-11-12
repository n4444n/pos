// ตัวช่วยระดับ HTTP ที่ทุก module ใช้ร่วมกัน — ส่งคำตอบ, อ่าน body, และที่เก็บข้อมูลของคำขอไว้ให้ LOG
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createWriteStream, unlinkSync } from 'node:fs';
import { HttpError } from './common.ts';
import { setBranch } from './db.ts';
import type { Me } from './auth.ts';

/** ส่งคำตอบกลับ — บีบอัด gzip ให้อัตโนมัติถ้าคุ้ม */
export function send(req: IncomingMessage, res: ServerResponse, status: number, body: Buffer | string, type: string, cache = 'no-store') {
  let buf = typeof body === 'string' ? Buffer.from(body) : body;
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Cache-Control': cache,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };
  if (buf.length > 1024 && /gzip/.test(String(req.headers['accept-encoding'])) && /json|javascript|html|css|svg|text/.test(type)) {
    buf = gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  headers['Content-Length'] = String(buf.length);
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

export const json = (req: IncomingMessage, res: ServerResponse, status: number, data: unknown) => {
  resultOfReq.set(req, data); // ไว้ให้ LOG หาเลขที่เอกสาร / ข้อความผิดพลาด
  send(req, res, status, JSON.stringify(data), 'application/json; charset=utf-8');
};

/** ข้อมูลของคำขอที่ใช้บันทึก LOG (auditLog.ts) */
export const bodyOfReq = new WeakMap<IncomingMessage, unknown>();
export const resultOfReq = new WeakMap<IncomingMessage, unknown>();
export const meOfReq = new WeakMap<IncomingMessage, Me>();

/** สาขาของ request นี้ — ตั้งใหม่ทุกครั้งหลัง await (request อื่นอาจเปลี่ยนสาขาระหว่างรออ่าน body) */
export const branchOfReq = new WeakMap<IncomingMessage, number>();

export function readBody(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return readBodyRaw(req, limit).then((v) => {
    bodyOfReq.set(req, v);
    const b = branchOfReq.get(req);
    if (b !== undefined) setBranch(b);
    return v;
  });
}

function readBodyRaw(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new HttpError(413, 'Payload too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        fail(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', fail);
  });
}

/**
 * สิ่งที่ตัวแจกเส้นทางส่งให้ routes.ts ของแต่ละ module
 * (ผ่านการตรวจสิทธิ์เข้าระบบมาแล้ว — ตรวจสิทธิ์รายเมนูด้วย requireFeature ใน module เอง)
 */
export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  path: string;
  method: string;
  me: Me;
};

/** routes.ts ของแต่ละ module — คืน true ถ้ารับคำขอนี้ไปจัดการแล้ว, false ถ้าไม่ใช่ของตัวเอง */
export type Routes = (c: Ctx) => Promise<boolean>;

/** ?branch=<id> → สำรองเฉพาะสาขา · ไม่ระบุ/all = ทั้งร้าน */
export function branchParam(url: URL): number | undefined {
  const v = url.searchParams.get('branch');
  if (!v || v === 'all') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'สาขาไม่ถูกต้อง');
  return n;
}

/** รับไฟล์ที่อัปโหลด (body ดิบ) ลงดิสก์ — จำกัดขนาด */
export function receiveFile(req: IncomingMessage, file: string, limit: number) {
  return new Promise<void>((ok, fail) => {
    const out = createWriteStream(file);
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        out.destroy();
        try { unlinkSync(file); } catch { /* ไม่มีไฟล์ */ }
        fail(new HttpError(413, `ไฟล์ใหญ่เกิน ${Math.round(limit / 1048576)} MB`));
      }
    });
    req.pipe(out);
    out.on('finish', () => (size ? ok() : fail(new HttpError(400, 'ไม่ได้แนบไฟล์'))));
    out.on('error', fail);
    req.on('error', fail);
  });
}
