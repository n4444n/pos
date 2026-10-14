// การแจ้งเตือน: รายการเหตุการณ์ · ตัวแปรในข้อความ · แม่แบบการ์ด LINE (Flex Message) · ข้อความ WhatsApp
// ใช้ร่วมกันระหว่าง settings.ts (ค่าเริ่มต้น/ตรวจค่า) และ events.ts (ส่งจริง)

export type EventKey = 'sale' | 'void' | 'edit' | 'lowStock' | 'outStock' | 'shiftOpen' | 'shiftClose' | 'cash' | 'expense' | 'daily';

export interface CardLine { label: string; value: string }
export interface CardTemplate {
  emoji: string;
  title: string;
  subtitle: string;
  /** สีแถบหัวการ์ด ('' = ใช้สีหลักของร้าน) */
  color: string;
  lines: CardLine[];
  showItems: boolean;
  itemsTitle: string;
  footer: string;
}
export interface CardStyle {
  /** สีหลัก (หัวการ์ด/ปุ่ม) */
  color: string;
  /** โลโก้ร้าน (URL รูปที่เปิดได้จากอินเทอร์เน็ต) */
  logoUrl: string;
  /** ปุ่มท้ายการ์ด เช่น "เปิดระบบ POS" → ลิงก์ที่ต้องการให้เปิด */
  buttonLabel: string;
  buttonUrl: string;
  /** ขนาดการ์ด */
  size: 'kilo' | 'mega' | 'giga';
}
export interface EventChannels { on: boolean; line: boolean; whatsapp: boolean; webhook: boolean }
export interface NotifyItem { name: string; detail: string; value: string }

interface EventMeta {
  key: EventKey;
  /** ชื่อเหตุการณ์ (webhook) */
  name: string;
  label: string;
  desc: string;
  placeholders: [string, string][];
  sample: Record<string, string>;
  sampleItems: NotifyItem[];
  hasItems: boolean;
  defaults: EventChannels;
  template: CardTemplate;
}

const COMMON: [string, string][] = [
  ['shop', 'ชื่อร้าน'], ['branch', 'ชื่อสาขา'], ['branchCode', 'รหัสสาขา'], ['date', 'วันที่'], ['time', 'เวลา'], ['staff', 'พนักงาน'],
];
const COMMON_SAMPLE = { shop: 'ร้านเสื้อผ้า ABC', branch: 'สาขาภูเก็ต', branchCode: 'B02', date: '11 ต.ค. 2569', time: '15:42', staff: 'มายด์' };
const t = (p: Partial<CardTemplate> & Pick<CardTemplate, 'emoji' | 'title' | 'lines'>): CardTemplate => ({
  subtitle: '{shop} · {branch}', color: '', showItems: false, itemsTitle: 'รายการ', footer: '{date} {time}', ...p,
});

