import { Platform } from 'react-native';
import { variantLabel } from './format';
import { parseLocal, receiptText } from './receiptText';
import { qrSvg } from './qr';
import type { FooterBlock } from './appSettings';
import type { Order } from './types';
import { getAppSettings } from './appSettings';
import { code128 } from './components/stock/Barcode';
import { desktop, type PrintKind } from './desktop';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const m = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ขนาดกระดาษม้วน: ตั้งค่าของเครื่องนี้ (แอปเดสก์ท็อป) มาก่อน ถ้าไม่ได้ตั้งใช้ ตั้งค่าร้าน → ใบเสร็จ */
export function paperWidth(): 58 | 80 {
  const d = desktop()?.paperWidth();
  if (d === 58 || d === 80) return d;
  return getAppSettings().receipt.paperWidth === 58 ? 58 : 80;
}
/** ความกว้างพื้นที่พิมพ์จริง (มม.) */
const bodyWidth = (pw: 58 | 80) => (pw === 58 ? 50 : 72);
/** CSS หน้ากระดาษม้วน */
const rollPage = (pw: 58 | 80) => `@page { size: ${pw}mm auto; margin: ${pw === 58 ? 2 : 4}mm }`;

const AUTO_PRINT = '<script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300) }</script>';
/**
 * ส่งเอกสารกระดาษม้วนไปพิมพ์
 * - แอปเดสก์ท็อป: พิมพ์ตรงเข้าเครื่องพิมพ์ที่ตั้งไว้ ไม่ขึ้นกล่องเลือกเครื่องพิมพ์
 * - เบราว์เซอร์: เปิดหน้าต่างพิมพ์ตามเดิม
 */
function output(doc: string, features: string, kind: PrintKind, win?: Window | null) {
  const d = desktop();
  if (d) {
    win?.close();
    void d.print(doc, { paperWidth: paperWidth(), kind });
    return;
  }
  const w = win ?? window.open('', '_blank', features);
  if (!w) return;
  w.document.open();
  w.document.write(doc.replace('</body>', `${AUTO_PRINT}</body>`));
  w.document.close();
}

/** บาร์โค้ด Code128 ของเลขที่บิลเป็น SVG (พิมพ์บนใบเสร็จ) */
function barcodeSvg(text: string) {
  const w = code128(text);
  if (!w) return '';
  let x = 0;
  const bars: string[] = [];
  w.forEach((n, i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${n}" height="40"/>`);
    x += n;
  });
  return `<svg viewBox="0 0 ${x} 40" preserveAspectRatio="none" style="width:90%;height:34px">${bars.join('')}</svg>`;
}

/** ลิงก์รูปแบบเต็ม (หน้าพิมพ์เป็นหน้าต่างใหม่) */
const absUrl = (u: string) => {
  try {
    return new URL(u, window.location.origin).href;
  } catch {
    return u;
  }
};

/** ส่วนท้ายบิลที่เพิ่มเอง → HTML */
export function footerBlocksHtml(blocks: FooterBlock[], bodyW: number, fs: number) {
  const sz = (b: FooterBlock) => (b.size === 'small' ? fs - 1 : b.size === 'large' ? fs + 3 : fs);
  return (blocks ?? [])
    .map((b) => {
      const style = `text-align:${b.align};font-size:${sz(b)}px;${b.bold ? 'font-weight:700;' : ''}margin-top:6px`;
      const cap = b.caption.trim() ? `<div style="font-size:${sz(b)}px;${b.bold ? 'font-weight:700;' : ''}white-space:pre-line">${esc(b.caption)}</div>` : '';
      const w = `${((bodyW * b.width) / 100).toFixed(1)}mm`;
      if (b.type === 'qr') return `<div style="${style}">${cap}${b.text.trim() ? qrSvg(b.text, w) : ''}</div>`;
      if (b.type === 'image') return `<div style="${style}">${b.text ? `<img src="${esc(absUrl(b.text))}" style="width:${w};max-width:100%">` : ''}${cap}</div>`;
      return `<div style="${style};white-space:pre-line">${esc(b.text)}</div>`;
    })
    .join('');
}

