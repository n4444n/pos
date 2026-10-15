#!/usr/bin/env node
// ตัวจำลองเครื่องพิมพ์ใบเสร็จ (ESC/POS) — ทดสอบการพิมพ์โดยไม่ต้องมีเครื่องพิมพ์จริง
//
//   npm run printer:emulator              รับงานพิมพ์ที่ 127.0.0.1:9100 · ดูผลที่ http://localhost:9101
//   npm run printer:emulator -- --port 9200 --view 9201
//   node desktop/tools/printer-emulator.cjs --file job.bin   แปลงไฟล์งานพิมพ์ (เช่น จากพอร์ต FILE: ของ Windows) เป็นรูป
//
// ในแอป: ระบบ → ตั้งค่าเครื่องนี้ → ESC/POS · LAN/WiFi · IP 127.0.0.1 พอร์ต 9100
// ผลลัพธ์: รูปใบเสร็จ (PNG) ใน printer-output/ — เส้นประสีแดง = ตำแหน่งตัดกระดาษ · ป้ายบนสุดบอกขนาดกระดาษ/การเปิดลิ้นชัก
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const PORT = Number(arg('port', 9100));
const VIEW_PORT = Number(arg('view', 9101));
const OUT_DIR = path.resolve(arg('out', 'printer-output'));
const FILE = arg('file', null);
fs.mkdirSync(OUT_DIR, { recursive: true });

// ------------------------------------------------------------------ แปลงคำสั่ง ESC/POS
/** อ่านสตรีม ESC/POS → { width, rows: Uint8Array[] (1 ไบต์/จุด: 1 = ดำ, 2 = เส้นตัด), cuts, drawer, warnings } */
function decode(buf) {
  const rows = [];
  let width = 0;
  let cuts = 0;
  const drawer = [];
  const warnings = [];
  const text = [];
  const blank = (n) => {
    for (let k = 0; k < n; k++) rows.push(null); // null = แถวขาว (รู้ความกว้างทีหลัง)
  };
  let i = 0;
  const need = (n) => {
    if (i + n > buf.length) throw new Error(`ข้อมูลขาด ที่ไบต์ ${i}`);
  };
  while (i < buf.length) {
    const b = buf[i];
    if (b === 0x1b) {
      need(2);
      const c = buf[i + 1];
      if (c === 0x40) i += 2; // ESC @
      else if (c === 0x4a) { need(3); blank(buf[i + 2]); i += 3; } // ESC J n (dots)
      else if (c === 0x64) { need(3); blank(buf[i + 2] * 30); i += 3; } // ESC d n (lines)
      else if (c === 0x70) { need(5); drawer.push(buf[i + 2] & 1 ? 'ขา 5' : 'ขา 2'); i += 5; } // ESC p m t1 t2
      else if (c === 0x61 || c === 0x45 || c === 0x2d || c === 0x4d || c === 0x74 || c === 0x52 || c === 0x21 || c === 0x33) i += 3; // คำสั่ง 1 พารามิเตอร์ที่พบบ่อย
      else { warnings.push(`ไม่รู้จัก ESC 0x${c.toString(16)}`); i += 2; }
    } else if (b === 0x1d) {
      need(2);
      const c = buf[i + 1];
      if (c === 0x76 && buf[i + 2] === 0x30) { // GS v 0 m xL xH yL yH d...
        need(8);
        const wb = buf[i + 4] | (buf[i + 5] << 8);
        const h = buf[i + 6] | (buf[i + 7] << 8);
        need(8 + wb * h);
        if (width && width !== wb * 8) warnings.push(`ความกว้างภาพเปลี่ยน ${width} → ${wb * 8} จุด`);
        width = Math.max(width, wb * 8);
        for (let y = 0; y < h; y++) {
          const r = new Uint8Array(wb * 8);
          for (let x = 0; x < wb * 8; x++) if (buf[i + 8 + y * wb + (x >> 3)] & (0x80 >> (x & 7))) r[x] = 1;
          rows.push(r);
        }
        i += 8 + wb * h;
      } else if (c === 0x56) { // GS V m [n]
        need(3);
        const m = buf[i + 2];
        i += m === 65 || m === 66 ? 4 : 3;
        cuts++;
        rows.push('cut');
      } else if (c === 0x21 || c === 0x42 || c === 0x68 || c === 0x77 || c === 0x48 || c === 0x66) i += 3;
      else { warnings.push(`ไม่รู้จัก GS 0x${c.toString(16)}`); i += 2; }
    } else if (b === 0x0a) { blank(30); i++; } // LF
    else if (b === 0x10 || b === 0x0c || b === 0x0d || b === 0x00) i++;
    else { text.push(b); i++; } // ข้อความดิบ (โหมดตัวอักษร) — ตัวจำลองนี้แสดงเฉพาะภาพ
  }
  if (text.length) warnings.push(`มีข้อความแบบตัวอักษร ${text.length} ไบต์ (ไม่แสดงในรูป)`);
  return { width: width || 384, rows, cuts, drawer, warnings };
}

