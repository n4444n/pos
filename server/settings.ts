// การตั้งค่าระบบ: เก็บเป็น JSON แยกตามหมวด ในตาราง settings
import { db } from './db.ts';
import { getVatRate, HttpError, ORDER_TYPES } from './common.ts';
import { currentBranchInfo } from './branches.ts';
import { cleanStyle, cleanTemplate, DEFAULT_STYLE, EVENTS, type CardStyle, type CardTemplate, type EventChannels, type EventKey } from './notify.ts';

// คีย์ข้อความในใบเสร็จที่แก้เองได้ (ตรงกับ src/receiptText.ts)
export interface FooterBlock {
  type: 'text' | 'qr' | 'image';
  /** ข้อความ / ข้อมูลใน QR (ลิงก์) / URL รูป */
  text: string;
  /** ข้อความใต้ QR/รูป */
  caption: string;
  size: 'small' | 'medium' | 'large';
  align: 'left' | 'center' | 'right';
  bold: boolean;
  /** ความกว้าง QR/รูป (% ของกระดาษ) */
  width: number;
}
const imgUrl = (v: unknown) => {
  const u = String(v ?? '').trim().slice(0, 500);
  return /^\/uploads\/[\w.-]+$|^https:\/\//.test(u) ? u : '';
};
const RECEIPT_LABEL_KEYS = [
  'tel', 'taxId', 'orderNo', 'date', 'customer', 'staff', 'orderType', 'colItem', 'colQty', 'colAmount', 'subtotal', 'discount', 'fee', 'total', 'vatIncluded', 'paidBy', 'change',
  'pay_cash', 'pay_promptpay', 'pay_card', 'pay_transfer',
];

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    section    TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

export type PayId = 'cash' | 'promptpay' | 'card' | 'transfer';
export interface PayMethod { id: PayId; label: string; enabled: boolean; feePercent: number; feeFixed: number }

export interface Settings {
  shop: { name: string; branchName: string; branchCode: string; address: string; phone: string; taxId: string; photoUrl: string; publicUrl: string };
  display: {
    defaultView: 3 | 4 | 5; showStock: boolean; hideOutOfStock: boolean; showImages: boolean; defaultOrderType: string; scanBeep: boolean;
    imageShape: 'square' | 'portrait' | 'landscape'; imageFit: 'cover' | 'contain'; imageQuality: 'high' | 'medium' | 'low';
    fontSize: 'small' | 'medium' | 'large'; showSku: boolean; showCategoryTag: boolean; cartImages: boolean;
    /** ขนาดวงกลมสี / ปุ่มไซซ์ บนการ์ดสินค้า */
    swatchSize: 'small' | 'medium' | 'large'; optionSize: 'small' | 'medium' | 'large';
  };
  stock: {
    lowStockDefault: number;
    /** ขายได้แม้สต็อกเป็น 0 → สต็อกติดลบได้ (เติมสต็อกทีหลังจะหักกับยอดติดลบ) */
    allowNegative: boolean;
    skuDigits: number;
    skuSeparator: '-' | '' | '.' | '_';
    sync: { role: 'off' | 'master' | 'branch'; masterUrl: string; apiKey: string; intervalMin: number; syncPrice: boolean; syncCost: boolean; syncImages: boolean };
  };
  payments: {
    methods: PayMethod[]; promptpayId: string; vat: { enabled: boolean; rate: number }; feePayer: 'customer' | 'shop';
    /** เปิด/ปิดกะ: ต้องนับเงินในลิ้นชักเป็นธนบัตร/เหรียญทีละชนิด (กรอกยอดรวมเองไม่ได้) */
    requireDenominations: boolean;
  };
  barcode: {
    symbology: 'code128' | 'ean13'; autoAssign: 'none' | 'sku' | 'ean13'; ean13Prefix: string; labelWidth: number; labelHeight: number; labelShowPrice: boolean; labelShowName: boolean;
    /** โปรไฟล์กระดาษ/หน้าตาป้ายบาร์โค้ด (ตั้งค่า → กระดาษบาร์โค้ด) · labelProfile = โปรไฟล์เริ่มต้น */
    labelProfiles: LabelProfile[]; labelProfile: string;
    /** แบบสำเร็จรูปขนาดกระดาษที่ร้านบันทึกเอง */
    labelPresets: LabelPreset[];
  };
  receipt: {
    paperWidth: 58 | 80; fontSize: 'small' | 'medium' | 'large'; title: string; header: string; footer: string;
    showSku: boolean; showSalesperson: boolean; showCustomer: boolean; showVat: boolean; showOrderBarcode: boolean; autoPrint: boolean; copies: number;
    /** ภาษาของใบเสร็จ */
    language: 'th' | 'en' | 'both';
    /** ข้อความที่แก้เอง (ว่าง = ใช้ข้อความตามภาษา) */
    labels: Record<string, string>;
    /** ชื่อร้านบนใบเสร็จ (ว่าง = ชื่อร้านปกติ) เช่น ชื่อภาษาอังกฤษ */
    shopName: string;
    /** โลโก้หัวบิล (/uploads/… หรือ https://…) · ความกว้าง % ของกระดาษ · แสดงชื่อร้านใต้โลโก้หรือไม่ */
    logoUrl: string; logoWidth: number; showShopName: boolean;
    /** ส่วนท้ายบิลที่เพิ่มเอง: ข้อความ / QR code / รูปภาพ */
    footerBlocks: FooterBlock[];
  };
  notify: {
    line: { enabled: boolean; token: string; to: string };
    whatsapp: { enabled: boolean; token: string; phoneNumberId: string; to: string };
    webhook: { enabled: boolean; url: string; secret: string };
    /** เหตุการณ์ → เปิด/ปิด + ช่องทางที่ส่ง */
    events: Record<EventKey, EventChannels>;
    options: {
      /** ขายสำเร็จ: แจ้งเฉพาะบิลตั้งแต่ยอดนี้ (0 = ทุกบิล) */
      saleMin: number;
      /** ปิดกะ: แจ้งเฉพาะเมื่อเงินไม่ตรง */
      shiftMismatchOnly: boolean;
      /** สรุปประจำวัน: เวลาที่ส่ง HH:MM */
      dailyTime: string;
    };
    /** หน้าตาการ์ด LINE */
    style: CardStyle;
    templates: Record<EventKey, CardTemplate>;
  };
  api: { enabled: boolean };
  /** ภาษีมูลค่าเพิ่ม (ตั้งค่า → ภาษี) — อัตรา VAT / เครื่อง POS / สาขาภาษี อยู่ในตารางของ tax.ts */
  tax: {
    /** ชื่อผู้ประกอบการตามที่จดทะเบียน (พิมพ์บนใบกำกับภาษี · ว่าง = ใช้ชื่อร้าน) */
    legalName: string;
    /** ห้ามแก้ไขบิลที่ออกแล้วในสาขาที่จด VAT — เปลี่ยน/คืนสินค้าต้องยกเลิกบิลแล้วออกใหม่ */
    lockEdit: boolean;
  };
}