export const EVENTS: EventMeta[] = [
  {
    key: 'sale', name: 'order.created', label: 'ขายสำเร็จ', desc: 'ทุกบิล หรือเฉพาะบิลยอดสูง (ตั้งยอดขั้นต่ำได้)', hasItems: true,
    placeholders: [['orderNo', 'เลขที่บิล'], ['total', 'ยอดสุทธิ'], ['subtotal', 'ยอดสินค้า'], ['discount', 'ส่วนลด'], ['fee', 'ค่าธรรมเนียม'], ['payment', 'วิธีชำระ'], ['count', 'จำนวนชิ้น'], ['customer', 'ลูกค้า'], ['orderType', 'ประเภทการขาย']],
    sample: { orderNo: 'INV-B02-261011-0012', total: '฿1,280', subtotal: '฿1,380', discount: '฿100', fee: '฿0', payment: 'พร้อมเพย์ (QR)', count: '3', customer: 'คุณนิด', orderType: 'หน้าร้าน' },
    sampleItems: [
      { name: 'เสื้อยืดคอกลม Cotton', detail: 'ขาว / M × 2', value: '฿580' },
      { name: 'กางเกงยีนส์ Slim', detail: 'น้ำเงิน / 32 × 1', value: '฿800' },
    ],
    defaults: { on: false, line: true, whatsapp: true, webhook: true },
    template: t({
      emoji: '🛍️', title: 'ขายสำเร็จ {total}', showItems: true, itemsTitle: 'สินค้า',
      lines: [{ label: 'เลขที่บิล', value: '{orderNo}' }, { label: 'ชำระด้วย', value: '{payment}' }, { label: 'จำนวน', value: '{count} ชิ้น' }, { label: 'พนักงาน', value: '{staff}' }],
    }),
  },
  {
    key: 'void', name: 'order.voided', label: 'ยกเลิกบิล', desc: 'มีการยกเลิกบิลด้วย PIN', hasItems: false,
    placeholders: [['orderNo', 'เลขที่บิล'], ['total', 'ยอดบิล'], ['reason', 'เหตุผล']],
    sample: { orderNo: 'INV-B02-261011-0009', total: '฿590', reason: 'ลูกค้ายกเลิกการซื้อ' },
    sampleItems: [],
    defaults: { on: true, line: true, whatsapp: true, webhook: true },
    template: t({
      emoji: '🚫', title: 'ยกเลิกบิล {orderNo}', color: '#E5484D',
      lines: [{ label: 'ยอดบิล', value: '{total}' }, { label: 'เหตุผล', value: '{reason}' }, { label: 'อนุมัติโดย', value: '{staff}' }],
    }),
  },
  {
    key: 'edit', name: 'order.edited', label: 'แก้ไขบิล / คืนเงิน', desc: 'เปลี่ยนสินค้า เก็บเงินเพิ่ม หรือคืนเงิน', hasItems: false,
    placeholders: [['orderNo', 'เลขที่บิล'], ['oldTotal', 'ยอดเดิม'], ['newTotal', 'ยอดใหม่'], ['diff', 'ส่วนต่าง'], ['reason', 'เหตุผล']],
    sample: { orderNo: 'INV-B02-261011-0007', oldTotal: '฿1,200', newTotal: '฿890', diff: '-฿310 (คืนเงิน)', reason: 'เปลี่ยนไซซ์' },
    sampleItems: [],
    defaults: { on: false, line: true, whatsapp: false, webhook: true },
    template: t({
      emoji: '✏️', title: 'แก้ไขบิล {orderNo}', color: '#D98200',
      lines: [{ label: 'ยอดเดิม', value: '{oldTotal}' }, { label: 'ยอดใหม่', value: '{newTotal}' }, { label: 'ส่วนต่าง', value: '{diff}' }, { label: 'เหตุผล', value: '{reason}' }, { label: 'โดย', value: '{staff}' }],
    }),
  },
  {
    key: 'lowStock', name: 'stock.low', label: 'สินค้าใกล้หมด', desc: 'ขายจนถึงจุดแจ้งเตือนของสินค้า', hasItems: true,
    placeholders: [['count', 'จำนวนรายการ']],
    sample: { count: '2' },
    sampleItems: [
      { name: 'เสื้อโปโล Piqué', detail: 'กรมท่า / L', value: 'เหลือ 2' },
      { name: 'เดรสลินิน', detail: 'ครีม / S', value: 'เหลือ 1' },
    ],
    defaults: { on: true, line: true, whatsapp: true, webhook: true },
    template: t({ emoji: '📦', title: 'สินค้าใกล้หมด {count} รายการ', color: '#F5A524', showItems: true, itemsTitle: 'ควรสั่งเพิ่ม', lines: [] }),
  },
  {
    key: 'outStock', name: 'stock.out', label: 'สินค้าหมด', desc: 'SKU ขายจนเหลือ 0', hasItems: true,
    placeholders: [['count', 'จำนวนรายการ']],
    sample: { count: '1' },
    sampleItems: [{ name: 'เสื้อเชิ้ต Oxford', detail: 'ฟ้า / M', value: 'หมด' }],
    defaults: { on: true, line: true, whatsapp: false, webhook: true },
    template: t({ emoji: '⛔', title: 'สินค้าหมด {count} รายการ', color: '#C62828', showItems: true, itemsTitle: 'หมดแล้ว', lines: [] }),
  },
  {
    key: 'shiftOpen', name: 'shift.opened', label: 'เปิดกะ', desc: 'พนักงานเปิดกะ (เริ่มขาย)', hasItems: false,
    placeholders: [['shiftNo', 'กะที่'], ['openingCash', 'เงินทอนตั้งต้น']],
    sample: { shiftNo: '1', openingCash: '฿1,000' },
    sampleItems: [],
    defaults: { on: false, line: true, whatsapp: false, webhook: true },
    template: t({ emoji: '🔓', title: 'เปิดกะ #{shiftNo}', color: '#1F9D63', lines: [{ label: 'เงินทอนตั้งต้น', value: '{openingCash}' }, { label: 'เปิดโดย', value: '{staff}' }] }),
  },
  {
    key: 'shiftClose', name: 'shift.closed', label: 'ปิดกะ', desc: 'สรุปยอดขาย และเงินในลิ้นชักตรง/ขาด/เกิน', hasItems: false,
    placeholders: [['shiftNo', 'กะที่'], ['sales', 'ยอดขาย'], ['bills', 'จำนวนบิล'], ['expected', 'เงินสดที่ควรมี'], ['counted', 'นับได้'], ['diff', 'ส่วนต่าง'], ['verdict', 'ผลการนับ']],
    sample: { shiftNo: '1', sales: '฿24,560', bills: '18', expected: '฿8,420', counted: '฿8,400', diff: '-฿20', verdict: 'เงินขาด ❌' },
    sampleItems: [],
    defaults: { on: true, line: true, whatsapp: true, webhook: true },
    template: t({
      emoji: '🧾', title: 'ปิดกะ #{shiftNo} · {verdict}', color: '#6B4EFF',
      lines: [{ label: 'ยอดขาย', value: '{sales}' }, { label: 'จำนวนบิล', value: '{bills}' }, { label: 'เงินสดที่ควรมี', value: '{expected}' }, { label: 'นับได้', value: '{counted}' }, { label: 'ส่วนต่าง', value: '{diff}' }, { label: 'ปิดโดย', value: '{staff}' }],
    }),
  },
  {
    key: 'cash', name: 'cash.moved', label: 'นำเงินเข้า/ออกลิ้นชัก', desc: 'เช่น แลกเหรียญ จ่ายค่าส่งของ', hasItems: false,
    placeholders: [['kind', 'ประเภท (นำเข้า/นำออก)'], ['amount', 'จำนวนเงิน'], ['reason', 'เหตุผล']],
    sample: { kind: 'นำเงินออก', amount: '฿350', reason: 'จ่ายค่าส่งของ' },
    sampleItems: [],
    defaults: { on: false, line: true, whatsapp: false, webhook: true },
    template: t({ emoji: '💵', title: '{kind} {amount}', color: '#0E9AA7', lines: [{ label: 'เหตุผล', value: '{reason}' }, { label: 'โดย', value: '{staff}' }] }),
  },
  {
    key: 'expense', name: 'expense.created', label: 'บันทึกค่าใช้จ่าย', desc: 'มีการลงค่าใช้จ่ายร้าน (ทุกแหล่งเงิน)', hasItems: false,
    placeholders: [['amount', 'จำนวนเงิน'], ['category', 'หมวด'], ['description', 'รายละเอียด'], ['source', 'จ่ายจาก'], ['vendor', 'ร้านค้า/ผู้รับเงิน'], ['refNo', 'เลขที่ใบเสร็จ']],
    sample: { amount: '฿1,250', category: 'วัสดุสิ้นเปลือง (ถุง แท็ก ไม้แขวน)', description: 'ถุงช้อปปิ้ง 500 ใบ', source: 'เงินสดในลิ้นชัก', vendor: 'ร้านบรรจุภัณฑ์', refNo: 'RC-0091' },
    sampleItems: [],
    defaults: { on: false, line: true, whatsapp: false, webhook: true },
    template: t({
      emoji: '💸', title: 'ค่าใช้จ่าย {amount}', color: '#E5484D',
      lines: [{ label: 'หมวด', value: '{category}' }, { label: 'รายการ', value: '{description}' }, { label: 'จ่ายจาก', value: '{source}' }, { label: 'บันทึกโดย', value: '{staff}' }],
    }),
  },
  {
    key: 'daily', name: 'report.daily', label: 'สรุปยอดขายประจำวัน', desc: 'ส่งอัตโนมัติทุกวันตามเวลาที่ตั้ง (รวมทุกสาขา)', hasItems: true,
    placeholders: [['sales', 'ยอดขายรวม'], ['bills', 'จำนวนบิล'], ['units', 'จำนวนชิ้น'], ['avg', 'เฉลี่ยต่อบิล'], ['voids', 'บิลยกเลิก'], ['top', 'สินค้าขายดีอันดับ 1']],
    sample: { sales: '฿58,240', bills: '42', units: '96', avg: '฿1,387', voids: '1', top: 'เสื้อยืดคอกลม Cotton' },
    sampleItems: [
      { name: 'สาขาหลัก', detail: '25 บิล', value: '฿34,120' },
      { name: 'สาขาภูเก็ต', detail: '17 บิล', value: '฿24,120' },
    ],
    defaults: { on: true, line: true, whatsapp: true, webhook: true },
    template: t({
      emoji: '📊', title: 'สรุปยอดขาย {date}', subtitle: '{shop}', color: '#1B1F27', showItems: true, itemsTitle: 'แยกตามสาขา', footer: 'ส่งอัตโนมัติ {time}',
      lines: [{ label: 'ยอดขายรวม', value: '{sales}' }, { label: 'จำนวนบิล', value: '{bills}' }, { label: 'ชิ้นที่ขาย', value: '{units}' }, { label: 'เฉลี่ยต่อบิล', value: '{avg}' }, { label: 'ขายดีที่สุด', value: '{top}' }],
    }),
  },
];
export const EVENT_KEYS = EVENTS.map((e) => e.key);
export const eventByName = (name: string) => EVENTS.find((e) => e.name === name);
export const eventMeta = (key: EventKey) => EVENTS.find((e) => e.key === key)!;
export const ALL_PLACEHOLDERS = (key: EventKey) => [...COMMON, ...eventMeta(key).placeholders];
export const sampleVars = (key: EventKey) => ({ ...COMMON_SAMPLE, ...eventMeta(key).sample });

