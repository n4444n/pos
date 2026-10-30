// Clothing POS — เซิร์ฟเวอร์ license + แผงควบคุมร้านทดลอง
// รัน: node --experimental-strip-types license-server/server.ts
//
//   แผงควบคุม   /admin             ออก license (ร้าน · จำนวนวัน · จำนวนเครื่อง) · ต่ออายุ · ระงับ · ดูเครื่อง/สถานะร้าน
//   แอป .exe    POST /api/activate กรอก license → ยังไม่มีร้าน? จองพอร์ต + สร้าง + เปิดบริการ → ตอบที่อยู่ + PIN
//               POST /api/check    ตรวจทุกครั้งที่เปิดแอป (หมดอายุ / ถูกระงับ → แอปกลับไปหน้าเปิดใช้งาน)
//   ทุกร้าน     ทุกคำขออื่น         ส่งต่อไปเซิร์ฟเวอร์ POS ของร้าน ตาม header X-POS-Shop (gateway.ts)
//
// ทุกอย่างอยู่หลังพอร์ตเดียว (3100): โดเมนแอป (เช่น pos.sh0p.tech) = ประตูเข้าร้าน + API ของแอป
// โดเมนผู้ดูแล (ADMIN_DOMAIN เช่น license.sh0p.tech) = แผงควบคุมเท่านั้น · โหมดทดสอบใช้โดเมนเดียวกันทั้งหมด
// ครบกำหนด → ปิดบริการของร้านให้อัตโนมัติ (ข้อมูลยังอยู่ ต่ออายุแล้วเปิดใหม่ได้)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db, DB_PATH, daysLeft, freePort, getInstance, getLicense, getLicenseById, isExpired, localStamp, logEvent, machinesOf, newCode,
  getLicenseBySlug, normalizeCode, parseStamp, SLUG_RE, slugOk, tx, type Instance, type License,
} from './store.ts';
import { makeProvisioner } from './provision.ts';
import { archiveBackups, BACKUP_ROOT, backupPath, backupShop, listBackups, needsAutoBackup, shopStats, tokenFor } from './shopdata.ts';
import { clientIp, cookies, failed, guard, pruneGuards, HttpError, int, json, publicBase, readBody, SEC_HEADERS, serial, str } from './http.ts';
import { proxyToShop, selectShop, shopOf } from './gateway.ts';

// ---------------------------------------------------------------- ตั้งค่า
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LICENSE_PORT ?? 3100);
const PORT_MIN = Number(process.env.TRIAL_PORT_MIN ?? 3101);
const PORT_MAX = Number(process.env.TRIAL_PORT_MAX ?? 3999);
const prov = makeProvisioner(tokenFor);
const LOCAL = prov.mode === 'local';
/** โดเมนของแผงควบคุม (ว่าง = โหมดทดสอบ ใช้โดเมนเดียวกับแอป) */
const ADMIN_DOMAIN = (process.env.ADMIN_DOMAIN ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
/** ที่อยู่ที่แอปใช้เข้าร้านทุกร้าน (เช่น https://pos.sh0p.tech) — ว่าง = ใช้ที่อยู่ของคำขอ (โหมดทดสอบ) */
const APP_BASE = (process.env.APP_BASE ?? '').replace(/\/+$/, '');
/** ร้านของเจ้าของระบบ: ใช้บริการ pos.service พอร์ต 3000 (ไม่ถูกสร้าง/ลบโดยแผงควบคุม) */
const MAIN_SLUG = (process.env.MAIN_SLUG ?? '').toLowerCase();
const MAIN_PORT = Number(process.env.MAIN_PORT ?? 3000);
/** ช่วงย้ายระบบ: แอปรุ่นเก่า (ไม่ส่ง X-POS-Shop) ให้เข้าร้านหลักได้ — ปิดเมื่ออัปเดตแอปครบทุกเครื่อง */
const LEGACY_MAIN = process.env.LEGACY_MAIN === '1' && !!MAIN_SLUG;
const isMain = (slug: string) => !!MAIN_SLUG && slug === MAIN_SLUG;
const appBase = (base: string) => APP_BASE || base;
/** คำขอนี้เข้ามาทางโดเมนแผงควบคุมหรือไม่ (ไม่ได้ตั้ง ADMIN_DOMAIN = ทุกโดเมนถือเป็นแผงควบคุม) */
const onAdminDomain = (req: IncomingMessage) =>
  !ADMIN_DOMAIN || String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(':')[0].toLowerCase() === ADMIN_DOMAIN;

/** รหัสผ่านแผงควบคุม: ADMIN_PASSWORD (VPS ต้องตั้ง) · โหมดทดสอบไม่ตั้ง → สุ่มครั้งแรกเก็บใน data/admin-password.txt (แก้ไฟล์เพื่อเปลี่ยนได้) */
const PASSWORD_FILE = join(dirname(DB_PATH), 'admin-password.txt');
const ADMIN_PASSWORD = (() => {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!LOCAL) {
    console.error('ต้องตั้ง ADMIN_PASSWORD (ไฟล์ /etc/pos-license/env)');
    process.exit(1);
  }
  if (!existsSync(PASSWORD_FILE)) writeFileSync(PASSWORD_FILE, `${randomBytes(6).toString('base64url')}\n`);
  return readFileSync(PASSWORD_FILE, 'utf8').trim();
})();

