// นำเข้าสินค้าจากที่อื่น (ไฟล์ Excel/CSV): Code · Custom barcode id · Quantity · Product name · Colors · Size · Category · Notify when product less than · Price
// - รหัสสินค้า (Code) ยังไม่มีในระบบ → สร้างสินค้าใหม่ + SKU ตามสี/ไซซ์ + สต็อกตามจำนวน
// - มีแล้ว → จับคู่ SKU ด้วย รหัส SKU (ระบบ) → บาร์โค้ด → สี+ไซซ์+คุณสมบัติอื่น แล้ว "บวกเพิ่ม" (หรือ "ตั้งเป็น") จำนวนในไฟล์ · สี/ไซซ์ใหม่ = เพิ่ม SKU ให้
// - ไฟล์ที่ได้จาก "ส่งออก Excel" (หน้า สต็อกสินค้า (คุณสมบัติ)) นำเข้ากลับได้ทันที
// ตรวจก่อนนำเข้า (preview) = ทำจริงใน transaction แล้วย้อนกลับ → ผลลัพธ์ตรงกับตอนนำเข้าจริงทุกอย่าง
import { db, tx } from './db.ts';
import { HttpError } from './common.ts';
import { createCategory, getProduct, saveProduct, variantLabel, type ProductIn } from './products.ts';
import type { Me } from './auth.ts';

export interface ImportRow {
  line?: number; code?: string; barcode?: string; qty?: number | string; name?: string;
  color?: string; size?: string; category?: string; lowStock?: number | string; price?: number | string;
  /** คุณสมบัติที่ 3 (เช่น ดีไซน์/ลาย) */
  extra?: string;
  /** รหัส SKU ที่ระบบสร้าง (จากไฟล์ส่งออก) — ใช้จับคู่ SKU เดิมได้แม่นที่สุด */
  variantSku?: string;
}
interface Opts { mode?: 'add' | 'set'; updateInfo?: boolean; apply?: boolean }

const COLOR_HEX: Record<string, string> = {
  black: '#1F1F1F', white: '#FFFFFF', grey: '#9CA3AF', gray: '#9CA3AF', 'dark grey': '#4B5563', 'light grey': '#D1D5DB',
  cream: '#F3E9D2', 'light cream': '#F8F1E0', 'dark cream': '#E6D3A8', ivory: '#FFFDF0', beige: '#E8D8BE', sand: '#D9C29A',
  khaki: '#B9A77A', brown: '#8B5E3C', 'light brown': '#B08560', 'dark brown': '#5C3A21', camel: '#C19A6B', rust: '#A0522D',
  navy: '#1E2A55', blue: '#2563EB', 'light blue': '#93C5FD', 'blue green': '#0D9488', turquoise: '#2EC4B6',
  green: '#16A34A', 'light green': '#86EFAC', 'dark green': '#14532D', olive: '#6B7C32', oliver: '#6B7C32',
  red: '#DC2626', pink: '#F472B6', 'light pink': '#FBCFE8', peach: '#FDBA8C', orange: '#F97316',
  yellow: '#FACC15', 'light yellow': '#FEF08A', purple: '#8B5CF6',
};
const hexOf = (name: string) => COLOR_HEX[name.toLowerCase()] ?? COLOR_HEX[name.toLowerCase().split(/[-\s]/).pop() ?? ''] ?? '#9AA0A8';
const CODE_RE = /^[0-9A-Za-z\-_.]+$/;
const clean = (v: unknown, max = 60) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const cleanCode = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, '').slice(0, 40);

class Rollback extends Error {
  result: unknown;
  constructor(result: unknown) {
    super('rollback');
    this.result = result;
  }
}

