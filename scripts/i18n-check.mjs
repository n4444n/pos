// ตรวจคำแปลสองภาษา — รันด้วย:  node scripts/i18n-check.mjs
//
// บอก 3 อย่าง
//   1. คีย์ที่มีในไทย แต่ยังไม่มีคำแปลอังกฤษ   (หน้าจอจะแสดงภาษาไทยแทนไปก่อน)
//   2. คีย์ที่มีในอังกฤษ แต่ไม่มีในไทย        (สะกดผิด หรือลืมลบ)
//   3. คีย์ที่โค้ดเรียกใช้ t('...') แต่ไม่มีในไฟล์คำแปลเลย  (จะโชว์รหัสดิบบนจอ)
//
// ออก exit code 1 เมื่อเจอข้อ 2 หรือ 3 (ของจริงที่พัง) · ข้อ 1 แค่เตือน
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** ดึงคีย์แบบจุดทั้งหมดจากไฟล์คำแปล (อ่านเป็นข้อความ ไม่ต้อง compile TS) */
function keysOf(file) {
  const src = readFileSync(join(root, 'src/i18n', file), 'utf8');
  const out = new Set();
  const path = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('import') || line.startsWith('type ')) continue;
    const open = line.match(/^(\w+)\s*:\s*\{$/);
    if (open) {
      path.push(open[1]);
      continue;
    }
    if (line.startsWith('}')) {
      path.pop();
      continue;
    }
    const kv = line.match(/^(\w+)\s*:\s*['"`]/);
    if (kv && path.length) out.add([...path, kv[1]].join('.'));
  }
  return out;
}

/** คีย์ที่โค้ดเรียกใช้จริง — t('a.b') หรือ translate(lang, 'a.b') */
function usedKeys() {
  const out = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== 'node_modules' && name !== 'i18n') walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      const src = readFileSync(p, 'utf8');
      // คีย์ของระบบนี้มีจุดเสมอ (กลุ่ม.ชื่อ) — t('staff') ของใบเสร็จใช้คนละระบบ ไม่นับ
      for (const m of src.matchAll(/\bt\(\s*'([\w]+(?:\.[\w]+)+)'/g)) out.add(m[1]);
      for (const m of src.matchAll(/\btranslate\(\s*\w+\s*,\s*'([\w]+(?:\.[\w]+)+)'/g)) out.add(m[1]);
    }
  };
  walk(join(root, 'src'));
  return out;
}

const thKeys = keysOf('th.ts');
const enKeys = keysOf('en.ts');
const used = usedKeys();

const missingEn = [...thKeys].filter((k) => !enKeys.has(k)).sort();
const extraEn = [...enKeys].filter((k) => !thKeys.has(k)).sort();
const unknown = [...used].filter((k) => !thKeys.has(k)).sort();

console.log(`คำแปล: ไทย ${thKeys.size} คีย์ · อังกฤษ ${enKeys.size} คีย์ · โค้ดเรียกใช้ ${used.size} คีย์`);

if (missingEn.length) {
  console.log(`\n[เตือน] ยังไม่มีคำแปลอังกฤษ ${missingEn.length} คีย์ (หน้าจอจะแสดงภาษาไทยแทน)`);
  for (const k of missingEn.slice(0, 40)) console.log('   ' + k);
  if (missingEn.length > 40) console.log(`   … และอีก ${missingEn.length - 40} คีย์`);
}
if (extraEn.length) {
  console.log(`\n[ผิด] มีในอังกฤษแต่ไม่มีในไทย ${extraEn.length} คีย์ — สะกดผิดหรือลืมลบ`);
  for (const k of extraEn) console.log('   ' + k);
}
if (unknown.length) {
  console.log(`\n[ผิด] โค้ดเรียกคีย์ที่ไม่มีในไฟล์คำแปล ${unknown.length} คีย์ — จะโชว์รหัสดิบบนหน้าจอ`);
  for (const k of unknown) console.log('   ' + k);
}
if (!missingEn.length && !extraEn.length && !unknown.length) console.log('\nครบถ้วน ✓');

process.exit(extraEn.length || unknown.length ? 1 : 0);