const addDays = (stamp: string, days: number) => localStamp(new Date(parseStamp(stamp).getTime() + days * 86_400_000));

// ---------------------------------------------------------------- ระบบร้าน (instance)
const newPin = () => {
  for (;;) {
    const p = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!/^(\d)\1{5}$/.test(p) && !'0123456789876543210'.includes(p)) return p; // ไม่เอา 111111 / 123456
  }
};
const setState = (slug: string, state: Instance['state'], error = '') =>
  db.prepare('UPDATE instances SET state = ?, error = ? WHERE slug = ?').run(state, error.slice(0, 500), slug);

function provisionFailed(l: License, e: unknown, what: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  setState(l.slug, 'error', msg);
  logEvent(l.id, 'instance.error', msg);
  throw new HttpError(502, `${what}ระบบร้านไม่สำเร็จ — แจ้งผู้ดูแล (${msg})`, 'PROVISION');
}

/** ให้ร้านมีระบบที่ทำงานอยู่ — ยังไม่มี: จองพอร์ต + สร้าง · หยุดอยู่: เปิด */
async function ensureInstance(l: License): Promise<{ inst: Instance; created: boolean }> {
  const existing = getInstance(l.slug);
  // ร้านหลักมีบริการของตัวเองอยู่แล้ว (pos.service) — แผงควบคุมไม่สร้าง/ไม่เปิดให้
  if (isMain(l.slug)) {
    if (!existing) throw new HttpError(500, 'ยังไม่ได้ตั้งค่าร้านหลัก', 'MAIN');
    return { inst: existing, created: false };
  }
  if (!existing) {
    const port = freePort(PORT_MIN, PORT_MAX);
    const pin = newPin();
    db.prepare("INSERT INTO instances (slug, port, manager_pin, state) VALUES (?, ?, ?, 'stopped')").run(l.slug, port, pin);
    logEvent(l.id, 'instance.create', `port ${port}`);
    await prov.create(l.slug, port, pin).catch((e) => provisionFailed(l, e, 'สร้าง'));
  } else if (existing.state !== 'running') {
    await prov.start(l.slug, existing.port, existing.manager_pin).catch((e) => provisionFailed(l, e, 'เปิด'));
    logEvent(l.id, 'instance.start');
  }
  setState(l.slug, 'running');
  return { inst: getInstance(l.slug)!, created: !existing };
}

async function stopInstance(l: License, why: string) {
  if (isMain(l.slug)) return; // ร้านหลักปิดจากแผงควบคุมไม่ได้
  const inst = getInstance(l.slug);
  if (!inst || inst.state === 'stopped') return;
  try {
    await prov.stop(l.slug);
    setState(l.slug, 'stopped');
    logEvent(l.id, 'instance.stop', why);
  } catch (e) {
    setState(l.slug, 'error', (e as Error).message);
  }
}

// ---------------------------------------------------------------- API สำหรับแอป .exe
function licenseFor(rawCode: unknown, ip: string) {
  guard(ip);
  const code = normalizeCode(rawCode);
  const l = code ? getLicense(code) : undefined;
  if (!l) {
    failed(ip);
    throw new HttpError(404, 'ไม่พบ license นี้ — ตรวจตัวอักษรอีกครั้ง (รูปแบบ POS-XXXX-XXXX)', 'NOT_FOUND');
  }
  if (l.status === 'revoked') throw new HttpError(403, 'license นี้ถูกระงับ — ติดต่อผู้ขาย', 'REVOKED');
  if (isExpired(l)) throw new HttpError(403, `license หมดอายุแล้ว (${l.expires_at!.slice(0, 10)}) — ติดต่อผู้ขายเพื่อต่ออายุ`, 'EXPIRED');
  return l;
}
function machineInput(b: Record<string, unknown>) {
  const id = str(b.machineId, 128);
  if (!/^[\w-]{8,128}$/.test(id)) throw new HttpError(400, 'รหัสเครื่องไม่ถูกต้อง');
  return { id, name: str(b.machineName, 80) };
}
const isKnownMachine = (licenseId: number, machineId: string) =>
  !!db.prepare('SELECT 1 FROM machines WHERE license_id = ? AND machine_id = ?').get(licenseId, machineId);

