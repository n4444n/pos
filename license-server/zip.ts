// ไฟล์ zip แบบง่าย (ไม่มี dependency) — ใช้กับไฟล์สำรองข้อมูลทั้งระบบ (sysbackup.ts)
//   เขียน: ทีละไฟล์ต่อท้าย (ไม่ต้องถือทั้ง zip ไว้ในหน่วยความจำ) · ชื่อไฟล์ UTF-8 (ชื่อร้านภาษาไทยเปิดใน Windows ได้)
//   อ่าน: method 0 (store) / 8 (deflate) · ไม่รองรับ zip64 (ไฟล์ > 4 GB) และไฟล์เข้ารหัส
import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

type Sink = (b: Buffer) => void | Promise<void>;

interface Entry { name: Buffer; crc: number; csize: number; usize: number; method: number; time: number; date: number; offset: number }

/** เวลาแบบ DOS (เวลาไทย) */
function dosTime(ms: number) {
  const d = new Date(ms + 7 * 3600_000);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

const MAX32 = 0xffff_fffe;

export class ZipWriter {
  private entries: Entry[] = [];
  private pos = 0;
  private sink: Sink;
  constructor(sink: Sink) {
    this.sink = sink;
  }
  private async put(b: Buffer) {
    await this.sink(b);
    this.pos += b.length;
  }
  /** เพิ่มไฟล์ · compress = บีบอัด (ไฟล์ที่บีบอัดอยู่แล้ว เช่น jpg/zip ไม่ต้อง) */
  async add(name: string, data: Buffer, compress = true, mtimeMs = Date.now()) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    let body = data;
    let method = 0;
    if (compress && data.length > 64) {
      const z = deflateRawSync(data, { level: 6 });
      if (z.length < data.length) { body = z; method = 8; }
    }
    if (data.length > MAX32 || body.length > MAX32 || this.pos > MAX32) throw new Error('ไฟล์สำรองใหญ่เกิน 4 GB (ยังไม่รองรับ)');
    if (this.entries.length >= 65_000) throw new Error('จำนวนไฟล์ในไฟล์สำรองมากเกินไป');
    const { time, date } = dosTime(mtimeMs);
    const e: Entry = { name: nameBuf, crc: crc32(data) >>> 0, csize: body.length, usize: data.length, method, time, date, offset: this.pos };
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // ชื่อไฟล์ UTF-8
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(e.crc, 14);
    h.writeUInt32LE(e.csize, 18);
    h.writeUInt32LE(e.usize, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    await this.put(h);
    await this.put(nameBuf);
    await this.put(body);
    this.entries.push(e);
  }
  /** ปิดไฟล์ (เขียนสารบัญท้ายไฟล์) · คืนขนาดทั้งหมด */
  async finish() {
    const start = this.pos;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20);
      c.writeUInt32LE(e.usize, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(e.offset, 42);
      await this.put(c);
      await this.put(e.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.pos - start, 12);
    end.writeUInt32LE(start, 16);
    await this.put(end);
    return this.pos;
  }
}

/** เขียน zip ลงไฟล์ (เขียนตรงลง fd) */
export function zipToFile(path: string) {
  const fd = openSync(path, 'w', 0o600);
  const zip = new ZipWriter((b) => { writeSync(fd, b); });
  return {
    zip,
    async close() {
      try { return await zip.finish(); } finally { closeSync(fd); }
    },
    abort() { try { closeSync(fd); } catch { /* ปิดแล้ว */ } },
  };
}

// ---------------------------------------------------------------- อ่าน
export interface ZipEntry { name: string; size: number; csize: number; method: number; crc: number; offset: number }

export class ZipReader {
  readonly entries: ZipEntry[] = [];
  private fd: number;
  constructor(path: string) {
    this.fd = openSync(path, 'r');
    try {
      this.parse();
    } catch (e) {
      closeSync(this.fd);
      throw e;
    }
  }
  private read(pos: number, len: number) {
    const b = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = readSync(this.fd, b, got, len - got, pos + got);
      if (!n) throw new Error('ไฟล์ zip ไม่ครบ (ถูกตัด?)');
      got += n;
    }
    return b;
  }
  private parse() {
    const size = fstatSync(this.fd).size;
    if (size < 22) throw new Error('ไม่ใช่ไฟล์ zip');
    const tail = Math.min(size, 65_557);
    const t = this.read(size - tail, tail);
    let at = -1;
    for (let i = t.length - 22; i >= 0; i--) if (t.readUInt32LE(i) === 0x06054b50) { at = i; break; }
    if (at < 0) throw new Error('ไม่ใช่ไฟล์ zip (หรือไฟล์เสีย)');
    const count = t.readUInt16LE(at + 10);
    const cdSize = t.readUInt32LE(at + 12);
    const cdOff = t.readUInt32LE(at + 16);
    if (count === 0xffff || cdOff === 0xffff_ffff) throw new Error('ไฟล์ zip แบบ zip64 ยังไม่รองรับ — ใช้ไฟล์ที่ระบบสร้างโดยตรง (ไม่ต้องแตกแล้วบีบใหม่)');
    if (cdOff + cdSize > size) throw new Error('ไฟล์ zip เสีย (สารบัญไม่ครบ)');
    const cd = this.read(cdOff, cdSize);
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('ไฟล์ zip เสีย (สารบัญผิดรูปแบบ)');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const csize = cd.readUInt32LE(p + 20);
      const usize = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28);
      const xl = cd.readUInt16LE(p + 30);
      const cl = cd.readUInt16LE(p + 32);
      const offset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nl).toString(flags & 0x0800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
      if (flags & 1) throw new Error('ไฟล์ zip ที่ใส่รหัสผ่านยังไม่รองรับ');
      this.entries.push({ name, size: usize, csize, method, crc, offset });
      p += 46 + nl + xl + cl;
    }
  }
  find(name: string) {
    return this.entries.find((e) => e.name === name);
  }
  /** อ่านไฟล์ในนั้น (ตรวจ CRC) */
  extract(e: ZipEntry): Buffer {
    const h = this.read(e.offset, 30);
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error(`ไฟล์ zip เสีย (${e.name})`);
    const start = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    const raw = this.read(start, e.csize);
    let data: Buffer;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = inflateRawSync(raw);
    else throw new Error(`รูปแบบบีบอัดไม่รองรับ (${e.name})`);
    if (data.length !== e.size || (crc32(data) >>> 0) !== e.crc) throw new Error(`ไฟล์ในไฟล์สำรองเสีย: ${e.name}`);
    return data;
  }
  close() {
    try { closeSync(this.fd); } catch { /* ปิดแล้ว */ }
  }
}