// ---------- ป้ายบาร์โค้ด (ตั้งค่า → กระดาษบาร์โค้ด) ----------
export interface LabelProfile {
  id: string;
  name: string;
  /** roll = สติ๊กเกอร์ม้วน (เครื่องพิมพ์ป้าย) · a4 = กระดาษแผ่น (A4 / A5 / กำหนดเอง — ชื่อเดิม a4 คงไว้ให้ข้อมูลเก่าใช้ได้) */
  paper: 'roll' | 'a4';
  /** กระดาษแผ่น: กว้าง × สูง ของแผ่น (มม.) · ม้วน: pageWidth = ความกว้างม้วน (0 = คำนวณจากดวง) */
  pageWidth: number; pageHeight: number;
  /** ม้วน: ขอบขวา / ขอบล่างของกระดาษ (มม.) */
  marginRight: number; marginBottom: number;
  /** จุดเริ่มพิมพ์ (ดวงที่เท่าไรของแถวแรก) */
  startAt: number;
  /** ขนาดดวง (มม.) */
  width: number; height: number;
  /** ดวงต่อแถว · a4: จำนวนแถวต่อแผ่น */
  cols: number; rows: number;
  /** ระยะห่างระหว่างดวง / ขอบกระดาษ (มม.) */
  gapX: number; gapY: number; marginTop: number; marginLeft: number;
  /** ระยะขอบในดวง (มม.) */
  padding: number;
  /** ประเภทบาร์โค้ดบนป้าย — ร้านใช้ 128-A / 128-B / Code 39 (ค่าเก่าอื่น ๆ ถูกเปลี่ยนเป็น 128-B) */
  symbology: 'code128a' | 'code128b' | 'code39';
  /** ความสูงบาร์โค้ด (มม.) · ความกว้าง % ของดวง */
  barHeight: number; barWidth: number;
  /** ความหนาแท่งแคบสุด (มม.) · 0 = ยืดเต็มความกว้าง % */
  barModule: number;
  layout: 'standard' | 'classic' | 'compact';
  showCode: boolean; showName: boolean; showVariant: boolean; showPrice: boolean; showShop: boolean;
  bold: boolean; italic: boolean;
  align: 'left' | 'center' | 'right';
  /** ขนาดตัวอักษร (pt) */
  codeSize: number; nameSize: number; priceSize: number;
  /** ระยะห่างบาร์โค้ด/รหัสใต้บาร์โค้ด (มม.) */
  textGap: number;
  /** ระยะห่างชื่อสินค้า/บาร์โค้ด (มม.) */
  nameGap: number;
}
export const DEFAULT_LABEL_PROFILE: LabelProfile = {
  id: 'p1', name: 'โปรไฟล์ 1', paper: 'roll', pageWidth: 0, pageHeight: 0, marginRight: 0, marginBottom: 0, startAt: 1, width: 50, height: 30, cols: 1, rows: 1, gapX: 2, gapY: 0, marginTop: 0, marginLeft: 0, padding: 1.2,
  symbology: 'code128b', barHeight: 10, barWidth: 90, barModule: 0, layout: 'standard', showCode: true, showName: true, showVariant: true, showPrice: true, showShop: false,
  bold: true, italic: false, align: 'center', codeSize: 8, nameSize: 8, priceSize: 8, textGap: 0.5, nameGap: 0.5,
};
const round1 = (n: number) => Math.round(n * 10) / 10;
export function cleanLabelProfile(v: Record<string, any>, i = 0): LabelProfile {
  const d = DEFAULT_LABEL_PROFILE;
  const n = (x: unknown, min: number, max: number, dflt: number) => round1(Math.min(max, Math.max(min, Number.isFinite(Number(x)) ? Number(x) : dflt)));
  const b = (x: unknown, dflt: boolean) => (typeof x === 'boolean' ? x : dflt);
  const paper = v?.paper === 'a4' ? 'a4' : 'roll';
  return {
    id: String(v?.id ?? '').replace(/[^\w-]/g, '').slice(0, 24) || `p${i + 1}`,
    name: String(v?.name ?? '').trim().slice(0, 40) || `โปรไฟล์ ${i + 1}`,
    paper,
    // แผ่น: ขนาดแผ่นเอง (ไม่ระบุ = A4) · ม้วน: ความกว้างม้วน (0 = อัตโนมัติ)
    pageWidth: paper === 'a4' ? n(v?.pageWidth || 210, 40, 420, 210) : n(v?.pageWidth, 0, 300, 0),
    pageHeight: paper === 'a4' ? n(v?.pageHeight || 297, 40, 600, 297) : n(v?.pageHeight, 0, 420, 0),
    marginRight: n(v?.marginRight, 0, 100, 0), marginBottom: n(v?.marginBottom, 0, 100, 0),
    width: n(v?.width, 5, 300, d.width), height: n(v?.height, 5, 420, d.height),
    cols: Math.round(n(v?.cols, 1, paper === 'a4' ? 20 : 8, 1)), rows: Math.round(n(v?.rows, 1, 60, 1)),
    startAt: Math.round(n(v?.startAt, 1, paper === 'a4' ? 20 : 8, 1)),
    gapX: n(v?.gapX, 0, 50, d.gapX), gapY: n(v?.gapY, 0, 50, d.gapY), marginTop: n(v?.marginTop, 0, 100, 0), marginLeft: n(v?.marginLeft, 0, 100, 0),
    padding: n(v?.padding, 0, 20, d.padding),
    symbology: ['code128a', 'code128b', 'code39'].includes(v?.symbology) ? v.symbology : 'code128b',
    barHeight: n(v?.barHeight, 3, 60, d.barHeight), barWidth: Math.round(n(v?.barWidth, 30, 100, d.barWidth)),
    barModule: Math.round(Math.min(1, Math.max(0, Number(v?.barModule) || 0)) * 100) / 100,
    layout: ['standard', 'classic', 'compact'].includes(v?.layout) ? v.layout : 'standard',
    showCode: b(v?.showCode, true), showName: b(v?.showName, true), showVariant: b(v?.showVariant, true), showPrice: b(v?.showPrice, true), showShop: b(v?.showShop, false),
    bold: b(v?.bold, true), italic: b(v?.italic, false),
    align: ['left', 'center', 'right'].includes(v?.align) ? v.align : 'center',
    codeSize: n(v?.codeSize, 4, 20, d.codeSize), nameSize: n(v?.nameSize, 4, 20, d.nameSize), priceSize: n(v?.priceSize, 4, 24, d.priceSize),
    textGap: n(v?.textGap, 0, 10, d.textGap),
    nameGap: n(v?.nameGap, 0, 10, d.nameGap),
  };
}
/** รายการโปรไฟล์: อย่างน้อย 1 · ไม่เกิน 12 · id ไม่ซ้ำ */
export function cleanLabelProfiles(list: unknown): LabelProfile[] {
  const arr = (Array.isArray(list) ? list : []).slice(0, 12).map((x, i) => cleanLabelProfile((x ?? {}) as Record<string, any>, i));
  const seen = new Set<string>();
  for (const p of arr) {
    while (seen.has(p.id)) p.id = `${p.id}x`;
    seen.add(p.id);
  }
  return arr.length ? arr : [{ ...DEFAULT_LABEL_PROFILE }];
}

