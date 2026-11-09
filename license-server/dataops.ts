// อ่าน/วางไฟล์ข้อมูลของร้าน สำหรับระบบสำรองข้อมูลทั้งระบบ (sysbackup.ts)
//   VPS (systemd): ข้อมูลร้านเป็นของผู้ใช้ pos — ระบบ license (ผู้ใช้ poslic) อ่านตรงไม่ได้
//                  จึงสั่งผ่าน sudo pos-trial-ctl data-* (deploy/pos-trial-ctl.sh) ซึ่งคัดลอกเข้า/ออกโฟลเดอร์ .staging
//   ทดสอบ (local): อ่าน/เขียนไฟล์ตรง ๆ บนเครื่องนี้
// เป้าหมาย (target): '@main' = ร้านหลัก (pos.service) · ชื่อย่อร้าน = ร้านทดลอง (pos-trial@<ร้าน>)
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MAIN_TARGET = '@main';

export interface DataOps {
  readonly mode: 'systemd' | 'local';
  /** โฟลเดอร์พักไฟล์ (ระบบ license อ่าน/เขียนได้) */
  readonly stage: string;
  init(): Promise<void>;
  /** เวลาแก้ไขล่าสุด (ms) ของฐานข้อมูลร้าน (.db / -wal) · null = ยังไม่มีข้อมูล */
  stat(target: string): Promise<number | null>;
  /** สำเนาข้อมูลร้านไปที่ <stage>/<job>: pos.db (VACUUM INTO) + .pin-secret + uploads/ (ถ้า withFiles) */
  snap(target: string, job: string, withFiles: boolean): Promise<string>;
  /** หยุดร้าน → ย้ายไฟล์เดิมไป .restore-old → วางไฟล์จาก <stage>/<job> → เปิดร้าน (ถ้าเดิมเปิดอยู่) · คืน true = เปิดร้านแล้ว */
  restore(target: string, job: string): Promise<boolean>;
  /** ย้อนกลับไปใช้ไฟล์ใน .restore-old (หลังกู้คืนแล้วร้านไม่ขึ้น) */
  rollback(target: string): Promise<boolean>;
}

const JOB_RE = /^[a-z0-9-]{1,60}$/;
const checkJob = (job: string) => {
  if (!JOB_RE.test(job)) throw new Error(`ชื่องานไม่ถูกต้อง: ${job}`);
};

// ---------------------------------------------------------------- VPS
class HelperOps implements DataOps {
  readonly mode = 'systemd' as const;
  readonly stage: string;
  private ctl: string;
  constructor(ctl: string, root: string) {
    this.ctl = ctl;
    this.stage = join(root, '.staging');
  }
  private run(args: string[], timeout = 300_000) {
    return new Promise<string>((ok, fail) => {
      execFile('sudo', ['-n', this.ctl, ...args], { timeout, maxBuffer: 1 << 20 }, (err, out, errOut) =>
        err ? fail(new Error(`${args[0]}: ${String(errOut || err.message).trim().split('\n').slice(-3).join(' / ')}`)) : ok(String(out).trim()),
      );
    });
  }
  async init() {
    await this.run(['data-init']);
  }
  async stat(target: string) {
    const out = await this.run(['data-stat', target], 30_000);
    return out === 'missing' ? null : Number(out) || 0;
  }
  async snap(target: string, job: string, withFiles: boolean) {
    checkJob(job);
    await this.run(['data-snap', target, job, withFiles ? '1' : '0']);
    return join(this.stage, job);
  }
  async restore(target: string, job: string) {
    checkJob(job);
    return (await this.run(['data-restore', target, job])).endsWith('started');
  }
  async rollback(target: string) {
    return (await this.run(['data-rollback', target])).endsWith('started');
  }
}

// ---------------------------------------------------------------- ทดสอบบนเครื่องเดียว
type ShopCtl = { stop(target: string): Promise<boolean>; start(target: string): Promise<void> };

