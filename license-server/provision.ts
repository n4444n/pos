// สร้าง/เปิด/ปิด instance ของร้านทดลอง
//   PROVISIONER=systemd (VPS)  → เรียก sudo pos-trial-ctl (สร้างโฟลเดอร์ข้อมูล + systemd pos-trial@<slug>)
//   PROVISIONER=local (ทดสอบ)  → รันเซิร์ฟเวอร์ POS เป็น child process บนเครื่องนี้ (localhost:<port>)
// ทั้งสองแบบ: ทุกร้านอยู่หลังประตูเดียวของเซิร์ฟเวอร์ license (gateway.ts) ไม่มีโดเมนแยกต่อร้าน
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Provisioner {
  readonly mode: 'systemd' | 'local';
  /** ที่อยู่ร้านสำหรับผู้ใช้ · base = ที่อยู่สาธารณะของเซิร์ฟเวอร์ license (เช่น https://xxx.ngrok-free.dev) */
  shopUrl(slug: string, base: string): string;
  /** สร้าง (ครั้งแรก) แล้วเปิดบริการ — pin = PIN ผู้จัดการเริ่มต้น */
  create(slug: string, port: number, pin: string): Promise<void>;
  start(slug: string, port: number, pin: string): Promise<void>;
  stop(slug: string): Promise<void>;
  /** ลบร้าน (หลังหยุดแล้ว) — ข้อมูลถูกย้ายไปเก็บ ไม่ลบทิ้งจริง */
  remove(slug: string): Promise<string>;
}

/** token ของ API ภายในร้าน (shopdata.ts) */
type TokenFor = (slug: string) => string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** รอจนเซิร์ฟเวอร์ POS ของร้านตอบ /api/health (ครั้งแรกสร้างฐานข้อมูล + สินค้าตัวอย่าง ใช้เวลาไม่กี่วินาที) */
export async function waitHealthy(port: number, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await sleep(500);
  }
  throw new Error(`เซิร์ฟเวอร์ร้านไม่ตอบภายใน ${Math.round(timeoutMs / 1000)} วินาที (${last})`);
}

// ---------------------------------------------------------------- VPS (systemd + Caddy)
class SystemdProvisioner implements Provisioner {
  readonly mode = 'systemd' as const;
  private ctl: string;
  /** ที่อยู่ของแอป (APP_BASE) เช่น https://pos.sh0p.tech */
  private domain: string;
  private tokenFor: TokenFor;
  constructor(ctl: string, domain: string, tokenFor: TokenFor) {
    this.ctl = ctl;
    this.domain = domain;
    this.tokenFor = tokenFor;
  }
  /** ทุกร้านอยู่หลังโดเมนเดียว — ลิงก์นี้ใช้เปิดดูร้านจากแผงควบคุม (ต้องมี token ต่อท้าย) */
  shopUrl(slug: string, base: string) {
    return `${this.domain || base}/shop/${slug}`;
  }
  private run(args: string[], stdin = '') {
    return new Promise<void>((ok, fail) => {
      const p = execFile('sudo', ['-n', this.ctl, ...args], { timeout: 120_000 }, (err, _out, errOut) =>
        err ? fail(new Error(`${args[0]}: ${String(errOut || err.message).trim().split('\n').slice(-3).join(' / ')}`)) : ok(),
      );
      p.stdin?.end(stdin);
    });
  }
  async create(slug: string, port: number, pin: string) {
    await this.run(['create', slug, String(port)], `${pin}\n${this.tokenFor(slug)}\n`); // PIN + token ส่งทาง stdin (ไม่โผล่ใน ps)
    await waitHealthy(port);
  }
  async start(slug: string, port: number) {
    await this.run(['start', slug], `${this.tokenFor(slug)}\n`);
    await waitHealthy(port);
  }
  stop(slug: string) {
    return this.run(['stop', slug]);
  }
  /** ปิด + ถอดโดเมน + ย้ายข้อมูลไป /var/lib/pos-trial/_deleted — ร้านใหม่ชื่อเดิมจะไม่เห็นข้อมูลร้านเก่า */
  async remove(slug: string) {
    await this.run(['delete', slug]);
    return `ย้ายข้อมูลร้านไป /var/lib/pos-trial/_deleted/${slug}-<เวลา>`;
  }
}