/**
 * ข้อมูลที่แอปใช้เปิดระบบร้าน
 *   url   = ที่อยู่ที่แอปเปิด (โดเมนเดียวกันทุกร้าน)
 *   route = ชื่อย่อร้านที่แอปแนบใน header X-POS-Shop ทุกคำขอ (ประตูใช้แยกว่าเป็นร้านไหน)
 */
const appInfo = (l: License, base: string) => ({
  shop: l.shop,
  url: appBase(base),
  route: l.slug,
  expiresAt: l.expires_at,
  daysLeft: daysLeft(l),
  maxMachines: l.max_machines,
  machines: machinesOf(l.id).length,
});

async function activate(b: Record<string, unknown>, ip: string, base: string) {
  const l0 = licenseFor(b.code, ip);
  const m = machineInput(b);
  return serial(l0.slug, async () => {
    const l1 = getLicenseById(l0.id)!;
    const known = isKnownMachine(l1.id, m.id);
    if (!known && machinesOf(l1.id).length >= l1.max_machines) {
      throw new HttpError(403, `license นี้ใช้ครบ ${l1.max_machines} เครื่องแล้ว — ติดต่อผู้ขายเพื่อเพิ่มเครื่อง`, 'MACHINE_LIMIT');
    }
    const { inst, created } = await ensureInstance(l1);
    tx(() => {
      if (!l1.activated_at) {
        const now = localStamp();
        db.prepare('UPDATE licenses SET activated_at = ?, expires_at = ? WHERE id = ?').run(now, addDays(now, l1.days), l1.id);
      }
      if (known) db.prepare("UPDATE machines SET last_seen = datetime('now','localtime'), name = ? WHERE license_id = ? AND machine_id = ?").run(m.name, l1.id, m.id);
      else db.prepare('INSERT INTO machines (license_id, machine_id, name) VALUES (?, ?, ?)').run(l1.id, m.id, m.name);
    });
    if (!known) logEvent(l1.id, 'machine.add', `${m.name} (${ip})`);
    const l = getLicenseById(l1.id)!;
    // PIN ผู้จัดการเริ่มต้นให้เฉพาะตอนสร้างร้านครั้งแรก — เครื่องถัดไปใช้ PIN ที่ร้านตั้งเอง (คนได้รหัส license ไปทีหลังจะไม่ได้ PIN)
    return { ok: true, ...appInfo(l, base), created, ...(created ? { managerPin: inst.manager_pin } : {}), code: l.code };
  });
}

async function check(b: Record<string, unknown>, ip: string, base: string) {
  const l = licenseFor(b.code, ip);
  const m = machineInput(b);
  if (!isKnownMachine(l.id, m.id)) throw new HttpError(403, 'เครื่องนี้ยังไม่ได้ลงทะเบียนกับ license นี้ — กรอก license ใหม่อีกครั้ง', 'MACHINE_UNKNOWN');
  db.prepare("UPDATE machines SET last_seen = datetime('now','localtime') WHERE license_id = ? AND machine_id = ?").run(l.id, m.id);
  if (getInstance(l.slug)?.state !== 'running') await serial(l.slug, () => ensureInstance(l));
  return { ok: true, ...appInfo(l, base) };
}

// ---------------------------------------------------------------- แผงควบคุม (ผู้ดูแล)
const ADMIN_COOKIE = 'lic_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, number>(); // token → หมดอายุ
const sha = (s: string) => createHash('sha256').update(s).digest();

function isAdmin(req: IncomingMessage) {
  // ตรวจทุกค่า — cookie เก่า (Path=/admin จากเวอร์ชันก่อน) อาจถูกส่งมาก่อนตัวใหม่
  return cookies(req, ADMIN_COOKIE).some((t) => {
    const exp = /^[a-f0-9]{48}$/.test(t) ? sessions.get(t) : undefined;
    return !!exp && exp >= Date.now();
  });
}
function requireAdmin(req: IncomingMessage) {
  if (!isAdmin(req)) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ', 'AUTH');
}