/** แบบสำเร็จรูปที่ร้านบันทึกเอง (ตั้งค่า → กระดาษบาร์โค้ด) — เก็บเฉพาะค่าขนาดกระดาษ */
export interface LabelPreset { id: string; label: string; apply: Partial<LabelProfile> }
const PRESET_KEYS = ['paper', 'pageWidth', 'pageHeight', 'marginRight', 'marginBottom', 'width', 'height', 'cols', 'rows', 'gapX', 'gapY', 'marginTop', 'marginLeft', 'padding'] as const;
export function cleanLabelPresets(list: unknown): LabelPreset[] {
  const out: LabelPreset[] = [];
  for (const [i, x] of (Array.isArray(list) ? list : []).slice(0, 24).entries()) {
    const v = (x ?? {}) as Record<string, any>;
    const p = cleanLabelProfile({ ...DEFAULT_LABEL_PROFILE, ...(v.apply ?? {}) }, i);
    const apply: Partial<LabelProfile> = {};
    for (const k of PRESET_KEYS) (apply as Record<string, unknown>)[k] = p[k];
    let id = String(v.id ?? '').replace(/[^\w-]/g, '').slice(0, 24) || `u${i + 1}`;
    while (out.some((o) => o.id === id)) id = `${id}x`;
    out.push({ id, label: String(v.label ?? '').trim().slice(0, 40) || `${p.width} × ${p.height} มม.`, apply });
  }
  return out;
}

