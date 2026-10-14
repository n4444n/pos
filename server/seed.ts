// ข้อมูลตัวอย่างสำหรับร้านเสื้อผ้า (สร้างครั้งแรกที่ฐานข้อมูลว่าง)
import type { DatabaseSync } from 'node:sqlite';

type Color = [name: string, hex: string];

const C: Record<string, Color> = {
  white: ['ขาว', '#F4F4F2'],
  black: ['ดำ', '#232326'],
  navy: ['กรมท่า', '#24345C'],
  grey: ['เทา', '#9AA0A8'],
  beige: ['เบจ', '#D9C6A5'],
  olive: ['เขียวขี้ม้า', '#6B7444'],
  sky: ['ฟ้า', '#9CC3E6'],
  pink: ['ชมพู', '#EBB3C2'],
  red: ['แดง', '#C8443E'],
  denim: ['ยีนส์', '#4F6D96'],
  brown: ['น้ำตาล', '#8A5A3B'],
  cream: ['ครีม', '#EFE6D2'],
  sage: ['เขียวเสจ', '#A9B99C'],
  mustard: ['มัสตาร์ด', '#D5A23B'],
};

const TOP = ['S', 'M', 'L', 'XL'];
const BOTTOM = ['28', '30', '32', '34'];
const FREE = ['FREE'];

interface P {
  sku: string;
  name: string;
  cat: string;
  art: string;
  price: number;
  sizes: string[];
  colors: (keyof typeof C)[];
}

const products: P[] = [
  // เสื้อยืด
  { sku: 'TS-001', name: 'เสื้อยืดคอกลม Cotton 100%', cat: 'tshirt', art: 'tshirt', price: 290, sizes: TOP, colors: ['white', 'black', 'navy'] },
  { sku: 'TS-002', name: 'เสื้อยืด Oversize', cat: 'tshirt', art: 'tshirt', price: 350, sizes: TOP, colors: ['grey', 'cream', 'black'] },
  { sku: 'TS-003', name: 'เสื้อโปโล Piqué', cat: 'tshirt', art: 'polo', price: 490, sizes: TOP, colors: ['navy', 'white', 'sage'] },
  { sku: 'TS-004', name: 'เสื้อยืดลายทาง Breton', cat: 'tshirt', art: 'tshirt', price: 390, sizes: TOP, colors: ['white', 'navy'] },
  { sku: 'TS-005', name: 'เสื้อกล้าม Ribbed', cat: 'tshirt', art: 'tank', price: 199, sizes: TOP, colors: ['white', 'black', 'beige'] },
  { sku: 'TS-006', name: 'เสื้อยืดแขนยาว Henley', cat: 'tshirt', art: 'longsleeve', price: 450, sizes: TOP, colors: ['olive', 'cream'] },
  // เสื้อเชิ้ต
  { sku: 'SH-001', name: 'เชิ้ต Oxford แขนยาว', cat: 'shirt', art: 'shirt', price: 790, sizes: TOP, colors: ['sky', 'white'] },
  { sku: 'SH-002', name: 'เชิ้ตลินินแขนสั้น', cat: 'shirt', art: 'shirt', price: 690, sizes: TOP, colors: ['beige', 'white', 'sage'] },
  { sku: 'SH-003', name: 'เชิ้ตเดนิม', cat: 'shirt', art: 'shirt', price: 890, sizes: TOP, colors: ['denim'] },
  { sku: 'SH-004', name: 'เชิ้ตลายสก็อต Flannel', cat: 'shirt', art: 'shirt', price: 750, sizes: TOP, colors: ['red', 'olive'] },
  { sku: 'SH-005', name: 'เบลาส์ผ้าซาติน', cat: 'shirt', art: 'blouse', price: 650, sizes: TOP, colors: ['cream', 'pink', 'black'] },
  // กางเกง
  { sku: 'PT-001', name: 'ยีนส์ทรงกระบอกเล็ก', cat: 'pants', art: 'pants', price: 1290, sizes: BOTTOM, colors: ['denim', 'black'] },
  { sku: 'PT-002', name: 'กางเกงชิโน่', cat: 'pants', art: 'pants', price: 890, sizes: BOTTOM, colors: ['beige', 'navy', 'olive'] },
  { sku: 'PT-003', name: 'กางเกงขากว้าง Wide Leg', cat: 'pants', art: 'pants', price: 990, sizes: BOTTOM, colors: ['cream', 'black'] },
  { sku: 'PT-004', name: 'กางเกงขาสั้น Cargo', cat: 'pants', art: 'shorts', price: 590, sizes: BOTTOM, colors: ['olive', 'beige'] },
  { sku: 'PT-005', name: 'กางเกงวอร์ม Jogger', cat: 'pants', art: 'pants', price: 690, sizes: TOP, colors: ['grey', 'black'] },
  { sku: 'PT-006', name: 'ยีนส์ขาสั้น', cat: 'pants', art: 'shorts', price: 650, sizes: BOTTOM, colors: ['denim'] },
  // เดรส & กระโปรง
  { sku: 'DR-001', name: 'เดรสลายดอกไม้', cat: 'dress', art: 'dress', price: 1190, sizes: TOP, colors: ['pink', 'sky'] },
  { sku: 'DR-002', name: 'เดรสเชิ้ตผ้าลินิน', cat: 'dress', art: 'dress', price: 1290, sizes: TOP, colors: ['beige', 'white'] },
  { sku: 'DR-003', name: 'สลิปเดรสซาติน', cat: 'dress', art: 'slipdress', price: 990, sizes: TOP, colors: ['black', 'mustard'] },
  { sku: 'DR-004', name: 'กระโปรงพลีท', cat: 'dress', art: 'skirt', price: 790, sizes: TOP, colors: ['grey', 'navy', 'cream'] },
  { sku: 'DR-005', name: 'กระโปรงยีนส์', cat: 'dress', art: 'skirt', price: 690, sizes: TOP, colors: ['denim'] },
  // แจ็คเก็ต & ฮู้ด
  { sku: 'OW-001', name: 'ฮู้ดดี้ Fleece', cat: 'outer', art: 'hoodie', price: 990, sizes: TOP, colors: ['grey', 'black', 'sage'] },
  { sku: 'OW-002', name: 'แจ็คเก็ตยีนส์', cat: 'outer', art: 'jacket', price: 1590, sizes: TOP, colors: ['denim'] },
  { sku: 'OW-003', name: 'เสื้อสเวตเตอร์ไหมพรม', cat: 'outer', art: 'sweater', price: 1090, sizes: TOP, colors: ['cream', 'brown', 'navy'] },
  { sku: 'OW-004', name: 'แจ็คเก็ตบอมเบอร์', cat: 'outer', art: 'jacket', price: 1490, sizes: TOP, colors: ['olive', 'black'] },
  { sku: 'OW-005', name: 'คาร์ดิแกนถัก', cat: 'outer', art: 'sweater', price: 890, sizes: TOP, colors: ['beige', 'pink'] },
  // แอคเซสซอรี่
  { sku: 'AC-001', name: 'กระเป๋าผ้า Tote', cat: 'acc', art: 'bag', price: 290, sizes: FREE, colors: ['cream', 'black'] },
  { sku: 'AC-002', name: 'หมวกแก๊ป', cat: 'acc', art: 'cap', price: 350, sizes: FREE, colors: ['black', 'beige', 'navy'] },
  { sku: 'AC-003', name: 'ถุงเท้าข้อกลาง (3 คู่)', cat: 'acc', art: 'socks', price: 199, sizes: FREE, colors: ['white', 'black'] },
  { sku: 'AC-004', name: 'เข็มขัดหนัง', cat: 'acc', art: 'belt', price: 590, sizes: ['90', '100', '110'], colors: ['brown', 'black'] },
  { sku: 'AC-005', name: 'ผ้าพันคอ', cat: 'acc', art: 'scarf', price: 450, sizes: FREE, colors: ['mustard', 'grey'] },
];

