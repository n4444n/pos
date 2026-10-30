// หาข้อความไทยในหน้าจอ (src/) ที่ยังไม่มีคำแปลอังกฤษใน src/i18n/phrases.ts
// ใช้:  node scripts/i18n-extract.cjs            → แสดงรายการที่ยังไม่แปล
//       node scripts/i18n-extract.cjs --json     → พิมพ์เป็น JSON { "ข้อความไทย": "" } ไว้เติมคำแปลแล้ววางใน phrases.ts
// ไม่รวม print.ts / receiptText.ts (ใบเสร็จมีตั้งค่าภาษาของตัวเอง) และ src/i18n/
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const TH = /[ก-ฺเ-๛]/;
const SKIP = new Set(['print.ts', 'receiptText.ts']);
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const src = fs.readFileSync(path.join(root, 'i18n', 'phrases.ts'), 'utf8');
const grab = (start, end) => JSON.parse(src.slice(src.indexOf('=', src.indexOf(start)) + 1, src.indexOf(end, src.indexOf(start))).trim().replace(/;$/, ''));
const phrases = grab('export const PHRASES', ';\n\n');
const patterns = grab('export const PATTERNS', ';\n');
const known = new Set([...Object.keys(phrases), ...patterns.map((p) => p[0])].map(norm));

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'i18n') walk(p); }
    else if (/\.tsx?$/.test(f) && !SKIP.has(f)) files.push(p);
  }
})(root);

const missing = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (s) => {
    s = norm(s);
    if (!TH.test(s) || known.has(s) || /<!doctype|<style|box-sizing/.test(s)) return;
    if (!missing.has(s)) missing.set(s, new Set());
    missing.get(s).add(path.relative(root, f));
  };
  (function visit(n) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text);
    else if (ts.isTemplateExpression(n)) {
      let s = n.head.text;
      n.templateSpans.forEach((sp, i) => { s += `{${i}}` + sp.literal.text; });
      add(s);
    } else if (ts.isJsxText(n)) add(n.text);
    ts.forEachChild(n, visit);
  })(sf);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries([...missing.keys()].map((k) => [k, ''])), null, 1));
} else {
  for (const [k, f] of missing) console.log(`${[...f].join(',')}\t${k}`);
  console.log(`\nยังไม่มีคำแปล ${missing.size} ข้อความ (มีแล้ว ${known.size})`);
}