// ---------------------------------------------------------------- ทดสอบบนเครื่องเดียว
class LocalProvisioner implements Provisioner {
  readonly mode = 'local' as const;
  private procs = new Map<string, ChildProcess>();
  private posDir: string;
  private dataRoot: string;
  private tokenFor: TokenFor;
  constructor(posDir: string, dataRoot: string, tokenFor: TokenFor) {
    this.posDir = posDir;
    this.dataRoot = dataRoot;
    this.tokenFor = tokenFor;
  }
  shopUrl(slug: string, base: string) {
    return `${base}/shop/${slug}`;
  }
  async create(slug: string, port: number, pin: string) {
    await this.start(slug, port, pin);
  }
  async start(slug: string, port: number, pin: string) {
    if (this.procs.get(slug)?.exitCode === null) return;
    const dir = join(this.dataRoot, slug);
    mkdirSync(dir, { recursive: true });
    const log = openSync(join(dir, 'server.log'), 'a');
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', join(this.posDir, 'server', 'index.ts')],
      {
        cwd: this.posDir,
        env: {
          ...process.env,
          ADMIN_PASSWORD: '', // ไม่ส่งรหัสแผงควบคุมต่อให้ร้าน
          NODE_ENV: 'production',
          PORT: String(port),
          DB_PATH: join(dir, 'pos.db'),
          WEB_DIR: join(this.posDir, 'dist'),
          POS_MANAGER_PIN: pin,
          POS_NO_DEMO_PINS: '1',
          POS_INTERNAL_TOKEN: this.tokenFor(slug), // ให้เซิร์ฟเวอร์ license ขอสถิติ/สำรองข้อมูลได้
        },
        stdio: ['ignore', log, log],
      },
    );
    closeSync(log); // ลูกถือไฟล์ log เองแล้ว — ถ้าเซิร์ฟเวอร์ license ถือค้างไว้ Windows จะย้าย/ลบโฟลเดอร์ร้านไม่ได้
    this.procs.set(slug, child);
    child.on('exit', () => this.procs.get(slug) === child && this.procs.delete(slug));
    await waitHealthy(port, 30_000);
  }
  async stop(slug: string) {
    const p = this.procs.get(slug);
    if (!p) return;
    this.procs.delete(slug);
    // รอให้ปิดจริง (Windows ล็อกไฟล์ฐานข้อมูลจนกว่าโปรเซสจะจบ)
    const exited = new Promise<void>((ok) => (p.exitCode !== null ? ok() : p.once('exit', () => ok())));
    p.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  /** ย้ายข้อมูลร้านไป data/trials/_deleted/<slug>-<เวลา> (กู้คืนเองได้ · ร้านใหม่ชื่อเดิมเริ่มจากศูนย์) */
  async remove(slug: string) {
    await this.stop(slug);
    const dir = join(this.dataRoot, slug);
    if (!existsSync(dir)) return '';
    const trash = join(this.dataRoot, '_deleted');
    mkdirSync(trash, { recursive: true });
    const dest = join(trash, `${slug}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
    for (let i = 0; ; i++) {
      try {
        renameSync(dir, dest);
        return `ย้ายข้อมูลร้านไป ${dest}`;
      } catch (e) {
        if (i >= 19) throw new Error(`ย้ายข้อมูลร้านไม่สำเร็จ (ไฟล์ถูกใช้งานอยู่?) — ลองใหม่อีกครั้ง: ${(e as Error).message}`);
        await sleep(500);
      }
    }
  }
  stopAll() {
    for (const p of this.procs.values()) p.kill();
  }
}

export function makeProvisioner(tokenFor: TokenFor): Provisioner & { stopAll?: () => void } {
  const mode = process.env.PROVISIONER ?? 'local';
  if (mode === 'systemd') {
    return new SystemdProvisioner(process.env.TRIAL_CTL ?? '/usr/local/bin/pos-trial-ctl', (process.env.APP_BASE ?? '').replace(/\/+$/, ''), tokenFor);
  }
  return new LocalProvisioner(
    resolve(process.env.POS_DIR ?? '..'),
    resolve(process.env.TRIAL_DATA ?? 'data/trials'),
    tokenFor,
  );
}