export function importProducts(body: { rows?: ImportRow[] } & Opts, me: Me) {
  if (me.role !== 'manager') throw new HttpError(403, 'เฉพาะผู้จัดการเท่านั้น', 'NO_PERMISSION');
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new HttpError(422, 'ไม่พบรายการสินค้าในไฟล์');
  if (rows.length > 20000) throw new HttpError(422, 'ไฟล์ใหญ่เกินไป (สูงสุด 20,000 แถว)');
  const mode = body.mode === 'set' ? 'set' : 'add';
  const updateInfo = !!body.updateInfo;
  const reason = 'นำเข้าสินค้าจากที่อื่น';

  // ---- ตรวจแต่ละแถว + จัดกลุ่มตามรหัสสินค้า ----
  const errors: { line: number; code: string; text: string }[] = [];
  /** แถวที่นำเข้าได้แต่มีการปรับค่า (เช่น จำนวนติดลบ → 0) */
  const warnings: { line: number; code: string; text: string }[] = [];
  const groups = new Map<string, Required<Pick<ImportRow, 'line'>> & { rows: Parsed[] }>();
  interface Parsed { line: number; code: string; barcode: string; qty: number; name: string; color: string; size: string; extra: string; variantSku: string; category: string; lowStock: number | null; price: number | null }
  rows.forEach((r, i) => {
    const line = Number(r.line) || i + 2;
    const code = cleanCode(r.code);
    if (!code) return errors.push({ line, code: '', text: 'ไม่มีรหัสสินค้า (Code)' });
    if (!CODE_RE.test(code)) return errors.push({ line, code, text: 'รหัสสินค้าใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .' });
    const barcode = cleanCode(r.barcode);
    if (barcode && !CODE_RE.test(barcode)) return errors.push({ line, code, text: `บาร์โค้ด "${barcode}" ใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ และ - _ .` });
    // จำนวนติดลบ: ตรวจทีหลัง — ถ้าเท่ากับสต็อกเดิม (ไฟล์ส่งออกที่ไม่ได้แก้) = ไม่เปลี่ยน · นอกนั้นนำเข้าเป็น 0
    const qty = Number(String(r.qty ?? '0').replace(/,/g, '') || 0);
    if (!Number.isInteger(qty) || qty > 999999 || qty < -999999) return errors.push({ line, code, text: `จำนวน "${r.qty}" ไม่ถูกต้อง` });
    const priceN = r.price === undefined || r.price === '' ? null : Number(String(r.price).replace(/,/g, ''));
    if (priceN !== null && (!Number.isFinite(priceN) || priceN < 0)) return errors.push({ line, code, text: `ราคา "${r.price}" ไม่ถูกต้อง` });
    const lowN = r.lowStock === undefined || r.lowStock === '' ? null : Math.floor(Number(r.lowStock));
    const p: Parsed = {
      line, code, barcode, qty, name: clean(r.name, 120), color: clean(r.color, 30), size: clean(r.size, 30),
      extra: clean(r.extra, 30), variantSku: cleanCode(r.variantSku),
      category: clean(r.category, 40), lowStock: lowN !== null && Number.isFinite(lowN) && lowN >= 0 ? Math.min(lowN, 9999) : null, price: priceN,
    };
    const g = groups.get(code) ?? { line, rows: [] };
    g.rows.push(p);
    groups.set(code, g);
  });

  const summary = { products: groups.size, newProducts: 0, updatedProducts: 0, newSkus: 0, updatedSkus: 0, unchangedSkus: 0, units: 0, newCategories: [] as string[] };
  const failed: { code: string; name: string; text: string }[] = [];
  const catByName = new Map((db.prepare('SELECT id, name FROM categories').all() as { id: string; name: string }[]).map((c) => [c.name.toLowerCase(), c.id]));
  const categoryId = (name: string) => {
    const key = (name || 'ไม่ระบุ').toLowerCase();
    let id = catByName.get(key);
    if (!id) {
      id = createCategory({ name: name || 'ไม่ระบุ', icon: guessArt(name) }).id;
      catByName.set(key, id);
      summary.newCategories.push(name || 'ไม่ระบุ');
    }
    return id;
  };

  const run = () =>
    tx(() => {
      for (const [code, g] of groups) {
        const first = g.rows[0];
        const snap = { ...summary, newCategories: [...summary.newCategories] };
        const errCount = errors.length;
        try {
          tx(() => importOne(code, g.rows));
        } catch (e) {
          Object.assign(summary, snap); // ย้อนตัวนับของสินค้าที่นำเข้าไม่สำเร็จ
          errors.length = errCount;
          failed.push({ code, name: first.name, text: (e as Error).message });
        }
      }
      const result = { summary, errors, warnings, failed, mode, applied: !!body.apply };
      if (!body.apply) throw new Rollback(result);
      return result;
    });

  function importOne(code: string, list: Parsed[]) {
    // ค่าว่างในกลุ่มที่มีค่าอื่น → "ไม่ระบุ" (คุณสมบัติต้องมีตัวเลือกครบทุก SKU)
    const hasColor = list.some((r) => r.color);
    const hasSize = list.some((r) => r.size);
    const hasExtra = list.some((r) => r.extra);
    for (const r of list) {
      if (hasColor && !r.color) r.color = 'ไม่ระบุ';
      if (hasSize && !r.size) r.size = 'ไม่ระบุ';
      if (hasExtra && !r.extra) r.extra = 'ไม่ระบุ';
    }
    // แถวซ้ำ (รหัส SKU เดียวกัน หรือ สี+ไซซ์+คุณสมบัติอื่นเดียวกัน) → รวมจำนวน
    const byKey = new Map<string, Parsed>();
    for (const r of list) {
      const k = r.variantSku ? `sku:${r.variantSku.toLowerCase()}` : `${r.color.toLowerCase()}|${r.size.toLowerCase()}|${r.extra.toLowerCase()}`;
      const prev = byKey.get(k);
      if (prev) {
        prev.qty += r.qty;
        if (!prev.barcode) prev.barcode = r.barcode;
      } else byKey.set(k, { ...r });
    }
    const items = [...byKey.values()];
    const first = items[0];
    // บาร์โค้ดที่เป็นของสินค้าอื่นอยู่แล้ว → ไม่นำเข้าแถวนั้น
    const taken = db.prepare('SELECT v.product_id AS pid, p.sku AS code, p.name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.barcode = ?');
    const prod = db.prepare('SELECT id FROM products WHERE sku = ?').get(code) as { id: number } | undefined;
    for (const it of items) {
      if (!it.barcode) continue;
      const t = taken.get(it.barcode) as { pid: number; code: string; name: string } | undefined;
      if (t && t.pid !== prod?.id) {
        errors.push({ line: it.line, code, text: `บาร์โค้ด ${it.barcode} เป็นของ "${t.name}" (${t.code}) อยู่แล้ว — ข้ามแถวนี้` });
        it.barcode = '';
        (it as Parsed & { skip?: boolean }).skip = true;
      }
    }
    const use = items.filter((x) => !(x as Parsed & { skip?: boolean }).skip);
    if (!use.length) return;

    /** จำนวนติดลบในไฟล์ → 0 (แจ้งเตือน) */
    const nonNeg = (r: Parsed) => {
      if (r.qty < 0) {
        warnings.push({ line: r.line, code, text: `จำนวนติดลบ (${r.qty}) → นำเข้าเป็น 0` });
        r.qty = 0;
      }
      return r.qty;
    };

    if (!prod) {
      // ---- สินค้าใหม่ ----
      use.forEach(nonNeg);
      const colors = [...new Map(use.filter((r) => r.color).map((r) => [r.color, r.color])).values()];
      const sizes = [...new Map(use.filter((r) => r.size).map((r) => [r.size, r.size])).values()];
      const extras = [...new Map(use.filter((r) => r.extra).map((r) => [r.extra, r.extra])).values()];
      const attrs: ProductIn['attrs'] = [];
      if (colors.length) attrs.push({ type: 'color', name: 'สี', options: colors.map((c) => ({ value: c, hex: hexOf(c) })) });
      if (sizes.length) attrs.push({ type: 'size', name: 'ไซซ์', options: sizes.map((v) => ({ value: v })) });
      if (extras.length) attrs.push({ type: 'custom', name: 'ดีไซน์', options: extras.map((v) => ({ value: v })) });
      const cat = categoryId(first.category);
      saveProduct(
        null,
        {
          code, name: first.name || code, categoryId: cat, art: guessArt(`${first.category} ${first.name}`), lowStock: first.lowStock ?? 3,
          attrs,
          variants: use.map((r) => ({ color: r.color || undefined, size: r.size || undefined, extra: r.extra || undefined, barcode: r.barcode || undefined, price: r.price ?? 0, cost: 0, stock: r.qty })),
        },
        me,
        { moveReason: reason },
      );
      summary.newProducts++;
      summary.newSkus += use.length;
      summary.units += use.reduce((a, r) => a + r.qty, 0);
      return;
    }

    // ---- สินค้าที่มีอยู่แล้ว ----
    const cur = getProduct(prod.id, me) as unknown as {
      sku: string; name: string; categoryId: string; barcode: string | null; imageUrl: string | null; art: string; tint: string; active: boolean;
      lowStock: number; note: string | null; attrs: NonNullable<ProductIn['attrs']>;
      variants: { id: number; sku: string; barcode: string | null; color: string; size: string; extra: string; price: number; cost?: number; stock: number; active: boolean }[];
    };
    const attrs = cur.attrs.map((a) => ({ ...a, options: [...a.options] }));
    const colorA = attrs.find((a) => a.type === 'color');
    const sizeA = attrs.find((a) => a.type === 'size');
    const extraA = attrs.find((a) => a.type === 'custom');
    const variants = cur.variants.map((v) => ({
      id: v.id, sku: v.sku, color: v.color, size: v.size, extra: v.extra, price: v.price, cost: v.cost ?? 0,
      stock: v.stock, stockBase: v.stock, active: v.active, barcode: undefined as string | undefined,
    }));
    const lc = (s: string) => s.toLowerCase();
    let changed = false;
    const used = new Set<number>();
    for (const r of use) {
      const free = (x: (typeof variants)[number]) => !x.id || !used.has(x.id);
      let v =
        (r.variantSku && variants.find((x) => free(x) && lc(x.sku) === lc(r.variantSku))) ||
        (r.barcode && variants.find((x) => free(x) && cur.variants.find((o) => o.id === x.id)?.barcode === r.barcode)) ||
        variants.find((x) => free(x) && lc(x.color) === lc(r.color || '-') && lc(x.size) === lc(r.size || '-') && lc(x.extra) === lc(r.extra));
      if (v?.id) used.add(v.id);
      if (!v) {
        // สี/ไซซ์ใหม่ → เพิ่มตัวเลือก + SKU
        if (r.variantSku) throw new HttpError(422, `ไม่พบรหัส SKU "${r.variantSku}" ในสินค้านี้ — SKU ใหม่ให้เว้นช่อง รหัส SKU (ระบบ) ว่าง`);
        if (r.color && !colorA) throw new HttpError(422, `สินค้านี้ไม่มีคุณสมบัติ "สี" — เพิ่มสี "${r.color}" ไม่ได้ (แก้ที่หน้าสินค้าก่อน)`);
        if (r.size && !sizeA) throw new HttpError(422, `สินค้านี้ไม่มีคุณสมบัติ "ไซซ์" — เพิ่มไซซ์ "${r.size}" ไม่ได้ (แก้ที่หน้าสินค้าก่อน)`);
        if (r.extra && !extraA) throw new HttpError(422, `สินค้านี้ไม่มีคุณสมบัติอื่น — เพิ่ม "${r.extra}" ไม่ได้ (แก้ที่หน้าสินค้าก่อน)`);
        if (extraA && !r.extra) throw new HttpError(422, `สินค้านี้มีคุณสมบัติ "${extraA.name}" — ใส่ค่าในคอลัมน์ คุณสมบัติอื่น ของ SKU ${variantLabel(r)} ด้วย`);
        nonNeg(r);
        const color = colorA ? colorA.options.find((o) => lc(o.value) === lc(r.color))?.value ?? r.color : '-';
        const size = sizeA ? sizeA.options.find((o) => lc(o.value) === lc(r.size))?.value ?? r.size : '-';
        const extra = extraA ? extraA.options.find((o) => lc(o.value) === lc(r.extra))?.value ?? r.extra : '';
        if (colorA && !colorA.options.some((o) => o.value === color)) colorA.options.push({ value: color, hex: hexOf(color) });
        if (sizeA && !sizeA.options.some((o) => o.value === size)) sizeA.options.push({ value: size });
        if (extraA && !extraA.options.some((o) => o.value === extra)) extraA.options.push({ value: extra });
        variants.push({
          id: undefined as unknown as number, sku: '', color, size, extra, price: r.price ?? variants[0]?.price ?? 0, cost: variants[0]?.cost ?? 0,
          stock: r.qty, stockBase: 0, active: true, barcode: r.barcode || undefined,
        });
        summary.newSkus++;
        summary.units += r.qty;
        changed = true;
        continue;
      }
      // ติดลบในไฟล์ที่เท่ากับสต็อกเดิม (ส่งออกแล้วไม่ได้แก้) = ไม่เปลี่ยน
      if (!(mode === 'set' && r.qty < 0 && r.qty === v.stockBase)) nonNeg(r);
      const next = mode === 'set' ? r.qty : v.stockBase + r.qty;
      if (next !== v.stock) {
        summary.units += next - v.stockBase;
        v.stock = next;
        changed = true;
      }
      // ใส่บาร์โค้ดให้ SKU ที่ยังไม่มี (ติ๊ก "อัปเดตข้อมูล" = เปลี่ยนบาร์โค้ดเดิมตามไฟล์ได้ด้วย)
      const oldBc = cur.variants.find((o) => o.id === v!.id)?.barcode;
      const newBc = !!r.barcode && r.barcode !== oldBc && (!oldBc || updateInfo);
      if (newBc) {
        v.barcode = r.barcode;
        changed = true;
      }
      if (updateInfo && r.price !== null && r.price !== v.price) {
        v.price = r.price;
        changed = true;
      }
      if (next !== v.stockBase || newBc || (updateInfo && r.price !== null && r.price !== cur.variants.find((o) => o.id === v!.id)?.price)) summary.updatedSkus++;
      else summary.unchangedSkus++;
    }
    const info = updateInfo
      ? { name: first.name || cur.name, categoryId: first.category ? categoryId(first.category) : cur.categoryId, lowStock: first.lowStock ?? cur.lowStock }
      : { name: cur.name, categoryId: cur.categoryId, lowStock: cur.lowStock };
    if (updateInfo && (info.name !== cur.name || info.categoryId !== cur.categoryId || info.lowStock !== cur.lowStock)) changed = true;
    if (!changed) return;
    saveProduct(
      prod.id,
      {
        code: cur.sku, ...info, barcode: cur.barcode ?? undefined, imageUrl: cur.imageUrl, art: cur.art, tint: cur.tint, active: cur.active,
        note: cur.note ?? undefined, attrs,
        variants: variants.map((v) => ({ ...v, id: v.id || undefined, sku: v.sku || undefined, color: colorA ? v.color : undefined, size: sizeA ? v.size : undefined, extra: extraA ? v.extra : undefined })),
      },
      me,
      { moveReason: reason },
    );
    summary.updatedProducts++;
  }

  try {
    return run();
  } catch (e) {
    if (e instanceof Rollback) return e.result as ReturnType<typeof run>;
    throw e;
  }
}

/** เดารูปไอคอนสินค้าจากหมวด/ชื่อ */
function guessArt(text: string) {
  const t = text.toLowerCase();
  if (/bag|กระเป๋า/.test(t)) return 'bag';
  if (/hat|cap|หมวก/.test(t)) return 'cap';
  if (/short|ขาสั้น/.test(t)) return 'shorts';
  if (/trouser|pant|ขายาว|กางเกง/.test(t)) return 'pants';
  if (/tank|กล้าม/.test(t)) return 'tank';
  if (/shirt \(เสื้อเชิ้ต|เชิ้ต/.test(t)) return 'shirt';
  if (/dress|เดรส/.test(t)) return 'dress';
  if (/skirt|กระโปรง/.test(t)) return 'skirt';
  if (/hood/.test(t)) return 'hoodie';
  if (/jacket/.test(t)) return 'jacket';
  if (/crop|fashion|blouse|ครอป/.test(t)) return 'blouse';
  return 'tshirt';
}