export const DEFAULTS: Settings = {
  shop: { name: 'ร้านเสื้อผ้า', branchName: 'สาขาหลัก', branchCode: 'B01', address: '', phone: '', taxId: '', photoUrl: '', publicUrl: '' },
  display: {
    defaultView: 4, showStock: true, hideOutOfStock: false, showImages: true, defaultOrderType: ORDER_TYPES[0], scanBeep: true,
    imageShape: 'landscape', imageFit: 'cover', imageQuality: 'medium', fontSize: 'medium', showSku: false, showCategoryTag: true, cartImages: true,
    swatchSize: 'medium', optionSize: 'medium',
  },
  stock: {
    lowStockDefault: 3,
    allowNegative: false,
    skuDigits: 4,
    skuSeparator: '-',
    sync: { role: 'off', masterUrl: '', apiKey: '', intervalMin: 15, syncPrice: true, syncCost: true, syncImages: true },
  },
  payments: {
    methods: [
      { id: 'cash', label: 'เงินสด', enabled: true, feePercent: 0, feeFixed: 0 },
      { id: 'promptpay', label: 'พร้อมเพย์ (QR)', enabled: true, feePercent: 0, feeFixed: 0 },
      { id: 'card', label: 'บัตรเครดิต/เดบิต', enabled: true, feePercent: 0, feeFixed: 0 },
      { id: 'transfer', label: 'โอนผ่านธนาคาร', enabled: true, feePercent: 0, feeFixed: 0 },
    ],
    promptpayId: '',
    // อัตรา VAT อยู่ในตารางอัตรา VAT (ตั้งค่า → ภาษี) — rate ตรงนี้คงไว้ให้ข้อมูลเดิมอ่านได้ ไม่ได้ใช้คิดภาษี
    vat: { enabled: true, rate: 0 },
    feePayer: 'customer',
    requireDenominations: false,
  },
  barcode: {
    symbology: 'code128', autoAssign: 'none', ean13Prefix: '2', labelWidth: 40, labelHeight: 30, labelShowPrice: true, labelShowName: true,
    labelProfiles: [{ ...DEFAULT_LABEL_PROFILE }], labelProfile: DEFAULT_LABEL_PROFILE.id, labelPresets: [],
  },
  receipt: {
    paperWidth: 80, fontSize: 'medium', title: 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ', header: '', footer: 'ขอบคุณที่ใช้บริการ',
    showSku: false, showSalesperson: true, showCustomer: true, showVat: true, showOrderBarcode: true, autoPrint: false, copies: 1,
    language: 'th', labels: {}, shopName: '', logoUrl: '', logoWidth: 60, showShopName: true, footerBlocks: [],
  },
  notify: {
    line: { enabled: false, token: '', to: '' },
    whatsapp: { enabled: false, token: '', phoneNumberId: '', to: '' },
    webhook: { enabled: false, url: '', secret: '' },
    events: Object.fromEntries(EVENTS.map((e) => [e.key, { ...e.defaults }])) as Record<EventKey, EventChannels>,
    options: { saleMin: 0, shiftMismatchOnly: false, dailyTime: '21:00' },
    style: { ...DEFAULT_STYLE },
    templates: Object.fromEntries(EVENTS.map((e) => [e.key, structuredClone(e.template)])) as Record<EventKey, CardTemplate>,
  },
  api: { enabled: false },
  tax: { legalName: '', lockEdit: true },
};
export const SECTIONS = Object.keys(DEFAULTS) as (keyof Settings)[];