// ------------------------------------------------------------------ PNG (ไม่ต้องติดตั้งไลบรารี)
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(width, height, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** วาดใบเสร็จ: พื้นกระดาษ + ขอบเทาสองข้าง (ขอบกระดาษที่พิมพ์ไม่ถึง) + เส้นตัดสีแดง */
function render(job) {
  const W = job.width;
  const side = 12; // ขอบกระดาษ (จุด) แสดงเป็นสีเทา
  const width = W + side * 2;
  const rows = job.rows.length ? job.rows : [null];
  const height = rows.length + 20;
  const rgb = Buffer.alloc(width * height * 3, 0xff);
  const set = (x, y, r, g, b) => {
    const k = (y * width + x) * 3;
    rgb[k] = r;
    rgb[k + 1] = g;
    rgb[k + 2] = b;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < side; x++) { set(x, y, 236, 236, 232); set(width - 1 - x, y, 236, 236, 232); }
  rows.forEach((r, y) => {
    y += 10;
    if (r === 'cut') { for (let x = 0; x < width; x++) if ((x >> 3) % 2 === 0) set(x, y, 220, 30, 30); return; }
    if (!r) return;
    for (let x = 0; x < r.length && x < W; x++) if (r[x]) set(side + x, y, 0, 0, 0);
  });
  return png(width, height, rgb);
}

// ------------------------------------------------------------------ บันทึกผล
const jobs = [];
let seq = 0;
function save(buf, source) {
  let job;
  try {
    job = decode(buf);
  } catch (e) {
    console.log(`  ✗ แปลงงานพิมพ์ไม่ได้: ${e.message}`);
    return;
  }
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const name = `${stamp}-${String(++seq).padStart(3, '0')}.png`;
  fs.writeFileSync(path.join(OUT_DIR, name), render(job));
  const paper = job.width <= 384 ? '58 มม.' : job.width <= 576 ? '80 มม.' : `${job.width} จุด`;
  const lines = job.rows.filter((r) => r !== 'cut').length;
  const info = {
    name,
    source,
    time: new Date().toLocaleString('th-TH'),
    bytes: buf.length,
    width: job.width,
    paper,
    lengthMm: Math.round(lines / 8),
    cuts: job.cuts,
    drawer: job.drawer,
    warnings: job.warnings,
  };
  jobs.unshift(info);
  jobs.length = Math.min(jobs.length, 50);
  console.log(
    `  ✓ ${name} · กว้าง ${job.width} จุด (${paper}) · ยาว ${info.lengthMm} มม. · ตัดกระดาษ ${job.cuts} ครั้ง · ลิ้นชัก ${job.drawer.length ? `เปิด (${job.drawer.join(', ')})` : '-'}` +
      (job.warnings.length ? `\n    ⚠ ${job.warnings.join(' · ')}` : ''),
  );
  return info;
}

if (FILE) {
  console.log(`แปลงไฟล์ ${FILE}`);
  save(fs.readFileSync(FILE), FILE);
  console.log(`ผลลัพธ์อยู่ที่ ${OUT_DIR}`);
  process.exit(0);
}

// ------------------------------------------------------------------ เครื่องพิมพ์จำลอง (TCP 9100)
net
  .createServer((sock) => {
    const parts = [];
    const from = `${sock.remoteAddress}:${sock.remotePort}`;
    sock.on('data', (d) => parts.push(d));
    sock.on('error', () => {});
    sock.on('close', () => {
      const buf = Buffer.concat(parts);
      if (!buf.length) return;
      console.log(`รับงานพิมพ์ ${buf.length.toLocaleString()} ไบต์ จาก ${from}`);
      save(buf, from);
    });
  })
  .listen(PORT, '0.0.0.0', () => console.log(`เครื่องพิมพ์จำลองพร้อม → พอร์ต ${PORT}`));

// ------------------------------------------------------------------ หน้าดูผล
http
  .createServer((req, res) => {
    const u = decodeURIComponent((req.url || '/').split('?')[0]);
    if (u === '/jobs.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(jobs));
    }
    if (/^\/out\/[\w-]+\.png$/.test(u)) {
      const f = path.join(OUT_DIR, path.basename(u));
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(fs.readFileSync(f));
      }
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>เครื่องพิมพ์จำลอง</title>
<style>body{margin:0;font-family:'Segoe UI',Tahoma,sans-serif;background:#2b2f36;color:#e7e9ee}
header{padding:14px 20px;background:#1e2127;display:flex;gap:16px;align-items:baseline}h1{font-size:17px;margin:0}header span{color:#9aa1ad;font-size:13px}
main{display:flex;gap:24px;padding:20px;overflow-x:auto;align-items:flex-start}
.job{flex:none}.job img{display:block;box-shadow:0 6px 20px rgba(0,0,0,.5)}
.meta{font-size:12px;color:#c3c8d2;margin:0 0 8px;line-height:1.6;max-width:${600}px}.b{display:inline-block;padding:1px 8px;border-radius:9px;background:#3b4250;margin-right:4px}
.d{background:#1f9d63;color:#fff}.w{color:#ffcf5c}.empty{padding:40px;color:#9aa1ad}</style></head>
<body><header><h1>🖨 เครื่องพิมพ์จำลอง ESC/POS</h1><span>รับงานที่พอร์ต ${PORT} · ภาพใหม่อยู่ซ้ายสุด · เส้นประแดง = ตัดกระดาษ</span></header>
<main id="m"><div class="empty">ยังไม่มีงานพิมพ์ — ตั้งค่าในแอป: ESC/POS · LAN/WiFi · IP 127.0.0.1 · พอร์ต ${PORT} แล้วกดพิมพ์ทดสอบ</div></main>
<script>
let last='';
async function load(){const j=await (await fetch('/jobs.json')).json();const k=JSON.stringify(j.map(x=>x.name));if(k===last)return;last=k;
if(!j.length)return;document.getElementById('m').innerHTML=j.map(x=>'<div class="job"><p class="meta"><span class="b">'+x.paper+' · '+x.width+' จุด</span><span class="b">ยาว '+x.lengthMm+' มม.</span><span class="b">ตัด '+x.cuts+'</span>'+(x.drawer.length?'<span class="b d">เปิดลิ้นชัก</span>':'')+'<br>'+x.time+(x.warnings.length?'<br><span class="w">⚠ '+x.warnings.join(' · ')+'</span>':'')+'</p><img src="/out/'+x.name+'"></div>').join('');}
load();setInterval(load,1000);
</script></body></html>`);
  })
  .listen(VIEW_PORT, '127.0.0.1', () => console.log(`ดูผลการพิมพ์ → http://localhost:${VIEW_PORT}\nบันทึกรูปที่ ${OUT_DIR}\n`));