export const DEFAULT_STYLE: CardStyle = { color: '#2F6BFF', logoUrl: '', buttonLabel: '', buttonUrl: '', size: 'mega' };

// ---------- แทนค่าตัวแปร ----------
export function fill(s: string, vars: Record<string, string>) {
  return String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const safeColor = (c: string, d: string) => (HEX.test(c) ? c : d);
/** สีตัวอักษรบนพื้นสี: ขาวหรือดำ ให้อ่านง่าย */
export function onColor(hex: string) {
  const h = safeColor(hex, '#2F6BFF').slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#1B1F27' : '#FFFFFF';
}
const nz = (s: string) => (s && s.trim() ? s : ' ');

// ---------- LINE Flex Message ----------
export function flexMessage(tpl: CardTemplate, style: CardStyle, vars: Record<string, string>, items: NotifyItem[]) {
  const color = safeColor(tpl.color || style.color, '#2F6BFF');
  const fg = onColor(color);
  const title = fill(`${tpl.emoji ? tpl.emoji + ' ' : ''}${tpl.title}`, vars);
  const subtitle = fill(tpl.subtitle, vars);
  const lines = tpl.lines.map((l) => ({ label: fill(l.label, vars), value: fill(l.value, vars) })).filter((l) => l.label.trim() || l.value.trim());
  const footer = fill(tpl.footer, vars);

  const header: Record<string, unknown> = {
    type: 'box', layout: 'horizontal', backgroundColor: color, paddingAll: '16px', spacing: 'md',
    contents: [
      ...(style.logoUrl && /^https:\/\//.test(style.logoUrl)
        ? [{ type: 'image', url: style.logoUrl, size: '40px', aspectMode: 'cover', aspectRatio: '1:1', flex: 0 }]
        : []),
      {
        type: 'box', layout: 'vertical', flex: 1,
        contents: [
          { type: 'text', text: nz(title), weight: 'bold', size: 'lg', color: fg, wrap: true },
          ...(subtitle.trim() ? [{ type: 'text', text: subtitle, size: 'xs', color: fg, wrap: true, margin: 'sm' }] : []),
        ],
      },
    ],
  };
  const body: unknown[] = lines.map((l) => ({
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [
      { type: 'text', text: nz(l.label), size: 'sm', color: '#8A8F98', flex: 4, wrap: true },
      { type: 'text', text: nz(l.value), size: 'sm', color: '#1B1F27', weight: 'bold', flex: 6, align: 'end', wrap: true },
    ],
  }));
  if (tpl.showItems && items.length) {
    if (body.length) body.push({ type: 'separator', margin: 'lg' });
    body.push({ type: 'text', text: nz(fill(tpl.itemsTitle, vars)), size: 'xs', color: '#8A8F98', weight: 'bold', margin: body.length ? 'lg' : 'none' });
    for (const it of items.slice(0, 12)) {
      body.push({
        type: 'box', layout: 'horizontal', spacing: 'md', margin: 'sm',
        contents: [
          {
            type: 'box', layout: 'vertical', flex: 7,
            contents: [
              { type: 'text', text: nz(it.name), size: 'sm', color: '#1B1F27', wrap: true },
              ...(it.detail ? [{ type: 'text', text: it.detail, size: 'xxs', color: '#8A8F98', wrap: true }] : []),
            ],
          },
          { type: 'text', text: nz(it.value), size: 'sm', color: '#1B1F27', align: 'end', flex: 3, gravity: 'center' },
        ],
      });
    }
    if (items.length > 12) body.push({ type: 'text', text: `และอีก ${items.length - 12} รายการ`, size: 'xxs', color: '#8A8F98', margin: 'sm' });
  }
  const footerContents: unknown[] = [];
  if (footer.trim()) footerContents.push({ type: 'text', text: footer, size: 'xxs', color: '#A0A6B1', wrap: true, align: 'center' });
  const btnUrl = fill(style.buttonUrl, vars);
  if (style.buttonLabel.trim() && /^https?:\/\//.test(btnUrl)) {
    footerContents.push({
      type: 'button', style: 'primary', height: 'sm', color, margin: 'md',
      action: { type: 'uri', label: style.buttonLabel.slice(0, 40), uri: btnUrl },
    });
  }
  const bubble: Record<string, unknown> = {
    type: 'bubble', size: style.size,
    header,
    ...(body.length ? { body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: body } } : {}),
    ...(footerContents.length ? { footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: footerContents } } : {}),
  };
  const alt = [title, ...lines.slice(0, 2).map((l) => `${l.label} ${l.value}`)].join(' · ').slice(0, 390);
  return { type: 'flex', altText: alt || 'แจ้งเตือนจาก POS', contents: bubble };
}

