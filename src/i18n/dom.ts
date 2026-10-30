// แปลข้อความไทยบนหน้าจอทั้งแอปเป็นภาษาอังกฤษ (เฉพาะเว็บ / แอป Clothing POS)
//
// ทำไมต้องมี: หน้าจอส่วนใหญ่เขียนข้อความไทยไว้ตรง ๆ ในโค้ด (หลายพันข้อความ)
// แทนที่จะแก้ทุกบรรทัดเป็น t('...') ระบบนี้คอยดูหน้าจอ (MutationObserver) แล้วเปลี่ยนข้อความที่ตรงกับ
// พจนานุกรม phrases.ts เป็นภาษาอังกฤษ — ทั้งตัวหนังสือ, placeholder, aria-label, title, alert/confirm
//
// - เลือก TH กลับ → คืนข้อความเดิมทุกจุดทันที (จำต้นฉบับไว้)
// - ไม่แตะค่าในช่องกรอก (value) และข้อมูลที่ส่งไป server — เปลี่ยนแค่สิ่งที่แสดง
// - ไม่แปลส่วนที่ครอบด้วย data-noi18n (เช่น <View testID="noi18n">) และหน้าต่างพิมพ์ใบเสร็จ/ป้าย (เป็นหน้าต่างแยก)
// - ข้อความไหนไม่มีในพจนานุกรม จะเป็นไทยเหมือนเดิม → เพิ่มคำใน phrases.ts
// - หน้าจอใหม่ควรใช้ t('key') จาก th.ts/en.ts ตามปกติ ระบบนี้เป็นตาข่ายรองรับส่วนที่ยังไม่ได้ทำ
import { PATTERNS, PHRASES } from './phrases';

/** มีอักษรไทยไหม (ไม่นับ ฿ ซึ่งอยู่ในช่วงอักษรไทยเหมือนกัน) */
const TH = /[ก-ฺเ-๛]/;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const exact = new Map<string, string>();
for (const [k, v] of Object.entries(PHRASES)) exact.set(norm(k), v);

interface Pat { re: RegExp; en: string; order: number[]; len: number; glued: boolean[]; short: boolean }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pats: Pat[] = PATTERNS.map(([th, en]): Pat => {
  const order: number[] = [];
  const glued: boolean[] = [];
  const key = norm(th);
  // ค่าแทรกที่ติดกับอักษรไทย เช่น "สี{0}" — ถ้าค่าที่ได้เป็นไทยที่แปลไม่ได้ แปลว่าจับผิดคำ ("สีน้ำเงิน") → ข้าม
  key.replace(/\{(\d+)\}/g, (m, _n, i: number) => {
    glued.push(TH.test(key[i - 1] ?? '') || TH.test(key[i + m.length] ?? ''));
    return m;
  });
  const src = key
    .split(/(\{\d+\})/)
    .map((part) => {
      const m = /^\{(\d+)\}$/.exec(part);
      if (!m) return esc(part);
      order.push(Number(m[1]));
      return '([\\s\\S]*?)';
    })
    .join('');
  // คำไทยในแม่แบบสั้นมาก (เช่น "ลด {0}") → ถ้าค่าแทรกเป็นไทยที่แปลไม่ได้ น่าจะเป็นข้อมูลร้าน (ชื่อโปรฯ) ไม่ใช่ข้อความระบบ → ไม่แปล
  const short = (key.replace(/\{\d+\}/g, '').match(/[\u0E01-\u0E3A\u0E40-\u0E5B]/g) ?? []).length <= 3;
  return { re: new RegExp(`^${src}$`), en, order, glued, short, len: th.replace(/\{\d+\}/g, '').length };
})
  // ข้อความยาว/เจาะจงกว่าลองก่อน
  .sort((a, b) => b.len - a.len);