function listLicenses(base: string) {
  const rows = db.prepare('SELECT * FROM licenses ORDER BY id DESC').all() as unknown as License[];
  return rows.map((row) => {
    const { image, ...l } = row;
    const inst = getInstance(l.slug);
    return {
      ...l,
      image: image ? `/admin/api/licenses/${l.id}/image?v=${encodeURIComponent(l.image_at)}` : '', // รูปโหลดแยก (รายการเบา)
      expired: isExpired(row),
      daysLeft: daysLeft(row),
      main: isMain(l.slug),
      machines: machinesOf(l.id),
      instance: inst
        ? { port: inst.port, url: prov.shopUrl(l.slug, appBase(base)), state: inst.state, error: inst.error, managerPin: inst.manager_pin, createdAt: inst.created_at }
        : null,
    };
  });
}

function createLicense(b: Record<string, unknown>, base: string) {
  const shop = str(b.shop, 80);
  if (!shop) throw new HttpError(400, 'กรุณาใส่ชื่อร้าน');
  const slug = str(b.slug, 30).toLowerCase();
  if (!SLUG_RE.test(slug)) throw new HttpError(400, 'ชื่อย่อร้านใช้ได้เฉพาะ a-z 0-9 และ - (1–30 ตัว ห้ามขึ้นต้น/ลงท้ายด้วย -)');
  if (!slugOk(slug)) throw new HttpError(400, `ชื่อ "${slug}" ระบบใช้อยู่ — เลือกชื่อย่ออื่น`);
  if (db.prepare('SELECT 1 FROM licenses WHERE slug = ?').get(slug)) throw new HttpError(409, `ชื่อย่อร้าน "${slug}" ถูกใช้แล้ว`);
  const days = int(b.days ?? 60, 1, 3650);
  const max = int(b.maxMachines ?? 2, 1, 50);
  const code = newCode();
  const r = db.prepare('INSERT INTO licenses (code, shop, slug, days, max_machines, note) VALUES (?, ?, ?, ?, ?, ?)').run(code, shop, slug, days, max, str(b.note, 300));
  logEvent(Number(r.lastInsertRowid), 'license.issue', `${shop} · ${days} วัน · ${max} เครื่อง`);
  return { code, slug, url: prov.shopUrl(slug, appBase(base)) };
}

const IMAGE_MAX = 280_000;

const MAIN_BLOCKED = new Set(['delete', 'revoke', 'stop', 'start']);

