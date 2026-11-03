// สร้าง desktop/qr.js จาก src/qr.ts — รันเมื่อแก้ src/qr.ts เท่านั้น (ปกติไม่ต้องแตะ มาตรฐาน QR ไม่เปลี่ยน)
//   node scripts/qr-sync.mjs           เขียนทับ desktop/qr.js
//   node scripts/qr-sync.mjs --check   แค่ตรวจว่าตรงกันไหม (ออก exit 1 ถ้าไม่ตรง)
//
// หน้าจอของโปรแกรม .exe (activate.html / settings.html) เป็น HTML ธรรมดาไม่มี bundler
// จึงใช้ไฟล์ .ts ตรง ๆ ไม่ได้ ต้องมีสำเนาเป็น .js — สคริปต์นี้ถอด type ออกให้อัตโนมัติ
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const HEADER = `// QR Code encoder สำหรับหน้าจอของโปรแกรม .exe (activate.html / settings.html) — ไม่มี bundler จึงเป็น .js ธรรมดา
// สำเนาของ src/qr.ts (Project Nayuki "QR Code generator", MIT) — มาตรฐาน QR ไม่เปลี่ยน ไฟล์นี้จึงไม่ต้องแก้อีก
// ถ้าวันหนึ่งแก้ src/qr.ts แล้วอยากซิงก์:  node scripts/qr-sync.mjs
`;

function build() {
  let s = readFileSync(join(root, 'src/qr.ts'), 'utf8');
  s = s.replace(/^type Ecc =.*\n/m, '');
  s = s.replace(/\(get: \(i: number, j: number\) => boolean\)/g, '(get)');
  s = s.replace(/let inv: boolean;/g, 'let inv;');
  s = s
    .replace(/: boolean\[\]\[\] \| null/g, '')
    .replace(/: boolean\[\]\[\]/g, '')
    .replace(/: number\[\]\[\]/g, '')
    .replace(/: number\[\]/g, '');
  s = s.replace(/ as number/g, '');
  s = s.replace(/: Ecc = 1/g, ' = 1').replace(/: Ecc/g, '');
  // พารามิเตอร์ที่มี type — วนสองรอบเพราะ regex ตัวเดียวข้ามตัวที่ติดกันไป
  for (let i = 0; i < 2; i++) s = s.replace(/(\(|, )([A-Za-z_][A-Za-z0-9_]*): (number|string|boolean)\b/g, '$1$2');
  s = s.replace(/^export function/gm, 'function');
  s = HEADER + s.split('\n').slice(2).join('\n');
  s += '\nif (typeof module !== "undefined") module.exports = { qrMatrix, qrSvg };\n';
  const left = s.match(/: (number|string|boolean|Ecc)\b/);
  if (left) throw new Error(`ถอด type ไม่หมด: ${left[0]} — แก้ scripts/qr-sync.mjs`);
  return s;
}

const out = join(root, 'desktop/qr.js');
const next = build();
if (process.argv.includes('--check')) {
  const now = readFileSync(out, 'utf8');
  if (now === next) console.log('desktop/qr.js ตรงกับ src/qr.ts ✓');
  else {
    console.log('desktop/qr.js ไม่ตรงกับ src/qr.ts — รัน node scripts/qr-sync.mjs');
    process.exit(1);
  }
} else {
  writeFileSync(out, next);
  console.log('เขียน desktop/qr.js แล้ว');
}