// ---- วันที่จาก Intl('th-TH') เช่น "พฤ. 30 ต.ค. 2569" → "Thu 30 Oct 2026" ----
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TH_DAY: Record<string, string> = {
  'วันอาทิตย์': 'Sunday', 'วันจันทร์': 'Monday', 'วันอังคาร': 'Tuesday', 'วันพุธ': 'Wednesday', 'วันพฤหัสบดี': 'Thursday', 'วันศุกร์': 'Friday', 'วันเสาร์': 'Saturday',
  'อาทิตย์': 'Sun', 'จันทร์': 'Mon', 'อังคาร': 'Tue', 'พุธ': 'Wed', 'พฤหัสบดี': 'Thu', 'พฤหัส': 'Thu', 'ศุกร์': 'Fri', 'เสาร์': 'Sat',
  'อา.': 'Sun', 'จ.': 'Mon', 'อ.': 'Tue', 'พ.': 'Wed', 'พฤ.': 'Thu', 'ศ.': 'Fri', 'ส.': 'Sat',
};
const DATE_RE = new RegExp(
  `(?:(${Object.keys(TH_DAY).sort((a, b) => b.length - a.length).map(esc).join('|')})(?:ที่)?\\s*)?(\\d{1,2})\\s+(${TH_MON.map(esc).join('|')})(?:\\s+(\\d{4}))?`,
  'g',
);
function dates(s: string) {
  return s.replace(DATE_RE, (_m, day: string | undefined, d: string, mon: string, y: string | undefined) => {
    const yr = y ? ` ${Number(y) > 2400 ? Number(y) - 543 : y}` : '';
    return `${day ? `${TH_DAY[day]} ` : ''}${d} ${EN_MON[TH_MON.indexOf(mon)]}${yr}`;
  });
}

const cache = new Map<string, string>();

/** แปลข้อความ 1 ชิ้น (ไม่มีในพจนานุกรม → คืนค่าเดิม) */
export function phrase(core: string, depth = 0): string {
  if (!TH.test(core)) return core;
  const hit = exact.get(core);
  if (hit !== undefined) return hit;
  for (const p of pats) {
    const m = p.re.exec(core);
    if (!m) continue;
    const vals = m.slice(1).map((v, i) => {
      if (!TH.test(v) || depth >= 3) return v;
      const tv = phrase(norm(v), depth + 1);
      return (p.glued[i] || p.short) && TH.test(tv) ? null : tv;
    });
    if (vals.includes(null)) continue;
    return p.en.replace(/\{(\d+)\}/g, (_x, n: string) => {
      return vals[p.order.indexOf(Number(n))] ?? '';
    });
  }
  // วันที่ภาษาไทยจาก Intl
  let d = dates(core);
  if (d !== core) {
    // คำไทยที่เหลือรอบวันที่ เช่น "30 Oct 2026 วันนี้" / "29 Oct 2026 พฤ."
    d = d
      .split(' ')
      .map((w) => (TH.test(w) ? (TH_DAY[w] ?? exact.get(w) ?? w) : w))
      .join(' ');
    if (!TH.test(d)) return d;
  }
  // ข้อความรวมหลายส่วน "ก · ข · ค" / "ก — ข" → แปลทีละส่วน
  for (const sep of [' · ', ' — ', ' | ', ' / ', ': ']) {
    if (depth < 3 && core.includes(sep)) {
      const parts = core.split(sep);
      const out = parts.map((x) => phrase(x.trim(), depth + 1));
      if (out.some((x, i) => x !== parts[i].trim())) return out.join(sep);
    }
  }
  // ตัดเครื่องหมายหัว/ท้ายแล้วลองใหม่ เช่น "สาขา:" "(สาขาหลัก)" "รวม…"
  const wrap = /^([\s(（“"'[•·\-–—:]*)(.*?)([\s)）”"'\]:;,.!?…*]*)$/.exec(core);
  if (depth < 3 && wrap && (wrap[1] || wrap[3]) && wrap[2]) {
    const inner = phrase(wrap[2], depth + 1);
    if (inner !== wrap[2]) return wrap[1] + inner + wrap[3];
  }
  return d;
}

/** แปลข้อความ (คงช่องว่างหน้า/หลังไว้ เพื่อไม่ให้คำติดกัน) */
export function translateText(s: string): string {
  if (!s || !TH.test(s)) return s;
  const c = cache.get(s);
  if (c !== undefined) return c;
  const lead = /^\s*/.exec(s)![0];
  const trail = /\s*$/.exec(s)![0];
  const core = norm(s);
  let out = phrase(core);
  if (out === core) out = s;
  else out = lead + out + (out ? trail : '');
  if (cache.size > 20000) cache.clear();
  cache.set(s, out);
  return out;
}

// ------------------------------------------------------------------ DOM
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const origText = new WeakMap<Text, string>(); // ต้นฉบับไทย
const shownText = new WeakMap<Text, string>(); // ค่าที่เราใส่ล่าสุด (ไว้แยกว่า React เปลี่ยนเองหรือเราเปลี่ยน)
const origAttr = new WeakMap<Element, Record<string, string>>();
const shownAttr = new WeakMap<Element, Record<string, string>>();
let on = false;
let observer: MutationObserver | null = null;

const skip = (el: Element | null) =>
  !el || !!el.closest('script,style,textarea,[contenteditable="true"],[data-noi18n],[data-testid="noi18n"]');

function doText(n: Text) {
  const cur = n.nodeValue ?? '';
  if (shownText.get(n) === cur) return; // ค่าที่เราใส่เอง
  // React เปลี่ยนข้อความใหม่ → นี่คือต้นฉบับใหม่
  if (!TH.test(cur)) {
    origText.delete(n);
    shownText.delete(n);
    return;
  }
  if (skip(n.parentElement)) return;
  origText.set(n, cur);
  let t = translateText(cur);
  if (t !== cur) {
    // ภาษาไทยเขียนติดกันได้ แต่อังกฤษต้องเว้นวรรค เช่น "กราฟ" + "ยอดขาย" → "Chart" + " " + "Net sales"
    const next = n.nextSibling;
    if (next?.nodeType === 3 && /[A-Za-z0-9)]$/.test(t) && /^[A-Za-z0-9(\u0E01-\u0E5B]/.test(next.nodeValue ?? '')) t += ' ';
    const prev = n.previousSibling;
    if (prev?.nodeType === 3 && /^[A-Za-z0-9(]/.test(t) && /[A-Za-z0-9)\u0E01-\u0E5B]$/.test(prev.nodeValue ?? '')) t = ' ' + t;
  }
  if (t !== cur) {
    shownText.set(n, t);
    n.nodeValue = t;
  }
}

function doAttrs(el: Element) {
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur == null) continue;
    const shown = shownAttr.get(el);
    if (shown?.[a] === cur) continue;
    if (!TH.test(cur)) continue;
    if (skip(el) && el.tagName !== 'TEXTAREA') continue;
    const o = origAttr.get(el) ?? {};
    o[a] = cur;
    origAttr.set(el, o);
    const t = translateText(cur);
    if (t !== cur) {
      const s = shown ?? {};
      s[a] = t;
      shownAttr.set(el, s);
      el.setAttribute(a, t);
    }
  }
}

function walk(root: Node) {
  if (root.nodeType === 3) return doText(root as Text);
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) doAttrs(root as Element);
  const doc = root.ownerDocument ?? (root as Document);
  const tw = doc.createTreeWalker(root, 1 | 4); // ELEMENT | TEXT
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) doText(n as Text);
    else doAttrs(n as Element);
  }
}