async function adminAction(id: number, action: string, b: Record<string, unknown>) {
  const l = getLicenseById(id);
  if (!l) throw new HttpError(404, 'ไม่พบ license');
  if (isMain(l.slug) && MAIN_BLOCKED.has(action)) throw new HttpError(400, 'ร้านหลักของระบบ — ระงับ/หยุด/ลบจากแผงควบคุมไม่ได้', 'MAIN');
  switch (action) {
    case 'extend': {
      const days = int(b.days ?? 30, 1, 3650);
      // ยังไม่เปิดใช้งาน → เพิ่มอายุ · หมดอายุแล้ว → นับต่อจากวันนี้ · ยังไม่หมด → ต่อจากวันหมดอายุเดิม
      const from = l.expires_at && !isExpired(l) ? l.expires_at : localStamp();
      if (l.activated_at) db.prepare('UPDATE licenses SET days = days + ?, expires_at = ? WHERE id = ?').run(days, addDays(from, days), id);
      else db.prepare('UPDATE licenses SET days = days + ? WHERE id = ?').run(days, id);
      return logEvent(id, 'license.extend', `+${days} วัน`);
    }
    case 'machines': {
      const max = int(b.maxMachines, 1, 50);
      db.prepare('UPDATE licenses SET max_machines = ? WHERE id = ?').run(max, id);
      return logEvent(id, 'license.machines', String(max));
    }
    case 'revoke':
      db.prepare("UPDATE licenses SET status = 'revoked' WHERE id = ?").run(id);
      logEvent(id, 'license.revoke');
      return serial(l.slug, () => stopInstance(l, 'revoked'));
    case 'restore':
      db.prepare("UPDATE licenses SET status = 'active' WHERE id = ?").run(id);
      return logEvent(id, 'license.restore');
    case 'remove-machine': {
      const machineId = str(b.machineId, 128);
      db.prepare('DELETE FROM machines WHERE license_id = ? AND machine_id = ?').run(id, machineId);
      return logEvent(id, 'machine.remove', machineId);
    }
    case 'stop':
      return serial(l.slug, () => stopInstance(l, 'admin'));
    case 'delete': {
      // ต้องพิมพ์ชื่อย่อร้านยืนยัน (กันกดผิด)
      if (str(b.confirm, 30) !== l.slug) throw new HttpError(400, `พิมพ์ชื่อย่อร้าน "${l.slug}" ให้ตรงเพื่อยืนยันการลบ`);
      const note = await serial(l.slug, async () => {
        await stopInstance(l, 'deleted'); // ปิดก่อน (สถานะในฐานข้อมูลตรงกับจริง แม้ย้ายข้อมูลไม่สำเร็จ)
        const where = await prov.remove(l.slug);
        try { archiveBackups(l.slug); } catch (e) { console.error('[backup] ย้ายไฟล์สำรองไม่สำเร็จ', e); }
        tx(() => {
          db.prepare('DELETE FROM instances WHERE slug = ?').run(l.slug);
          db.prepare('DELETE FROM licenses WHERE id = ?').run(id); // เครื่องที่ลงทะเบียนถูกลบตาม (ON DELETE CASCADE)
        });
        return where;
      });
      return logEvent(null, 'license.delete', `${l.shop} · ${l.code} · ${l.slug}${note ? ` · ${note}` : ''}`);
    }
    case 'image': {
      // ว่าง = ลบรูป · รับเฉพาะ data URL รูป jpeg/png/webp ไม่เกิน ~200 KB
      const img = typeof b.image === 'string' ? b.image : '';
      if (img && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > IMAGE_MAX)) throw new HttpError(400, 'รูปไม่ถูกต้องหรือใหญ่เกินไป');
      db.prepare('UPDATE licenses SET image = ?, image_at = ? WHERE id = ?').run(img, img ? localStamp() : '', id);
      return logEvent(id, img ? 'license.image' : 'license.image-remove');
    }
    case 'backup': {
      const inst = getInstance(l.slug);
      if (!inst || inst.state !== 'running') throw new HttpError(400, 'ร้านต้องเปิดอยู่จึงจะสำรองข้อมูลได้');
      const branch = b.branch === undefined || b.branch === null || b.branch === 'all' ? undefined : int(b.branch, 1, 999_999);
      const bk = await serial(l.slug, () => backupShop(l.slug, inst.port, false, branch));
      logEvent(id, 'backup.manual', `${bk.file} · ${Math.round(bk.size / 1024)} KB`);
      return;
    }
    case 'backup-delete': {
      const file = str(b.file, 80);
      const path = backupPath(l.slug, file);
      if (!path) throw new HttpError(404, 'ไม่พบไฟล์สำรอง');
      unlinkSync(path);
      return logEvent(id, 'backup.delete', file);
    }
    case 'start':
      if (l.status !== 'active' || isExpired(l)) throw new HttpError(400, 'license ถูกระงับหรือหมดอายุ — ต่ออายุ/คืนสถานะก่อน');
      await serial(l.slug, () => ensureInstance(l));
      return;
    default:
      throw new HttpError(404, 'ไม่รู้จักคำสั่ง');
  }
}

/**
 * ร้านของเจ้าของระบบเข้าระบบ license ด้วย (แยกร้านด้วย header เหมือนร้านอื่น)
 * ต่างจากร้านทดลอง: บริการเป็น pos.service พอร์ต 3000 · ไม่มีวันหมดอายุจริง · ระงับ/ลบจากแผงควบคุมไม่ได้
 */