// ---------- อ่าน/เขียน ----------
let cache: Settings | null = null;

function merge<T>(base: T, over: unknown): T {
  if (Array.isArray(base)) return (Array.isArray(over) ? over : base) as T;
  if (base && typeof base === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    const o = (over && typeof over === 'object' ? over : {}) as Record<string, unknown>;
    for (const k of Object.keys(out)) if (k in o) out[k] = merge(out[k], o[k]);
    return out as T;
  }
  return (over === undefined || over === null || typeof over !== typeof base ? base : over) as T;
}

/** รูปแบบเดิม (events แบบ true/false + webhook อยู่ในหมวด api) → รูปแบบใหม่ */
function migrateNotify(stored: Record<string, any>) {
  const n = stored.notify;
  const a = stored.api ?? {};
  if (n && n.events && typeof n.events.shiftClose === 'boolean') {
    const e = n.events;
    const on = (key: EventKey, v: boolean) => ({ ...EVENTS.find((x) => x.key === key)!.defaults, on: v });
    n.events = {
      sale: on('sale', !!e.bigSale), void: on('void', !!e.voidBill), lowStock: on('lowStock', !!e.lowStock), outStock: on('outStock', !!e.lowStock),
      shiftClose: on('shiftClose', !!e.shiftClose),
    };
    n.options = { ...(n.options ?? {}), saleMin: e.bigSale ? Number(e.bigSaleAmount) || 0 : 0 };
  }
  if (n && !n.webhook && (a.webhookUrl || a.webhookSecret)) {
    n.webhook = { enabled: !!a.enabled && !!a.webhookUrl, url: a.webhookUrl ?? '', secret: a.webhookSecret ?? '' };
    const names: string[] = Array.isArray(a.webhookEvents) ? a.webhookEvents : [];
    for (const ev of EVENTS) {
      n.events[ev.key] = { ...(n.events?.[ev.key] ?? ev.defaults), webhook: names.includes(ev.name) || !names.length };
    }
  }
}

export function getSettings(): Settings {
  if (cache) return cache;
  const rows = db.prepare('SELECT section, value FROM settings').all() as { section: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.section] = JSON.parse(r.value);
    } catch {
      /* ข้ามค่าที่เสีย */
    }
  }
  migrateNotify(stored);
  cache = merge(DEFAULTS, stored);
  // ข้อความในใบเสร็จที่แก้เอง (คีย์ไม่ตายตัว merge ไม่คัดลอกให้)
  const rl = (stored.receipt as { labels?: unknown } | undefined)?.labels;
  cache.receipt.labels = rl && typeof rl === 'object' && !Array.isArray(rl)
    ? Object.fromEntries(Object.entries(rl as Record<string, unknown>).filter(([k, x]) => RECEIPT_LABEL_KEYS.includes(k) && typeof x === 'string')) as Record<string, string>
    : {};
  // วิธีชำระเงิน: ให้มีครบ 4 แบบเสมอ (เรียงตามที่ตั้งไว้)
  const ids = DEFAULTS.payments.methods.map((m) => m.id);
  const ms = cache.payments.methods.filter((m) => ids.includes(m.id)).map((m) => merge(DEFAULTS.payments.methods.find((d) => d.id === m.id)!, m));
  for (const d of DEFAULTS.payments.methods) if (!ms.some((m) => m.id === d.id)) ms.push(d);
  cache.payments.methods = ms;
  // โปรไฟล์ป้ายบาร์โค้ด (อาร์เรย์ — merge ไม่เติมค่าที่ขาดในแต่ละโปรไฟล์)
  cache.barcode.labelProfiles = cleanLabelProfiles((stored.barcode as { labelProfiles?: unknown } | undefined)?.labelProfiles ?? DEFAULTS.barcode.labelProfiles);
  cache.barcode.labelPresets = cleanLabelPresets((stored.barcode as { labelPresets?: unknown } | undefined)?.labelPresets ?? []);
  if (!cache.barcode.labelProfiles.some((p) => p.id === cache!.barcode.labelProfile)) cache.barcode.labelProfile = cache.barcode.labelProfiles[0].id;
  return cache;
}

// ---------- ตรวจค่า ----------
const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const num = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
const pick = <T extends string | number>(v: unknown, list: readonly T[], dflt: T) => (list.includes(v as T) ? (v as T) : dflt);
/** ช่องรหัสลับ: ส่ง "" หรือ undefined = คงค่าเดิม, ส่ง "-" = ลบ */
// ว่าง หรือค่าที่ถูกซ่อน (••••xxxx) = ใช้ค่าเดิม · '-' = ลบ
const secret = (v: unknown, old: string) => (v === undefined || v === '' || String(v).startsWith('••••') ? old : v === '-' ? '' : str(v, 500));