/** คืนข้อความไทยเดิมทั้งหน้า */
function restore(root: Node) {
  const doc = root.ownerDocument ?? (root as Document);
  const tw = doc.createTreeWalker(root, 1 | 4);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) {
      const o = origText.get(n as Text);
      if (o !== undefined && shownText.get(n as Text) === n.nodeValue) n.nodeValue = o;
      origText.delete(n as Text);
      shownText.delete(n as Text);
    } else {
      const el = n as Element;
      const o = origAttr.get(el);
      const s = shownAttr.get(el);
      if (o) for (const a of Object.keys(o)) if (s?.[a] === el.getAttribute(a)) el.setAttribute(a, o[a]);
      origAttr.delete(el);
      shownAttr.delete(el);
    }
  }
}

// alert / confirm / prompt ที่มีข้อความไทย
type Dlg = (msg?: unknown, ...rest: unknown[]) => unknown;
const native: Partial<Record<'alert' | 'confirm' | 'prompt', Dlg>> = {};
function patchDialogs(enable: boolean) {
  const w = globalThis as unknown as Record<string, Dlg>;
  for (const k of ['alert', 'confirm', 'prompt'] as const) {
    if (typeof w[k] !== 'function') continue;
    if (enable && !native[k]) {
      native[k] = w[k];
      w[k] = (msg?: unknown, ...rest: unknown[]) =>
        native[k]!.call(globalThis, typeof msg === 'string' ? translateText(msg) : msg, ...rest);
    } else if (!enable && native[k]) {
      w[k] = native[k]!;
      delete native[k];
    }
  }
}

/** เปิด/ปิดการแปลหน้าจอ — เรียกจาก I18nProvider ทุกครั้งที่เปลี่ยนภาษา */
export function setDomLanguage(lang: 'th' | 'en') {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const want = lang === 'en';
  if (want === on) return;
  on = want;
  const root = document.documentElement; // รวม <title> ของแท็บด้วย
  if (!root) return;
  if (want) {
    walk(root);
    observer = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target as Text);
        else if (m.type === 'attributes') doAttrs(m.target as Element);
        else m.addedNodes.forEach((n) => walk(n));
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  } else {
    observer?.disconnect();
    observer = null;
    restore(root);
  }
  patchDialogs(want);
}