function ensureMainShop() {
  if (!MAIN_SLUG) return;
  const exists = getLicenseBySlug(MAIN_SLUG);
  const DAYS = 36500;
  tx(() => {
    if (!exists) {
      const now = localStamp();
      db.prepare(
        `INSERT INTO licenses (code, shop, slug, days, max_machines, note, activated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(newCode(), process.env.MAIN_NAME || 'ร้านหลัก', MAIN_SLUG, DAYS, int(process.env.MAIN_MACHINES ?? 10, 1, 50), 'ร้านของเจ้าของระบบ', now, addDays(now, DAYS));
      logEvent(getLicenseBySlug(MAIN_SLUG)!.id, 'license.issue', `ร้านหลัก · พอร์ต ${MAIN_PORT}`);
    }
    // แถว instance ชี้ไปบริการที่มีอยู่แล้ว (ไม่สร้างใหม่) — PIN ว่าง = ใช้ PIN เดิมของร้าน
    db.prepare(
      `INSERT INTO instances (slug, port, manager_pin, state) VALUES (?, ?, '', 'running')
       ON CONFLICT (slug) DO UPDATE SET port = excluded.port, state = 'running', error = ''`,
    ).run(MAIN_SLUG, MAIN_PORT);
  });
  const l = getLicenseBySlug(MAIN_SLUG)!;
  console.log(`  ร้านหลัก      → ${l.shop} (${MAIN_SLUG}) พอร์ต ${MAIN_PORT} · license ${l.code}`);
}

// ---------------------------------------------------------------- ครบกำหนด → ปิดร้าน
async function sweep() {
  const rows = db.prepare("SELECT l.* FROM licenses l JOIN instances i ON i.slug = l.slug WHERE i.state = 'running'").all() as unknown as License[];
  for (const l of rows) {
    if (isMain(l.slug)) continue;
    if (l.status === 'revoked' || isExpired(l)) await serial(l.slug, () => stopInstance(l, l.status === 'revoked' ? 'revoked' : 'expired'));
    // สำรองข้อมูลอัตโนมัติวันละครั้ง (เฉพาะร้านที่เปิดอยู่)
    else if (needsAutoBackup(l.slug)) {
      const inst = getInstance(l.slug);
      if (inst) {
        await backupShop(l.slug, inst.port, true)
          .then((b) => logEvent(l.id, 'backup.auto', `${b.file} · ${Math.round(b.size / 1024)} KB`))
          .catch((e) => logEvent(l.id, 'backup.error', (e as Error).message));
      }
    }
  }
}

/** ข้อมูลร้าน (ถามระบบร้าน) + รายการไฟล์สำรอง — สำหรับ popup ในแผงควบคุม */
async function shopInfo(l: License) {
  const inst = getInstance(l.slug);
  const backups = listBackups(l.slug);
  if (!inst) return { state: 'none', stats: null, error: '', backups };
  if (inst.state !== 'running') return { state: inst.state, stats: null, error: 'ร้านหยุดอยู่ — เปิดร้านเพื่อดูข้อมูลล่าสุด', backups };
  try {
    return { state: 'running', stats: await shopStats(inst.port, l.slug), error: '', backups };
  } catch (e) {
    return { state: 'running', stats: null, error: (e as Error).message, backups };
  }
}

// ---------------------------------------------------------------- เปิดดูร้านจากแผงควบคุม
// แผงควบคุมอยู่คนละโดเมนกับร้าน จึงออก token ใช้ครั้งเดียว อายุ 2 นาที แลกเป็น cookie ที่โดเมนของร้าน
const viewTokens = new Map<string, { slug: string; exp: number }>();
function viewLink(l: License, base: string) {
  const t = randomBytes(18).toString('hex');
  viewTokens.set(t, { slug: l.slug, exp: Date.now() + 120_000 });
  return `${appBase(base)}/shop/${l.slug}?t=${t}`;
}
/** ใช้ token แล้วทิ้ง — คืนชื่อย่อร้านถ้ายังใช้ได้ */
function useViewToken(t: string, slug: string) {
  const v = viewTokens.get(t);
  if (!v) return false;
  viewTokens.delete(t);
  return v.exp > Date.now() && v.slug === slug;
}

// ---------------------------------------------------------------- HTTP
const ADMIN_HTML = readFileSync(join(HERE, 'admin.html'));
const ADMIN_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:";

async function handleAdminApi(req: IncomingMessage, p: string, base: string, ip: string) {
  const secure = String(req.headers['x-forwarded-proto'] ?? '') === 'https' ? '; Secure' : '';
  if (req.method === 'POST' && p === '/admin/api/login') {
    guard(ip);
    const b = await readBody(req);
    if (!timingSafeEqual(sha(str(b.password, 200)), sha(ADMIN_PASSWORD))) {
      failed(ip);
      throw new HttpError(401, 'รหัสผ่านไม่ถูกต้อง');
    }
    const t = randomBytes(24).toString('hex');
    sessions.set(t, Date.now() + SESSION_MS);
    return { status: 200, body: { ok: true }, cookie: `${ADMIN_COOKIE}=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` };
  }
  if (req.method === 'POST' && p === '/admin/api/logout') {
    for (const t of cookies(req, ADMIN_COOKIE)) sessions.delete(t);
    return { status: 200, body: { ok: true }, cookie: `${ADMIN_COOKIE}=; Path=/; Max-Age=0` };
  }
  requireAdmin(req);
  if (req.method === 'GET' && p === '/admin/api/licenses') {
    const meta = { mode: prov.mode, publicUrl: base, appBase: appBase(base), mainSlug: MAIN_SLUG, legacyMain: LEGACY_MAIN, downloadUrl: process.env.DOWNLOAD_URL ?? '' };
    return { status: 200, body: { ...meta, licenses: listLicenses(base) } };
  }
  if (req.method === 'POST' && p === '/admin/api/licenses') return { status: 201, body: createLicense(await readBody(req), base) };
  if (req.method === 'GET' && p === '/admin/api/events') {
    return { status: 200, body: db.prepare('SELECT e.*, l.shop FROM events e LEFT JOIN licenses l ON l.id = e.license_id ORDER BY e.id DESC LIMIT 100').all() };
  }
  const m = /^\/admin\/api\/licenses\/(\d+)\/([a-z-]+)$/.exec(p);
  if (req.method === 'GET' && m && m[2] === 'view') {
    const l = getLicenseById(Number(m[1]));
    if (!l) throw new HttpError(404, 'ไม่พบ license');
    return { status: 200, body: { url: viewLink(l, base) } };
  }
  if (req.method === 'GET' && m && m[2] === 'shop') {
    const l = getLicenseById(Number(m[1]));
    if (!l) throw new HttpError(404, 'ไม่พบ license');
    return { status: 200, body: await shopInfo(l) };
  }
  if (req.method === 'GET' && m && m[2] === 'events') {
    return { status: 200, body: db.prepare('SELECT at, kind, detail FROM events WHERE license_id = ? ORDER BY id DESC LIMIT 50').all(Number(m[1])) };
  }
  if (req.method === 'POST' && m) {
    await adminAction(Number(m[1]), m[2], await readBody(req, m[2] === 'image' ? IMAGE_MAX + 1000 : undefined));
    return { status: 200, body: { ok: true } };
  }
  throw new HttpError(404, 'Not found');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  const ip = clientIp(req);
  const base = publicBase(req);
  const adminSide = onAdminDomain(req);
  try {
    if (adminSide) {
      // ---- แผงควบคุม (โดเมนผู้ดูแล)
      if (req.method === 'GET' && (p === '/admin' || p === '/admin/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': ADMIN_CSP, ...SEC_HEADERS });
        return res.end(ADMIN_HTML);
      }
      const im = req.method === 'GET' ? /^\/admin\/api\/licenses\/(\d+)\/image$/.exec(p) : null;
      if (im) {
        requireAdmin(req);
        const row = db.prepare('SELECT image FROM licenses WHERE id = ?').get(Number(im[1])) as { image: string } | undefined;
        const mm = row && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(row.image);
        if (!mm) throw new HttpError(404, 'ไม่มีรูป');
        res.writeHead(200, { 'Content-Type': mm[1], 'Cache-Control': 'private, max-age=86400', ...SEC_HEADERS });
        return res.end(Buffer.from(mm[2], 'base64'));
      }
      const dl = req.method === 'GET' ? /^\/admin\/api\/licenses\/(\d+)\/backups\/([\w.-]+)$/.exec(p) : null;
      if (dl) {
        requireAdmin(req);
        const l = getLicenseById(Number(dl[1]));
        const path = l && backupPath(l.slug, dl[2]);
        if (!path) throw new HttpError(404, 'ไม่พบไฟล์สำรอง');
        res.writeHead(200, {
          'Content-Type': 'application/vnd.sqlite3', 'Content-Length': statSync(path).size,
          'Content-Disposition': `attachment; filename="${dl[2]}"`, 'Cache-Control': 'no-store', ...SEC_HEADERS,
        });
        return createReadStream(path).pipe(res);
      }
      if (p.startsWith('/admin/api/')) {
        const r = await handleAdminApi(req, p, base, ip);
        return json(res, r.status, r.body, r.cookie ? { 'Set-Cookie': r.cookie } : {});
      }
    }

    // ---- API ของแอป (เปิดใช้งาน / ตรวจ license)
    if (req.method === 'POST' && p === '/api/activate') return json(res, 200, await activate(await readBody(req), ip, base));
    if (req.method === 'POST' && p === '/api/check') return json(res, 200, await check(await readBody(req), ip, base));
    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, mode: prov.mode });

    // ---- ประตูเข้าร้าน (โดเมนของแอป — โหมดทดสอบใช้โดเมนเดียวกับแผงควบคุม)
    if (!ADMIN_DOMAIN || !adminSide) {
      // ลิงก์ "เปิดระบบร้าน" จากแผงควบคุม: /shop/<ชื่อย่อ>?t=<token> · /shop/ = ออกจากหน้าร้าน
      const pick = /^\/(?:shop|s)(?:\/([^/]*))?\/?$/.exec(p);
      if (req.method === 'GET' && pick) {
        const slug = pick[1] ?? '';
        const ok = !slug || (ADMIN_DOMAIN ? useViewToken(url.searchParams.get('t') ?? '', slug) : isAdmin(req));
        return selectShop(req, res, ok ? slug : '', adminHome());
      }
      // ไม่มี X-POS-Shop: ระบบภายนอกที่ใช้ API key → ร้านหลัก (ร้านตรวจ key เอง) · ช่วงย้ายระบบ → แอปรุ่นเก่าเข้าร้านหลักได้
      const toMain = !!MAIN_SLUG && (LEGACY_MAIN || !!req.headers['x-api-key']);
      const shop = shopOf(req) ?? (toMain ? { slug: MAIN_SLUG, machine: '', view: true } : null);
      if (shop) return proxyToShop(req, res, shop, shop.view || (!shop.machine && isAdmin(req)));
      return appOnly(res); // เบราว์เซอร์ที่ไม่ได้มาจากแผงควบคุม
    }

    if (req.method === 'GET' && p === '/') {
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    json(res, status, { ok: false, error: e instanceof Error ? e.message : 'Server error', code: e instanceof HttpError ? e.code : '' });
  }
});

/** ที่อยู่แผงควบคุม (ใช้เป็นลิงก์กลับหลังออกจากหน้าร้าน) */
const adminHome = () => (ADMIN_DOMAIN ? `https://${ADMIN_DOMAIN}/admin` : '/admin');

/** เปิดผ่านเบราว์เซอร์ตรง ๆ ไม่ได้ — ใช้ได้เฉพาะในแอป (ผู้ดูแลเปิดดูร้านได้จากแผงควบคุม) */
function appOnly(res: ServerResponse) {
  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clothing POS</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f4f6fb;color:#1e293b">
<div style="text-align:center;max-width:420px;padding:24px"><h2>Clothing POS</h2>
<p>ระบบนี้ใช้งานผ่านโปรแกรมที่ติดตั้งในร้านเท่านั้น</p></div></body>`);
}

// เปิดใหม่ (โหมดทดสอบ): ร้านที่เคยทำงานอยู่ → เปิดกลับมา · systemd เปิดเองอยู่แล้ว
async function resume() {
  if (!LOCAL) return;
  const rows = db.prepare("SELECT * FROM instances WHERE state = 'running'").all() as unknown as Instance[];
  for (const i of rows) {
    if (isMain(i.slug)) continue; // ร้านหลักมีบริการของตัวเองอยู่แล้ว (pos.service) — ห้ามเปิดซ้ำ
    await prov.start(i.slug, i.port, i.manager_pin).catch((e) => setState(i.slug, 'error', e.message));
  }
}

server.listen(PORT, process.env.LICENSE_HOST ?? '127.0.0.1', async () => {
  console.log('\n  Clothing POS — License server');
  console.log(`  แผงควบคุม    → http://localhost:${PORT}/admin`);
  if (LOCAL && !process.env.ADMIN_PASSWORD) console.log(`  รหัสผ่าน      → ${ADMIN_PASSWORD}   (เปลี่ยนได้ที่ ${PASSWORD_FILE})`);
  if (LOCAL) console.log(`  เปิดผ่าน ngrok → ngrok http ${PORT}   (แผงควบคุม + แอป + ทุกร้าน ใช้ลิงก์เดียวกัน)`);
  console.log(`  ฐานข้อมูล    → ${DB_PATH}`);
  console.log(`  ไฟล์สำรองร้าน → ${BACKUP_ROOT}`);
  console.log(`  สร้างร้านแบบ → ${prov.mode}\n`);
  ensureMainShop();
  await resume();
  await sweep();
  setInterval(() => {
    sweep().catch((e) => console.error('[sweep]', e));
    pruneGuards();
    for (const [t, exp] of sessions) if (exp < Date.now()) sessions.delete(t);
  }, 5 * 60_000);
});

const shutdown = () => {
  prov.stopAll?.();
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
