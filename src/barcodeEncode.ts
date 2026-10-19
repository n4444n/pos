// เข้ารหัสบาร์โค้ด → รายการความกว้าง (หน่วยโมดูล) สลับ แท่ง/ช่องว่าง เริ่มด้วยแท่งเสมอ
// ใช้ร่วมกันทั้งบาร์โค้ดบนจอ ป้ายบาร์โค้ดที่พิมพ์ และตัวอย่างในหน้าตั้งค่า (ไม่มี import ของ React Native)

/** ประเภทบาร์โค้ดบนป้าย · auto = ตามตั้งค่าร้าน (เมนู บาร์โค้ด) */
export type Symbology = 'auto' | 'code128' | 'code128b' | 'ean13' | 'ean8' | 'upca' | 'code39';

export const SYMBOLOGIES: { id: Exclude<Symbology, 'auto'>; label: string; hint: string }[] = [
  { id: 'code128', label: 'Code 128 อัตโนมัติ', hint: 'ทุกรหัส · ตัวเลขยาวจะได้บาร์โค้ดสั้นลง (แนะนำ)' },
  { id: 'code128b', label: 'Code 128-B', hint: 'ทุกรหัส · แบบเดิม' },
  { id: 'ean13', label: 'EAN-13', hint: 'ตัวเลข 13 หลัก' },
  { id: 'ean8', label: 'EAN-8', hint: 'ตัวเลข 8 หลัก' },
  { id: 'upca', label: 'UPC-A', hint: 'ตัวเลข 12 หลัก' },
  { id: 'code39', label: 'Code 39', hint: 'A–Z (ตัวใหญ่) 0–9 - . $ / + % เว้นวรรค' },
];

/** ตาราง Code 128 (ความกว้าง แท่ง/ช่อง สลับกัน) — ค่า 0–106 */
const P = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
  '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
  '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

const printable = (t: string) => !!t && [...t].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
const c128 = (codes: number[]) => {
  const check = codes.reduce((sum, c, i) => sum + c * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, check, 106].flatMap((c) => P[c].split('').map(Number));
};

/** Code 128-B (ตัวอักษร ASCII 32–126) */
export function code128(text: string): number[] | null {
  if (!printable(text)) return null;
  return c128([104, ...[...text].map((c) => c.charCodeAt(0) - 32)]);
}

/** Code 128 อัตโนมัติ: ใช้ชุด C (ตัวเลข 2 หลัก/ช่อง) กับตัวเลขที่ยาวต่อกัน ≥ 4 หลัก ที่เหลือใช้ชุด B → บาร์โค้ดสั้นลง */
export function code128Auto(text: string): number[] | null {
  if (!printable(text)) return null;
  const digitsAt = (i: number) => {
    let n = 0;
    while (i + n < text.length && text[i + n] >= '0' && text[i + n] <= '9') n++;
    return n;
  };
  const codes: number[] = [];
  let set: 'B' | 'C' | null = null;
  let i = 0;
  while (i < text.length) {
    const run = digitsAt(i);
    // ใช้ชุด C เมื่อมีตัวเลขต่อกัน ≥ 4 (หรือทั้งรหัสเป็นตัวเลข 2 หลัก) — ถ้าเป็นจำนวนคี่ ส่งหลักแรกด้วยชุด B ก่อน
    const useC = run >= 4 || (run === 2 && i === 0 && text.length === 2);
    if (useC && run % 2 === 1) {
      if (set !== 'B') { codes.push(set === null ? 104 : 100); set = 'B'; }
      codes.push(text.charCodeAt(i) - 32);
      i++;
      continue;
    }
    if (useC) {
      if (set !== 'C') { codes.push(set === null ? 105 : 99); set = 'C'; }
      while (digitsAt(i) >= 2) {
        codes.push(Number(text.slice(i, i + 2)));
        i += 2;
      }
      continue;
    }
    if (set !== 'B') { codes.push(set === null ? 104 : 100); set = 'B'; }
    codes.push(text.charCodeAt(i) - 32);
    i++;
  }
  return c128(codes);
}

