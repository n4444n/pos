// พร้อมเพย์ QR (มาตรฐาน EMVCo / Thai QR Payment) — ล็อคยอดเงินในตัว QR
// ลูกค้าสแกนแล้วแอปธนาคารจะกรอกยอดให้อัตโนมัติ แก้ยอดไม่ได้

export type PromptPayKind = 'mobile' | 'nid' | 'ewallet';

/** ประเภทหมายเลขพร้อมเพย์จากจำนวนหลัก (null = ใช้ไม่ได้) */
export function promptPayKind(id: string): PromptPayKind | null {
  const d = id.replace(/[^0-9]/g, '');
  if (d.length === 10 && d.startsWith('0')) return 'mobile';
  if (d.length === 13) return 'nid';
  if (d.length === 15) return 'ewallet';
  return null;
}

export const PROMPTPAY_KIND_LABEL: Record<PromptPayKind, string> = {
  mobile: 'เบอร์มือถือ',
  nid: 'เลขบัตรประชาชน / เลขผู้เสียภาษี',
  ewallet: 'e-Wallet ID',
};

/** ซ่อนบางหลัก เช่น 081-xxx-5678 */
export function maskPromptPay(id: string): string {
  const d = id.replace(/[^0-9]/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-xxx-${d.slice(6)}`;
  if (d.length === 13) return `${d[0]}-xxxx-xxxxx-${d.slice(10, 12)}-${d[12]}`;
  if (d.length >= 6) return `${d.slice(0, 3)}${'x'.repeat(d.length - 7)}${d.slice(-4)}`;
  return d;
}

const tlv = (tag: string, value: string) => tag + String(value.length).padStart(2, '0') + value;

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) ตามที่ EMVCo กำหนด */
function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * สร้างข้อความสำหรับ QR พร้อมเพย์
 * @param id หมายเลขพร้อมเพย์ (เบอร์ 10 หลัก / เลข 13 หลัก / e-Wallet 15 หลัก)
 * @param amount ยอดเงิน — ใส่ > 0 = ล็อคยอด (QR แบบใช้ครั้งเดียว) · ไม่ใส่ = ลูกค้ากรอกยอดเอง
 */
export function promptPayPayload(id: string, amount?: number): string | null {
  const d = id.replace(/[^0-9]/g, '');
  const kind = promptPayKind(d);
  if (!kind) return null;
  const target = kind === 'mobile' ? tlv('01', '0066' + d.slice(1)) : kind === 'nid' ? tlv('02', d) : tlv('03', d);
  const locked = amount != null && Number.isFinite(amount) && amount > 0;
  const body =
    tlv('00', '01') +
    tlv('01', locked ? '12' : '11') +
    tlv('29', tlv('00', 'A000000677010111') + target) +
    tlv('53', '764') +
    (locked ? tlv('54', (Math.round(amount! * 100) / 100).toFixed(2)) : '') +
    tlv('58', 'TH');
  const head = body + '6304';
  return head + crc16(head);
}