/** พิมพ์ใบเสร็จ (เว็บ) — รูปแบบตาม ตั้งค่า → ใบเสร็จ */
export function printReceipt(order: Order) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const { receipt: r, shop } = getAppSettings();
  const { t, pay, date, vat, lang } = receiptText(r);
  const shopName = r.shopName?.trim() || shop.name;
  const pw = paperWidth();
  const fs = r.fontSize === 'small' ? 11 : r.fontSize === 'large' ? 14 : 12;
  const bodyW = bodyWidth(pw);
  const lines = (t: string) => t.split(/\r?\n/).filter(Boolean).map((l) => `<div class="c">${esc(l)}</div>`).join('');
  const rows = order.items
    .map(
      (i) =>
        `<tr><td>${esc(i.name)}<br><small>${esc(variantLabel(i))}${r.showSku && i.sku ? ` · ${esc(i.sku)}` : ''} · @${m(i.unitPrice)}</small></td><td class="q">${i.qty.toLocaleString()}</td><td class="r">${m(i.lineTotal)}</td></tr>`,
    )
    .join('');
  const logo = r.logoUrl ? `<div class="c"><img src="${esc(absUrl(r.logoUrl))}" style="width:${((bodyW * r.logoWidth) / 100).toFixed(1)}mm;max-width:100%"></div>` : '';
  const one = `
  ${logo}
  ${!r.logoUrl || r.showShopName ? `<h1>${esc(shopName)}</h1>` : ''}
  ${shop.branchName ? `<div class="c">${esc(shop.branchName)}${shop.branchCode ? ` (${esc(shop.branchCode)})` : ''}</div>` : ''}
  ${shop.address ? `<div class="c"><small>${esc(shop.address)}</small></div>` : ''}
  ${shop.phone ? `<div class="c"><small>${esc(t('tel'))} ${esc(shop.phone)}</small></div>` : ''}
  ${shop.taxId ? `<div class="c"><small>${esc(t('taxId'))} ${esc(shop.taxId)}</small></div>` : ''}
  ${r.header ? lines(r.header) : ''}
  ${r.title ? `<div class="c b">${esc(r.title)}</div>` : ''}<hr>
  <div>${esc(t('orderNo'))}: ${esc(order.orderNo)}</div>
  <div>${esc(t('date'))}: ${esc(date(parseLocal(order.createdAt)))}</div>
  ${r.showCustomer && order.customerName ? `<div>${esc(t('customer'))}: ${esc(order.customerName)}</div>` : ''}
  ${r.showSalesperson && order.salesperson ? `<div>${esc(t('staff'))}: ${esc(order.salesperson)}</div>` : ''}
  <hr><table class="it"><thead><tr><th>${esc(t('colItem'))}</th><th class="q">${esc(t('colQty'))}</th><th class="r">${esc(t('colAmount'))}</th></tr></thead><tbody>${rows}</tbody></table><hr>
  <table>
    <tr><td>${esc(t('subtotal'))}</td><td class="r">${m(order.subtotal)}</td></tr>
    ${order.discount > 0 ? `<tr><td>${esc(t('discount'))} ${esc(order.promoCode ?? '')}</td><td class="r">-${m(order.discount)}</td></tr>` : ''}
    ${order.fee && order.feePayer === 'customer' ? `<tr><td>${esc(t('fee'))} ${esc(pay(order.paymentMethod))}</td><td class="r">+${m(order.fee)}</td></tr>` : ''}
    <tr class="t"><td>${esc(t('total'))}</td><td class="r">${m(order.total)}</td></tr>
    ${r.showVat && order.vat > 0 ? `<tr><td><small>${esc(vat(order))}</small></td><td class="r"><small>${m(order.vat)}</small></td></tr>` : ''}
    <tr><td>${esc(t('paidBy'))} ${esc(pay(order.paymentMethod))}</td><td class="r">${order.cashReceived != null ? m(order.cashReceived) : ''}</td></tr>
    ${order.changeDue != null ? `<tr><td>${esc(t('change'))}</td><td class="r">${m(order.changeDue)}</td></tr>` : ''}
  </table><hr>
  ${r.footer ? lines(r.footer) : ''}
  ${footerBlocksHtml(r.footerBlocks, bodyW, fs)}
  ${r.showOrderBarcode ? `<div class="c" style="margin-top:6px">${barcodeSvg(order.orderNo)}</div>` : ''}`;
  const copies = Array.from({ length: Math.max(1, r.copies) }, (_, i) => `<section${i ? ' class="pb"' : ''}>${one}</section>`).join('');
  const doc = `<!doctype html><html lang="${lang === 'en' ? 'en' : 'th'}"><head><meta charset="utf-8"><title>${esc(order.orderNo)}</title>
<style>
  ${rollPage(pw)}
  body { font-family: 'IBM Plex Sans Thai', system-ui, sans-serif; font-size: ${fs}px; width: ${bodyW}mm; margin: 0 auto; color:#000 }
  h1 { font-size: ${fs + 4}px; text-align: center; margin: 4px 0 }
  .c { text-align: center } .b { font-weight: 700 } .r { text-align: right; white-space: nowrap; vertical-align: top }
  table { width: 100%; border-collapse: collapse } td { padding: 3px 0 }
  small { color: #444; font-size: ${fs - 1}px } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 }
  .t td { font-size: ${fs + 3}px; font-weight: 700 } .pb { page-break-before: always }
  .it th { font-weight: 700; text-align: left; padding: 0 0 4px; border-bottom: 1px dashed #000 } .it tbody tr:first-child td { padding-top: 5px }
  .it .q { text-align: center; white-space: nowrap; vertical-align: top; width: 14% } .it th.r { text-align: right }
  img { filter: grayscale(1) }
</style></head><body>${copies}
</body></html>`;
  output(doc, `width=${pw === 58 ? 300 : 380},height=640`, 'receipt');
}