export function seed(db: DatabaseSync) {
  const insCat = db.prepare('INSERT INTO categories (id, name, name_en, icon, sort) VALUES (?, ?, ?, ?, ?)');
  const insProd = db.prepare('INSERT INTO products (sku, name, category_id, price, art, tint) VALUES (?, ?, ?, ?, ?, ?)');
  const insVar = db.prepare(
    'INSERT INTO variants (product_id, sku, size, color, color_hex, stock) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insStaff = db.prepare('INSERT INTO staff (name) VALUES (?)');
  const insPromo = db.prepare(
    'INSERT INTO promos (code, label, type, value, min_total) VALUES (?, ?, ?, ?, ?)',
  );

  db.exec('BEGIN');
  try {
    [
      ['tshirt', 'เสื้อยืด & โปโล', 'T-Shirts', 'tshirt', 1],
      ['shirt', 'เสื้อเชิ้ต', 'Shirts', 'shirt', 2],
      ['pants', 'กางเกง', 'Pants', 'pants', 3],
      ['dress', 'เดรส & กระโปรง', 'Dresses', 'dress', 4],
      ['outer', 'แจ็คเก็ต & ฮู้ด', 'Outerwear', 'hoodie', 5],
      ['acc', 'แอคเซสซอรี่', 'Accessories', 'bag', 6],
    ].forEach((c) => insCat.run(...(c as [string, string, string, string, number])));

    let n = 7;
    for (const p of products) {
      const main = C[p.colors[0]];
      const { lastInsertRowid } = insProd.run(p.sku, p.name, p.cat, p.price, p.art, main[1]);
      for (const ck of p.colors) {
        const [cname, hex] = C[ck];
        for (const size of p.sizes) {
          n = (n * 37 + 11) % 97; // ตัวเลขสุ่มแบบคงที่ เพื่อให้ข้อมูลเหมือนเดิมทุกครั้ง
          const stock = n % 9 === 0 ? 0 : (n % 18) + 1;
          insVar.run(Number(lastInsertRowid), `${p.sku}-${ck.toUpperCase()}-${size}`, size, cname, hex, stock);
        }
      }
    }

    ['มายด์', 'เจมส์', 'ฟ้า'].forEach((s) => insStaff.run(s)); // PIN ตั้งให้อัตโนมัติใน auth.ts

    insPromo.run('WELCOME10', 'ลด 10% ลูกค้าใหม่', 'percent', 10, 0);
    insPromo.run('SALE100', 'ลด 100 บาท เมื่อซื้อครบ 1,000', 'amount', 100, 1000);
    insPromo.run('MEMBER5', 'สมาชิกลด 5%', 'percent', 5, 0);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