// ---------- ข้อความธรรมดา (WhatsApp / ตัวสำรอง) ----------
export function plainText(tpl: CardTemplate, vars: Record<string, string>, items: NotifyItem[]) {
  const out: string[] = [];
  out.push(`*${fill(`${tpl.emoji ? tpl.emoji + ' ' : ''}${tpl.title}`, vars)}*`);
  const sub = fill(tpl.subtitle, vars);
  if (sub.trim()) out.push(sub);
  const lines = tpl.lines.map((l) => `${fill(l.label, vars)}: ${fill(l.value, vars)}`).filter((x) => x.replace(':', '').trim());
  if (lines.length) out.push('', ...lines);
  if (tpl.showItems && items.length) {
    out.push('', `_${fill(tpl.itemsTitle, vars)}_`);
    for (const it of items.slice(0, 20)) out.push(`• ${it.name}${it.detail ? ` (${it.detail})` : ''} — ${it.value}`);
  }
  const f = fill(tpl.footer, vars);
  if (f.trim()) out.push('', f);
  return out.join('\n');
}

// ---------- ตรวจค่าที่บันทึก ----------
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
export function cleanTemplate(v: Record<string, any> | undefined, d: CardTemplate): CardTemplate {
  if (!v || typeof v !== 'object') return structuredClone(d);
  const lines = Array.isArray(v.lines) ? v.lines.slice(0, 12).map((l: Record<string, unknown>) => ({ label: str(l?.label, 60), value: str(l?.value, 200) })) : d.lines;
  return {
    emoji: str(v.emoji ?? d.emoji, 8), title: str(v.title ?? d.title, 120), subtitle: str(v.subtitle ?? d.subtitle, 120),
    color: HEX.test(String(v.color)) ? String(v.color) : v.color === '' ? '' : d.color,
    lines, showItems: typeof v.showItems === 'boolean' ? v.showItems : d.showItems, itemsTitle: str(v.itemsTitle ?? d.itemsTitle, 60),
    footer: str(v.footer ?? d.footer, 160),
  };
}
export function cleanStyle(v: Record<string, any> | undefined): CardStyle {
  const x = v ?? {};
  const logo = str(x.logoUrl, 500).trim();
  const url = str(x.buttonUrl, 500).trim();
  return {
    color: HEX.test(String(x.color)) ? String(x.color) : DEFAULT_STYLE.color,
    logoUrl: /^https:\/\//.test(logo) ? logo : '',
    buttonLabel: str(x.buttonLabel, 40),
    buttonUrl: /^https?:\/\//.test(url) || url.startsWith('{') ? url : '',
    size: x.size === 'kilo' || x.size === 'giga' ? x.size : 'mega',
  };
}