/** พิมพ์รายงานปิดกะ (กระดาษม้วน 58/80 มม.) */
export function printShiftReport(s: import('./types').Shift, shopName = getAppSettings().shop.name) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const pw = paperWidth();
  const verdict = s.verdict === 'match' ? 'ยอดเงินตรงกัน' : s.verdict === 'short' ? 'เงินขาด' : s.verdict === 'over' ? 'เงินเกิน' : 'ยังไม่ปิดกะ';
  const row = (l: string, r: string, b = false) => `<tr${b ? ' class="t"' : ''}><td>${esc(l)}</td><td class="r">${r}</td></tr>`;
  const denoms = s.denominations
    ? Object.entries(s.denominations)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([d, n]) => row(`${Number(d).toLocaleString()} × ${n}`, m(Number(d) * n)))
        .join('')
    : '';
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Shift ${s.shiftNo}</title>
<style>
  ${rollPage(pw)}
  body { font-family: 'IBM Plex Sans Thai', system-ui, sans-serif; font-size: 12px; width: ${bodyWidth(pw)}mm; margin: 0 auto; color:#000 }
  h1 { font-size: 16px; text-align: center; margin: 4px 0 } .c { text-align: center } .r { text-align: right; white-space: nowrap }
  table { width: 100%; border-collapse: collapse } td { padding: 2px 0 } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 }
  .t td { font-weight: 700; font-size: 14px } .v { text-align: center; font-size: 16px; font-weight: 700; border: 1px solid #000; padding: 6px; margin: 6px 0 }
</style></head><body>
  <h1>${esc(shopName)}</h1><div class="c">รายงานปิดกะ #${s.shiftNo} · ${esc(s.businessDate)}</div><hr>
  <table>
    ${row('เปิดกะ', `${esc(s.openedAt.slice(11, 16))} · ${esc(s.openedBy.replace('พนักงาน: ', ''))}`)}
    ${row('ปิดกะ', s.closedAt ? `${esc(s.closedAt.slice(11, 16))} · ${esc((s.closedBy ?? '').replace('พนักงาน: ', ''))}` : '-')}
    ${row('จำนวนบิล', String(s.billCount))}
  </table><hr>
  <table>
    ${row('เงินตั้งต้น', m(s.openingCash))}
    ${row('เงินสด (ขาย)', m(s.cashSales))}
    ${row('นำเงินเข้า', m(s.cashIn))}
    ${row('นำเงินออก', '-' + m(s.cashOut))}
    ${row('ควรมีในลิ้นชัก', m(s.expectedCash), true)}
    ${row('นับได้จริง', s.countedCash != null ? m(s.countedCash) : '-', true)}
    ${row('ส่วนต่าง', s.diff != null ? m(s.diff) : '-')}
  </table>
  <div class="v">${verdict}</div>
  ${denoms ? `<hr><div>การนับเงิน</div><table>${denoms}</table>` : ''}
  <hr><table>
    ${row('พร้อมเพย์', m(s.byMethod.promptpay ?? 0))}
    ${row('บัตร', m(s.byMethod.card ?? 0))}
    ${row('โอน', m(s.byMethod.transfer ?? 0))}
    ${row('ยอดขายรวม', m(s.totalSales), true)}
  </table>
  ${s.closeNote ? `<hr><div>หมายเหตุ: ${esc(s.closeNote)}</div>` : ''}
  <br><br><div class="c">ลงชื่อ ____________________</div>
</body></html>`;
  output(doc, 'width=380,height=700', 'shift');
}

/** เปิดหน้าต่างพิมพ์ล่วงหน้า (ต้องเปิดตอนกดปุ่ม ไม่งั้นเบราว์เซอร์บล็อกป๊อปอัป) */
export function openPrintWindow(width = 380) {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || desktop()) return null; // แอปเดสก์ท็อปพิมพ์ตรง ไม่ต้องเปิดหน้าต่าง
  const w = window.open('', '_blank', `width=${width},height=720`);
  if (w) w.document.write('<p style="font-family:system-ui;padding:20px;color:#666">กำลังเตรียมรายงาน…</p>');
  return w;
}

/** พิมพ์สรุปยอดประจำวัน (กระดาษม้วน 58/80 มม.) — ยอดขาย ช่องทางชำระ เงินในลิ้นชักของกะ ค่าใช้จ่าย สินค้าขายดี */
export function printDaySummary(d: import('./api').DaySummary, closed?: import('./types').Shift | null, win?: Window | null) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const pw = paperWidth();
  const { receipt: r, shop } = getAppSettings();
  const row = (l: string, v: string, cls = '') => `<tr class="${cls}"><td>${esc(l)}</td><td class="r">${v}</td></tr>`;
  const PAY: Record<string, string> = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', card: 'บัตร', transfer: 'โอน' };
  const payName = (m: string) => getAppSettings().payments.methods.find((x) => x.id === m)?.label ?? PAY[m] ?? m;
  const dateLabel = new Date(`${d.date}T12:00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const now = new Date().toLocaleString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const verdict = (x: number | null) => (x == null ? '-' : x === 0 ? 'ตรง' : x > 0 ? `เกิน ${m(x)}` : `ขาด ${m(-x)}`);
  const shiftRows = d.shifts
    .map((s) => {
      const c = closed && closed.id === s.id ? closed : null;
      const expected = c?.expectedCash ?? s.expectedCash;
      const counted = c?.countedCash ?? s.countedCash;
      const diff = c?.diff ?? s.diff;
      return `
      <div class="b" style="margin-top:4px">กะ #${s.shiftNo} · ${esc(s.openedAt.slice(11, 16))}–${esc((c?.closedAt ?? s.closedAt ?? '').slice(11, 16) || 'ยังเปิด')}</div>
      <table>
        ${row('เปิดโดย', esc(s.openedBy.replace('พนักงาน: ', '')))}
        ${s.closedBy || c ? row('ปิดโดย', esc((c?.closedBy ?? s.closedBy ?? '').replace('พนักงาน: ', ''))) : ''}
        ${row('เงินตั้งต้น', m(s.openingCash))}
        ${expected != null ? row('ควรมีในลิ้นชัก', m(expected)) : ''}
        ${counted != null ? row('นับได้จริง', m(counted), 'b') : ''}
        ${counted != null ? row('ผลการนับ', verdict(diff), diff ? 'b' : '') : ''}
      </table>`;
    })
    .join('');
  const html = `
  <h1>${esc(r.shopName?.trim() || shop.name)}</h1>
  ${d.shop.branchName ? `<div class="c">${esc(d.shop.branchName)}${d.shop.branchCode ? ` (${esc(d.shop.branchCode)})` : ''}</div>` : ''}
  <div class="c b" style="margin-top:4px">สรุปยอดขายประจำวัน</div>
  <div class="c">${esc(dateLabel)}</div><hr>
  <table>
    ${row(`ยอดขายสุทธิ (${d.sales.bills} บิล)`, m(d.sales.total), 't')}
    ${row('จำนวนชิ้นที่ขาย', `${d.sales.units.toLocaleString()} ชิ้น`)}
    ${row('เฉลี่ยต่อบิล', m(d.sales.aov))}
    ${d.sales.discount ? row('ส่วนลด', '-' + m(d.sales.discount)) : ''}
    ${d.sales.vat ? row('VAT (รวมในยอด)', m(d.sales.vat)) : ''}
    ${d.voids.count ? row(`ยกเลิกบิล ${d.voids.count} บิล`, m(d.voids.amount)) : ''}
    ${d.edits.count ? row(`แก้ไขบิล ${d.edits.count} ครั้ง · คืนเงิน`, m(d.edits.refunded)) : ''}
  </table><hr>
  <div class="b">รับเงินแยกตามช่องทาง</div>
  <table>${d.byMethod.length ? d.byMethod.map((x) => row(payName(x.method), m(x.amount))).join('') : row('ไม่มีรายการ', '-')}</table><hr>
  <div class="b">เงินสดในลิ้นชัก</div>
  ${shiftRows || '<div>ไม่มีกะ</div>'}<hr>
  <div class="b">ค่าใช้จ่ายร้าน</div>
  <table>
    ${row(`รวม ${d.expenses.count} รายการ`, m(d.expenses.total))}
    ${d.expenses.drawer ? row('  จ่ายจากลิ้นชัก', m(d.expenses.drawer)) : ''}
    ${d.expenses.top.slice(0, 3).map((x) => row('  ' + x.name, m(x.total))).join('')}
  </table><hr>
  ${d.top.length ? `<div class="b">สินค้าขายดี</div><table>${d.top.map((x, i) => row(`${i + 1}. ${x.name}`, `${x.qty} ชิ้น`)).join('')}</table><hr>` : ''}
  <div class="c"><small>พิมพ์เมื่อ ${esc(now)}</small></div>
  <br><div class="c">ลงชื่อ ____________________</div>`;
  const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>สรุปยอด ${esc(d.date)}</title>
<style>
  ${rollPage(pw)}
  body { font-family: 'IBM Plex Sans Thai', system-ui, sans-serif; font-size: 12px; width: ${bodyWidth(pw)}mm; margin: 0 auto; color:#000 }
  h1 { font-size: 16px; text-align: center; margin: 4px 0 } .c { text-align: center } .b { font-weight: 700 }
  .r { text-align: right; white-space: nowrap; vertical-align: top } table { width: 100%; border-collapse: collapse } td { padding: 2px 0 }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 } .t td { font-weight: 700; font-size: 15px } small { color: #444 }
</style></head><body>${html}
</body></html>`;
  output(doc, 'width=380,height=720', 'day', win);
}

/** บาร์โค้ด Code128 ขนาดกำหนดเอง (ใบส่งของ: เล็ก ไม่เต็มหัวกระดาษ) */
function barcodeFixed(text: string, width: number, height: number) {
  const w = code128(text);
  if (!w) return '';
  let x = 0;
  const bars: string[] = [];
  w.forEach((n, i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${n}" height="40"/>`);
    x += n;
  });
  return `<svg viewBox="0 0 ${x} 40" preserveAspectRatio="none" width="${width}" height="${height}" style="display:block;margin-left:auto">${bars.join('')}</svg>`;
}