function clean(section: keyof Settings, v: Record<string, any>, old: Settings): unknown {
  switch (section) {
    case 'shop':
      return { name: str(v.name, 80) || DEFAULTS.shop.name, branchName: str(v.branchName, 60), branchCode: str(v.branchCode, 20).toUpperCase(), address: str(v.address, 300), phone: str(v.phone, 40), taxId: str(v.taxId, 20),
        photoUrl: /^\/uploads\/[\w.-]+$|^https?:\/\//.test(str(v.photoUrl, 300)) ? str(v.photoUrl, 300) : '',
        publicUrl: /^https?:\/\/[^\s]+$/.test(str(v.publicUrl, 200)) ? str(v.publicUrl, 200).replace(/\/+$/, '') : '' };
    case 'display':
      return {
        defaultView: pick(Number(v.defaultView), [3, 4, 5] as const, 4), showStock: bool(v.showStock, true), hideOutOfStock: bool(v.hideOutOfStock, false),
        showImages: bool(v.showImages, true), defaultOrderType: pick(v.defaultOrderType, ORDER_TYPES, ORDER_TYPES[0]), scanBeep: bool(v.scanBeep, true),
        imageShape: pick(v.imageShape, ['square', 'portrait', 'landscape'] as const, 'landscape'),
        imageFit: pick(v.imageFit, ['cover', 'contain'] as const, 'cover'),
        imageQuality: pick(v.imageQuality, ['high', 'medium', 'low'] as const, 'medium'),
        fontSize: pick(v.fontSize, ['small', 'medium', 'large'] as const, 'medium'),
        showSku: bool(v.showSku, false), showCategoryTag: bool(v.showCategoryTag, true), cartImages: bool(v.cartImages, true),
        swatchSize: pick(v.swatchSize, ['small', 'medium', 'large'] as const, 'medium'),
        optionSize: pick(v.optionSize, ['small', 'medium', 'large'] as const, 'medium'),
      };
    case 'stock': {
      const s = v.sync ?? {};
      const role = pick(s.role, ['off', 'master', 'branch'] as const, 'off');
      const masterUrl = str(s.masterUrl, 300).replace(/\/+$/, '');
      if (role === 'branch' && masterUrl && !/^https?:\/\//.test(masterUrl)) throw new HttpError(422, 'ที่อยู่สาขาหลักต้องขึ้นต้นด้วย http:// หรือ https://');
      return {
        lowStockDefault: Math.floor(num(v.lowStockDefault, 0, 9999, 3)),
        allowNegative: bool(v.allowNegative, false),
        skuDigits: Math.floor(num(v.skuDigits, 3, 6, 4)),
        skuSeparator: pick(v.skuSeparator, ['-', '', '.', '_'] as const, '-'),
        sync: {
          role, masterUrl, apiKey: secret(s.apiKey, old.stock.sync.apiKey), intervalMin: pick(Number(s.intervalMin), [5, 15, 30, 60, 0] as const, 15),
          syncPrice: bool(s.syncPrice, true), syncCost: bool(s.syncCost, true), syncImages: bool(s.syncImages, true),
        },
      };
    }
    case 'payments': {
      const list = Array.isArray(v.methods) ? v.methods : [];
      const methods = DEFAULTS.payments.methods.map((d) => {
        const m = list.find((x: { id?: string }) => x?.id === d.id) ?? {};
        return { id: d.id, label: str(m.label, 40) || d.label, enabled: bool(m.enabled, true), feePercent: num(m.feePercent, 0, 20, 0), feeFixed: num(m.feeFixed, 0, 1000, 0) };
      });
      // เรียงตามลำดับที่ส่งมา
      methods.sort((a, b) => list.findIndex((x: { id?: string }) => x?.id === a.id) - list.findIndex((x: { id?: string }) => x?.id === b.id));
      if (!methods.some((m) => m.enabled)) throw new HttpError(422, 'ต้องเปิดใช้วิธีชำระเงินอย่างน้อย 1 แบบ');
      const pp = str(v.promptpayId, 20).replace(/[^0-9]/g, '');
      if (pp && ![10, 13, 15].includes(pp.length)) throw new HttpError(422, 'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตร/เลขผู้เสียภาษี 13 หลัก');
      const vat = { enabled: bool(v.vat?.enabled, true), rate: Math.round(num(v.vat?.rate ?? old.payments.vat.rate, 0, 30, 0) * 100) / 100 };
      return { methods, promptpayId: pp, vat, feePayer: pick(v.feePayer, ['customer', 'shop'] as const, 'customer'), requireDenominations: bool(v.requireDenominations, false) };
    }
    case 'barcode': {
      const prefix = str(v.ean13Prefix, 6).replace(/[^0-9]/g, '') || '2';
      return {
        symbology: pick(v.symbology, ['code128', 'ean13'] as const, 'code128'), autoAssign: pick(v.autoAssign, ['none', 'sku', 'ean13'] as const, 'none'),
        ean13Prefix: prefix, labelWidth: Math.floor(num(v.labelWidth, 20, 120, 40)), labelHeight: Math.floor(num(v.labelHeight, 10, 100, 30)),
        labelShowPrice: bool(v.labelShowPrice, true), labelShowName: bool(v.labelShowName, true),
        ...(() => {
          const labelProfiles = cleanLabelProfiles(v.labelProfiles ?? old.barcode.labelProfiles);
          const labelProfile = labelProfiles.some((p) => p.id === v.labelProfile) ? String(v.labelProfile) : labelProfiles[0].id;
          return { labelProfiles, labelProfile, labelPresets: cleanLabelPresets(v.labelPresets ?? old.barcode.labelPresets) };
        })(),
      };
    }
    case 'receipt':
      return {
        paperWidth: pick(Number(v.paperWidth), [58, 80] as const, 80), fontSize: pick(v.fontSize, ['small', 'medium', 'large'] as const, 'medium'),
        title: str(v.title, 80), header: str(v.header, 500), footer: str(v.footer, 500),
        showSku: bool(v.showSku, false), showSalesperson: bool(v.showSalesperson, true), showCustomer: bool(v.showCustomer, true), showVat: bool(v.showVat, true),
        showOrderBarcode: bool(v.showOrderBarcode, true), autoPrint: bool(v.autoPrint, false), copies: Math.floor(num(v.copies, 1, 3, 1)),
        language: pick(v.language, ['th', 'en', 'both'] as const, 'th'),
        labels: Object.fromEntries(
          RECEIPT_LABEL_KEYS.map((k) => [k, str((v.labels ?? {})[k], 60)]).filter(([, x]) => x.trim()),
        ),
        shopName: str(v.shopName, 80),
        logoUrl: imgUrl(v.logoUrl),
        logoWidth: Math.round(num(v.logoWidth, 15, 100, 60)),
        showShopName: bool(v.showShopName, true),
        footerBlocks: (Array.isArray(v.footerBlocks) ? v.footerBlocks : []).slice(0, 12).map((b: Record<string, unknown>) => {
          const type = pick(b?.type, ['text', 'qr', 'image'] as const, 'text');
          return {
            type,
            text: type === 'image' ? imgUrl(b?.text) : str(b?.text, type === 'qr' ? 500 : 1000),
            caption: str(b?.caption, 200),
            size: pick(b?.size, ['small', 'medium', 'large'] as const, 'medium'),
            align: pick(b?.align, ['left', 'center', 'right'] as const, 'center'),
            bold: bool(b?.bold, false),
            width: Math.round(num(b?.width, 15, 100, type === 'qr' ? 45 : 60)),
          };
        }).filter((b: FooterBlock) => b.text.trim() || b.caption.trim()),
      };
    case 'notify': {
      const l = v.line ?? {};
      const w = v.whatsapp ?? {};
      const h = v.webhook ?? {};
      const ev = v.events ?? {};
      const o = v.options ?? {};
      const tp = v.templates ?? {};
      const url = str(h.url, 300);
      if (url && !/^https?:\/\//.test(url)) throw new HttpError(422, 'Webhook URL ต้องขึ้นต้นด้วย http:// หรือ https://');
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(o.dailyTime)) ? String(o.dailyTime) : '21:00';
      return {
        line: { enabled: bool(l.enabled, false), token: secret(l.token, old.notify.line.token), to: str(l.to, 80) },
        whatsapp: { enabled: bool(w.enabled, false), token: secret(w.token, old.notify.whatsapp.token), phoneNumberId: str(w.phoneNumberId, 40), to: str(w.to, 20).replace(/[^0-9]/g, '') },
        webhook: { enabled: bool(h.enabled, false), url, secret: secret(h.secret, old.notify.webhook.secret) },
        events: Object.fromEntries(EVENTS.map((e) => {
          const x = ev[e.key] ?? {};
          const d = old.notify.events[e.key] ?? e.defaults;
          return [e.key, { on: bool(x.on, d.on), line: bool(x.line, d.line), whatsapp: bool(x.whatsapp, d.whatsapp), webhook: bool(x.webhook, d.webhook) }];
        })),
        options: { saleMin: num(o.saleMin, 0, 10_000_000, 0), shiftMismatchOnly: bool(o.shiftMismatchOnly, false), dailyTime: time },
        style: cleanStyle(v.style),
        templates: Object.fromEntries(EVENTS.map((e) => [e.key, cleanTemplate(tp[e.key], old.notify.templates[e.key] ?? e.template)])),
      };
    }
    case 'api':
      return { enabled: bool(v.enabled, false) };
    case 'tax':
      return { legalName: str(v.legalName, 160), lockEdit: bool(v.lockEdit, true) };
  }
}

export function saveSection(section: string, value: unknown) {
  if (!SECTIONS.includes(section as keyof Settings)) throw new HttpError(404, 'ไม่พบหมวดการตั้งค่า');
  const old = getSettings();
  const v = clean(section as keyof Settings, (value ?? {}) as Record<string, any>, old);
  db.prepare(
    `INSERT INTO settings (section, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))
     ON CONFLICT(section) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(section, JSON.stringify(v));
  cache = null;
  return forAdmin();
}

/** สำหรับหน้าตั้งค่า (ผู้จัดการ): ซ่อนรหัสลับ แสดงแค่ว่ามีค่าแล้ว */
export function forAdmin() {
  const s = structuredClone(getSettings());
  const mask = (x: string) => (x ? `••••${x.slice(-4)}` : '');
  return {
    ...s,
    // VAT ที่ใช้จริง (สาขาที่กำลังใช้งาน + อัตราที่มีผลวันนี้จากตารางอัตรา VAT)
    payments: { ...s.payments, vat: { enabled: currentBranchInfo().vatRegistered, rate: Math.round(getVatRate() * 10000) / 100 } },
    stock: { ...s.stock, sync: { ...s.stock.sync, apiKey: mask(s.stock.sync.apiKey) } },
    notify: {
      ...s.notify, line: { ...s.notify.line, token: mask(s.notify.line.token) }, whatsapp: { ...s.notify.whatsapp, token: mask(s.notify.whatsapp.token) },
      webhook: { ...s.notify.webhook, secret: mask(s.notify.webhook.secret) },
    },
  };
}

/** ส่วนที่หน้าขาย/ใบเสร็จใช้ (ไม่มีรหัสลับ) — ส่งไปกับ bootstrap */
export function publicSettings() {
  const s = getSettings();
  // ชื่อสาขา รหัส ที่อยู่ เบอร์โทร รูป และ VAT มาจากสาขาที่กำลังใช้งาน (เมนูสาขา)
  const b = currentBranchInfo();
  const shop = {
    ...s.shop, branchName: b.name, branchCode: b.code, address: b.address || s.shop.address, phone: b.phone || s.shop.phone,
    photoUrl: b.photo || s.shop.photoUrl,
  };
  // อัตรา VAT = อัตราที่มีผลวันนี้จากตารางอัตรา VAT (ตั้งค่า → ภาษี)
  const payments = { ...s.payments, vat: { enabled: b.vatRegistered, rate: Math.round(getVatRate() * 10000) / 100 } };
  return {
    shop, display: s.display, payments, receipt: s.receipt, barcode: { symbology: s.barcode.symbology, labelProfiles: s.barcode.labelProfiles, labelProfile: s.barcode.labelProfile, labelPresets: s.barcode.labelPresets ?? [] }, stock: { lowStockDefault: s.stock.lowStockDefault, allowNegative: s.stock.allowNegative },
    branch: { id: b.id, name: b.name, code: b.code, isMain: b.isMain },
    tax: { legalName: s.tax.legalName, taxId: s.shop.taxId, taxBranchNo: b.taxBranchNo, vatRegistered: b.vatRegistered, lockEdit: s.tax.lockEdit && b.vatRegistered },
  };
}

/** ใครจ่ายค่าธรรมเนียม: customer = บวกเพิ่มในยอดบิล · shop = ร้านจ่ายเอง (บันทึกไว้ดูในรายงาน) */
export const feePayer = () => getSettings().payments.feePayer;

/** ค่าธรรมเนียมของวิธีชำระเงิน คิดจากยอดสินค้าหลังหักส่วนลด */
export function feeFor(method: string, amount: number) {
  const m = getSettings().payments.methods.find((x) => x.id === method);
  if (!m || amount <= 0) return 0;
  return Math.round((amount * m.feePercent) / 100 * 100 + m.feeFixed * 100) / 100;
}
export function methodEnabled(method: string) {
  return !!getSettings().payments.methods.find((x) => x.id === method && x.enabled);
}

// โหลดค่าตอนเริ่ม server (ตั้งอัตรา VAT ให้พร้อมก่อนขายบิลแรก)
getSettings();

/** ตั้งค่า → สต็อก → ขายได้แม้สต็อกหมด (สต็อกติดลบได้) */
export const allowNegativeStock = () => getSettings().stock.allowNegative === true;