class LocalOps implements DataOps {
  readonly mode = 'local' as const;
  readonly stage: string;
  private mainDb: string;
  private trialRoot: string;
  private ctl: ShopCtl;
  constructor(root: string, mainDb: string, trialRoot: string, ctl: ShopCtl) {
    this.stage = join(root, '.staging');
    this.mainDb = mainDb;
    this.trialRoot = trialRoot;
    this.ctl = ctl;
  }
  private dbOf(target: string) {
    if (target === MAIN_TARGET) return this.mainDb;
    if (!/^[a-z0-9-]{1,30}$/.test(target)) throw new Error(`ชื่อร้านไม่ถูกต้อง: ${target}`);
    return join(this.trialRoot, target, 'pos.db');
  }
  async init() {
    mkdirSync(this.stage, { recursive: true, mode: 0o700 });
  }
  async stat(target: string) {
    const db = this.dbOf(target);
    if (!existsSync(db)) return null;
    let t = statSync(db).mtimeMs;
    if (existsSync(`${db}-wal`)) t = Math.max(t, statSync(`${db}-wal`).mtimeMs);
    return Math.floor(t);
  }
  async snap(target: string, job: string, withFiles: boolean) {
    checkJob(job);
    const src = this.dbOf(target);
    if (!existsSync(src)) throw new Error('ยังไม่มีฐานข้อมูลของร้านนี้');
    const out = join(this.stage, job);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const c = new DatabaseSync(src, { readOnly: true });
    try {
      c.exec('PRAGMA busy_timeout = 10000');
      c.exec(`VACUUM INTO '${join(out, 'pos.db').replace(/'/g, "''")}'`);
    } finally {
      c.close();
    }
    const dir = dirname(src);
    if (existsSync(join(dir, '.pin-secret'))) copyFileSync(join(dir, '.pin-secret'), join(out, '.pin-secret'));
    if (withFiles && existsSync(join(dir, 'uploads'))) cpSync(join(dir, 'uploads'), join(out, 'uploads'), { recursive: true });
    return out;
  }
  async restore(target: string, job: string) {
    checkJob(job);
    const src = join(this.stage, job);
    if (!existsSync(join(src, 'pos.db'))) throw new Error('ไม่พบไฟล์ที่จะกู้คืน');
    const db = this.dbOf(target);
    const dir = dirname(db);
    const name = basename(db);
    const wasRunning = await this.ctl.stop(target);
    mkdirSync(dir, { recursive: true });
    const old = join(dir, '.restore-old');
    rmSync(old, { recursive: true, force: true });
    mkdirSync(old, { recursive: true });
    for (const f of [name, `${name}-wal`, `${name}-shm`]) if (existsSync(join(dir, f))) moveRetry(join(dir, f), join(old, f));
    if (existsSync(join(src, '.pin-secret'))) {
      if (existsSync(join(dir, '.pin-secret'))) renameSync(join(dir, '.pin-secret'), join(old, '.pin-secret'));
      copyFileSync(join(src, '.pin-secret'), join(dir, '.pin-secret'));
    }
    if (existsSync(join(src, 'uploads'))) {
      if (existsSync(join(dir, 'uploads'))) renameSync(join(dir, 'uploads'), join(old, 'uploads'));
      cpSync(join(src, 'uploads'), join(dir, 'uploads'), { recursive: true });
    }
    copyFileSync(join(src, 'pos.db'), db);
    if (wasRunning) await this.ctl.start(target);
    return wasRunning;
  }
  async rollback(target: string) {
    const db = this.dbOf(target);
    const dir = dirname(db);
    const old = join(dir, '.restore-old');
    if (!existsSync(old)) throw new Error('ไม่มีไฟล์เดิมให้ย้อนกลับ');
    const wasRunning = await this.ctl.stop(target);
    const name = basename(db);
    for (const f of [name, `${name}-wal`, `${name}-shm`]) rmSync(join(dir, f), { force: true });
    for (const f of readdirSync(old)) {
      rmSync(join(dir, f), { recursive: true, force: true });
      renameSync(join(old, f), join(dir, f));
    }
    rmSync(old, { recursive: true, force: true });
    if (!wasRunning) return false;
    await this.ctl.start(target);
    return true;
  }
}

/** Windows ล็อกไฟล์ฐานข้อมูลสักพักหลังโปรเซสจบ — ลองย้ายซ้ำ */
function moveRetry(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      return renameSync(from, to);
    } catch (e) {
      if (i >= 20) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

export function makeDataOps(mode: 'systemd' | 'local', root: string, ctl: ShopCtl): DataOps {
  if (mode === 'systemd') return new HelperOps(process.env.TRIAL_CTL ?? '/usr/local/bin/pos-trial-ctl', root);
  const posDir = resolve(process.env.POS_DIR ?? '..');
  return new LocalOps(
    root,
    resolve(process.env.MAIN_DB ?? join(posDir, 'data', 'pos.db')),
    resolve(process.env.TRIAL_DATA ?? 'data/trials'),
    ctl,
  );
}