/**
 * ใบส่งสินค้า / ใบกำกับตรวจนับ (A4) — หน้าตัวอย่างก่อนพิมพ์ + ปุ่มพิมพ์
 * หัวเอกสาร · บาร์โค้ดเลขที่เอกสาร · กล่องต้นทาง/ปลายทาง · หมายเหตุ · ตารางสินค้า (ส่งออก / หน้าร้านนับได้ / ผลตรวจ) · ลายเซ็น
 */
export function printShipment(d: import('./api').ShipmentDetail, shopName = getAppSettings().shop.name) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const w = window.open('', '_blank', 'width=980,height=940');
  if (!w) return;
  const s = d.shipment;
  const units = d.items.reduce((a, i) => a + i.qty, 0);
  const statusText = s.status === 'shipped' ? 'ส่งออกจากโรงงานแล้ว' : s.heldAt ? 'พักไว้ (ยังไม่ส่ง)' : 'กำลังจัดเตรียม (ยังไม่ส่ง)';
  const statusColor = s.status === 'shipped' ? '#14935f' : '#b26a00';
  const date = (s.shippedAt ?? s.createdAt) || '';
  const color = (i: { color: string; extra: string }) => [i.color, i.extra].filter((x) => x && x !== '-').join(' · ') || '-';
  const rows = d.items
    .map((i, n) => `<tr>
      <td class="c n">${n + 1}</td>
      <td><div class="pn">${esc(i.name)}</div><div class="code">${i.barcode && i.barcode !== i.sku ? `CODE : ${esc(i.barcode)} <span class="sep">|</span> ` : ''}SKU : ${esc(i.sku)}</div></td>
      <td class="c">${esc(color(i))}</td>
      <td class="c b">${esc(i.size && i.size !== '-' ? i.size : '-')}</td>
      <td class="c qty">${i.qty.toLocaleString()}</td>
      <td class="c"><span class="box"></span></td>
      <td class="c"><span class="chk"></span></td>
    </tr>`)
    .join('');

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.docNo)}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'IBM Plex Sans Thai', 'Noto Sans Thai', system-ui, sans-serif; color: #111827; background: #e5e7eb; font-size: 12.5px; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: #1e293b; color: #fff; }
  .bar h2 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
  .bar button { font: inherit; font-weight: 700; border: 0; border-radius: 10px; padding: 10px 18px; cursor: pointer; }
  .bar .print { background: #109e5e; color: #fff; } .bar .close { background: #334155; color: #fff; font-weight: 500; }
  .paper { width: 210mm; min-height: 297mm; margin: 18px auto; background: #fff; padding: 14mm 14mm 16mm; box-shadow: 0 6px 24px rgba(0,0,0,.12); }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 14px; border-bottom: 2.5px solid #111827; }
  .badge { display: inline-block; background: #111827; color: #fff; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 4px; letter-spacing: .2px; }
  h1 { font-size: 24px; margin: 10px 0 4px; font-weight: 700; }
  .muted { color: #6b7280; font-size: 11.5px; }
  .doc { text-align: right; min-width: 210px; }
  .doc .bc-text { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; letter-spacing: 1px; margin-top: 3px; }
  .doc .no { margin-top: 6px; font-size: 12px; color: #4b5563; } .doc .no b { font-family: ui-monospace, Menlo, Consolas, monospace; color: #111827; font-size: 13px; }
  .info { display: flex; justify-content: space-between; gap: 16px; margin-top: 18px; padding: 14px 16px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; line-height: 1.9; }
  .info .r { text-align: right; } .info b { font-weight: 700; } .info .big { font-size: 14px; }
  .lab { color: #6b7280; } .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .note { margin-top: 14px; padding: 10px 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; color: #92400e; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { background: #f1f5f9; color: #334155; font-weight: 700; font-size: 12px; padding: 10px 8px; border: 1px solid #e2e8f0; }
  td { padding: 9px 8px; border: 1px solid #e2e8f0; vertical-align: middle; }
  .c { text-align: center; } .b { font-weight: 700; } .n { color: #64748b; }
  th.qcol, td.qty { background: #f1f5f9; } td.qty { font-weight: 700; font-size: 14px; }
  .pn { font-weight: 600; } .code .sep { color: #cbd5e1; margin: 0 4px; } .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10.5px; color: #475569; font-weight: 600; margin-top: 2px; }
  .box { display: inline-block; width: 64px; height: 24px; border: 1.5px dashed #94a3b8; border-radius: 4px; }
  .chk { display: inline-block; width: 16px; height: 16px; border: 1.5px solid #94a3b8; border-radius: 4px; }
  tfoot td { font-weight: 700; background: #f8fafc; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 46px; text-align: center; font-size: 12px; }
  .sign .line { border-top: 1px solid #111827; padding-top: 6px; margin-top: 44px; }
  .sign .d { color: #6b7280; font-size: 11px; margin-top: 2px; }
  tr { page-break-inside: avoid; } thead { display: table-header-group; }
  @media print {
    body { background: #fff; } .bar { display: none; }
    html, body { width: 210mm; }
    /* ระยะขอบกระดาษอยู่ที่ .paper เอง — ได้ขอบเท่าเดิมไม่ว่าตั้ง Margins ใน Chrome เป็นแบบไหน */
    .paper { width: 210mm; min-height: 0; margin: 0; padding: 14mm 15mm 16mm; box-shadow: none;
      -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .info, th, td.qty, th.qcol, .note, tfoot td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
  <div class="bar">
    <h2>← ตัวอย่างก่อนพิมพ์ใบส่งของ (Delivery Slip / Packing List)</h2>
    <button class="print" onclick="window.print()">🖨 พิมพ์ใบส่งสินค้า</button>
    <button class="close" onclick="window.close()">ปิด</button>
  </div>
  <div class="paper">
    <div class="top">
      <div>
        <span class="badge">ใบส่งสินค้า / ใบกำกับตรวจนับ (GARMENT DELIVERY MANIFEST)</span>
        <h1>${esc(shopName || 'โรงงานตัดเย็บเสื้อผ้าสำเร็จรูป')}</h1>
        <div class="muted">ระบบจัดการจัดส่งและตรวจนับสต็อกแบบบาร์โค้ดดิจิทัล</div>
      </div>
      <div class="doc">
        ${barcodeFixed(s.docNo, 190, 42)}
        <div class="bc-text">${esc(s.docNo)}</div>
        <div class="no">เลขที่เอกสาร: <b>${esc(s.docNo)}</b></div>
      </div>
    </div>

    <div class="info">
      <div>
        <div><span class="lab">🏭 ต้นทาง:</span> <b>${esc(s.sourceBranchName ? `${s.sourceBranchName} (ตัดสต็อก)` : 'โรงงาน (ไม่ตัดสต็อกสาขา)')}</b></div>
        <div><span class="lab">🏬 ปลายทาง:</span> <b class="big">${esc(s.destBranchName ?? '-')}</b></div>
        <div><span class="lab">ผู้จัดส่ง / สแกนออก:</span> ${esc(s.shippedBy ?? s.createdBy ?? '-')}</div>
      </div>
      <div class="r">
        <div><span class="lab">วันที่ส่งของ:</span> <span class="mono">${esc(date)}</span></div>
        <div><span class="lab">จำนวนบรรจุภัณฑ์:</span> <b>${s.bags} ถุง/กล่อง</b></div>
        <div><span class="lab">สถานะเอกสาร:</span> <b style="color:${statusColor}">${statusText}</b></div>
      </div>
    </div>

    ${s.note ? `<div class="note"><b>หมายเหตุจากโรงงาน:</b> ${esc(s.note)}</div>` : ''}

    <table>
      <thead><tr>
        <th style="width:48px">ลำดับ</th><th style="text-align:left">รายการสินค้า / บาร์โค้ด</th><th style="width:90px">สี</th><th style="width:60px">ไซส์</th>
        <th class="qcol" style="width:82px">ส่งออก (ตัว)</th><th style="width:96px">หน้าร้าน<br>นับได้</th><th style="width:66px;white-space:nowrap">ผลตรวจ</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right">รวมทั้งหมด ${d.items.length} รายการ</td><td class="c qty">${units.toLocaleString()}</td><td></td><td></td></tr></tfoot>
    </table>

    <div class="sign">
      <div><div class="line">ผู้จัดของ / สแกนออก (โรงงาน)</div><div class="d">วันที่ ____/____/______</div></div>
      <div><div class="line">ผู้ขนส่ง</div><div class="d">วันที่ ____/____/______</div></div>
      <div><div class="line">ผู้ตรวจรับ (${esc(s.destBranchName ?? 'สาขา')})</div><div class="d">วันที่ ____/____/______</div></div>
    </div>
  </div>
</body></html>`);
  w.document.close();
}