const L = '0001101 0011001 0010011 0111101 0100011 0110001 0101111 0111011 0110111 0001011'.split(' ');
const G = '0100111 0110011 0011011 0100001 0011101 0111001 0000101 0010001 0001001 0010111'.split(' ');
const R = '1110010 1100110 1101100 1000010 1011100 1001110 1010000 1000100 1001000 1110100'.split(' ');
const PARITY = 'LLLLLL LLGLGG LLGGLG LLGGGL LGLLGG LGGLLG LGGGLL LGLGLG LGLGGL LGGLGL'.split(' ');

/** สตริง 0/1 → ความกว้างแท่ง/ช่อง (เริ่มด้วยแท่ง) */
function runs(bits: string) {
  const out: number[] = [];
  let cur = bits[0];
  let n = 0;
  for (const b of bits) {
    if (b === cur) n++;
    else {
      out.push(n);
      cur = b;
      n = 1;
    }
  }
  out.push(n);
  return out;
}

/** check digit ของ EAN/UPC (น้ำหนัก 3,1 สลับจากหลักขวาสุด) */
export function gtinCheck(body: string) {
  const sum = [...body].reverse().reduce((a, c, i) => a + Number(c) * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
/**
 * ตรวจ check digit: ต้องยาวครบ n หลักและถูกต้องเท่านั้น
 * (ไม่เติมให้เอง — เพราะสแกนแล้วจะได้รหัสที่มีหลักเพิ่ม ไม่ตรงกับรหัสสินค้าในระบบ → ใช้ Code 128 แทน)
 */
function withCheck(text: string, n: number): string | null {
  if (new RegExp(`^\\d{${n}}$`).test(text) && gtinCheck(text.slice(0, -1)) === text.slice(-1)) return text;
  return null;
}

/** EAN-13 (ตัวเลข 13 หลัก check digit ถูกต้อง) */
export function ean13(text: string): number[] | null {
  const t = withCheck(text, 13);
  if (!t) return null;
  const d = [...t].map(Number);
  const par = PARITY[d[0]];
  return runs('101' + d.slice(1, 7).map((n, i) => (par[i] === 'L' ? L : G)[n]).join('') + '01010' + d.slice(7).map((n) => R[n]).join('') + '101');
}

/** EAN-8 (ตัวเลข 8 หลัก check digit ถูกต้อง) */
export function ean8(text: string): number[] | null {
  const t = withCheck(text, 8);
  if (!t) return null;
  const d = [...t].map(Number);
  return runs('101' + d.slice(0, 4).map((n) => L[n]).join('') + '01010' + d.slice(4).map((n) => R[n]).join('') + '101');
}

/** UPC-A (ตัวเลข 12 หลัก check digit ถูกต้อง) — แท่งเหมือน EAN-13 ที่ขึ้นต้นด้วย 0 */
export function upca(text: string): number[] | null {
  const t = withCheck(text, 12);
  return t ? ean13('0' + t) : null;
}

/** Code 39: n = แคบ, w = กว้าง (แท่ง/ช่อง สลับ 9 ช่อง) */
const C39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw',
  E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww',
  L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
  S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};
/** Code 39 · แท่งกว้าง = 3 เท่าของแท่งแคบ · ไม่รับตัวพิมพ์เล็ก (สแกนแล้วจะได้ตัวใหญ่ ไม่ตรงกับรหัสในระบบ) */
export function code39(text: string): number[] | null {
  const t = text;
  if (!t || [...t].some((c) => c === '*' || !C39[c])) return null;
  const out: number[] = [];
  [...`*${t}*`].forEach((c, i) => {
    if (i > 0) out.push(1); // ช่องว่างระหว่างตัวอักษร
    for (const e of C39[c]) out.push(e === 'w' ? 3 : 1);
  });
  return out;
}

/**
 * เข้ารหัสตามประเภท · รหัสที่ใช้กับประเภทนั้นไม่ได้ (เช่น มีตัวอักษรแต่เลือก EAN-13) → ใช้ Code 128 อัตโนมัติแทน
 * @returns widths + ประเภทที่ใช้จริง (ไว้เตือนในหน้าตั้งค่า)
 */
export function encodeBarcode(code: string, sym: Exclude<Symbology, 'auto'>): { widths: number[]; used: Exclude<Symbology, 'auto'> } | null {
  const fn = { code128: code128Auto, code128b: code128, ean13, ean8, upca, code39 }[sym] ?? code128Auto;
  const w = fn(code);
  if (w) return { widths: w, used: sym };
  const f = code128Auto(code);
  return f ? { widths: f, used: 'code128' } : null;
}
