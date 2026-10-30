# โครงสร้างระบบ Clothing POS (สำหรับนักพัฒนา)

อ่านไฟล์นี้ก่อนแก้โค้ด — บอกว่าแต่ละส่วนอยู่ไฟล์ไหน ทำงานอย่างไร และมีกติกาอะไรที่ต้องรักษาไว้
ทุกไฟล์มีคำอธิบาย 1–3 บรรทัดที่หัวไฟล์ · คอมเมนต์ในโค้ดเป็นภาษาไทย

## ภาพรวม

```
แอป .exe (Electron)  ──►  เซิร์ฟเวอร์ POS (Node.js + SQLite)  ◄──  เบราว์เซอร์ (เฉพาะตอนพัฒนา)
  desktop/                server/  +  หน้าเว็บที่ build แล้ว (dist/ จาก src/)
  พิมพ์ตรง ลิ้นชัก อัปเดต    ทุกสาขาใช้เซิร์ฟเวอร์เดียว ฐานข้อมูลเดียว

ชุดทดลอง (license):  แอป .exe ชุดทดลอง ──► license-server/ ──► สร้าง/เปิด/ปิดเซิร์ฟเวอร์ POS ของแต่ละร้าน
```

| โฟลเดอร์ | คืออะไร | ภาษา / รัน |
|---|---|---|
| `src/` + `App.tsx` | หน้าจอทั้งหมด (Expo / React Native Web) | `npm run dev` (พัฒนา) · `npm run build:web` → `dist/` |
| `server/` | API + เสิร์ฟหน้าเว็บ + ฐานข้อมูล | `npm run dev:api` (พอร์ต 3000) — ไม่มี dependency ภายนอก |
| `desktop/` | แอป Windows (Electron) — เปิดหน้าเว็บจากเซิร์ฟเวอร์ | `cd desktop && npm start` · ดู `desktop/README.md` |
| `license-server/` | ระบบ license + แผงควบคุม + สร้างร้านทดลองอัตโนมัติ | พอร์ต 3100 |
| `deploy/` | สคริปต์/ไฟล์ตั้งค่า VPS (Caddy, systemd, อัปเดต, สำรองข้อมูล) | ดู `deploy/README.md` |
| `data/` | ฐานข้อมูลทดลองบนเครื่อง (ไม่ขึ้น git) | `npm run db:reset` = เริ่มใหม่ |

ไฟล์ .bat ที่โฟลเดอร์หลัก (ดับเบิลคลิกได้): `build-web.bat` build หน้าเว็บใหม่

## เซิร์ฟเวอร์ (`server/`)

`index.ts` คือ router ทั้งหมด (ค้นหา `path === '/api/...'`) — logic จริงอยู่ในไฟล์ตามหัวข้อ:

| ไฟล์ | หน้าที่ |
|---|---|
| `db.ts` | เปิดฐานข้อมูล · สร้าง/ปรับตาราง (migration) · แยกข้อมูลตามสาขา · `tx()` |
| `common.ts` | ค่าคงที่และตัวช่วยร่วม (`round2`, `HttpError`, วิธีชำระ, อัตรา VAT วันนี้) |
| `auth.ts` | พนักงาน · PIN · session · สิทธิ์ (ผู้จัดการ / ยกเลิกบิล / สาขา) |
| `branches.ts` | สาขา · สาขาปัจจุบันของคำขอ |
| `settings.ts` | ตั้งค่าร้าน (JSON แยกหมวดในตาราง `settings`) · `publicSettings()` ส่งให้หน้าจอ |
| `products.ts` · `productImport.ts` · `stockExport.ts` | สินค้า / SKU / สต็อก · นำเข้า · ส่งออก Excel |
| `shifts.ts` | กะการขาย · เงินในลิ้นชัก · บันทึกรับ-จ่ายเงิน (`payments`) |
| `history.ts` | ประวัติการขาย · แก้ไขบิล · ยกเลิกบิล |
| `held.ts` | พักบิล |
| `expenses.ts` | ค่าใช้จ่ายร้าน · สมุดเงินสด |
| `shipments.ts` · `shipmentExport.ts` · `shipmentReport.ts` | ใบส่งของจากโรงงาน → สาขา |
| `dashboard.ts` · `reports.ts` · `reportExport.ts` · `dayreport.ts` | รายงานรวม · รายงานย่อย · Excel · สรุปยอดประจำวัน |
| `tax.ts` | VAT: ตารางอัตรา (มีวันเริ่ม/สิ้นสุด) · เครื่อง POS · คำนวณภาษีของบิล · ตั้งค่าภาษี |
| `taxDocs.ts` | ใบกำกับภาษีเต็มรูป · ใบลดหนี้ (รับคืนสินค้า) · กติกาการยกเลิกบิล VAT |
| `internal.ts` | API ภายในให้เซิร์ฟเวอร์ license: `/api/internal/stats`, `/api/internal/backup?branch=` (เปิดเฉพาะเมื่อมี `POS_INTERNAL_TOKEN`) |
| `backup.ts` | สำรองทั้งร้าน / รายสาขา (ไฟล์ .db) · กู้คืนเฉพาะสาขาที่เลือก (`BRANCH_DATA` = ตารางของสาขา) · สำรองข้อมูลก่อนกู้คืนไว้ที่ `data/backups/` |
| `docFloor.ts` | จำเลขที่บิล/เอกสารที่เคยออก — หลังกู้คืนเลขรันต่อ ไม่ซ้ำเอกสารที่ลูกค้าได้ไปแล้ว |
| `taxReport.ts` | รายงานภาษีขาย (ภ.พ.30) + Excel |
| `events.ts` · `notify.ts` | เหตุการณ์ → แจ้งเตือน LINE / WhatsApp / Webhook |
| `apikeys.ts` | API key ให้ระบบภายนอก |
| `xlsx.ts` | สร้างไฟล์ Excel เอง (ไม่ใช้ไลบรารี) |
| `seed.ts` | ข้อมูลตัวอย่างครั้งแรก |

### กติกาฐานข้อมูล
- **ไม่มีไฟล์ migration แยก** — ตารางสร้างด้วย `CREATE TABLE IF NOT EXISTS` ในโมดูลเจ้าของ และเพิ่ม/ลบคอลัมน์ด้วยการตรวจ `PRAGMA table_info` ก่อน (ดู `db.ts`) เปิดเซิร์ฟเวอร์ครั้งถัดไปฐานข้อมูลเดิมถูกปรับให้เอง
- **หลายสาขาในฐานข้อมูลเดียว:** ตารางที่แยกตามสาขาเก็บจริงใน `*_all` (มี `branch_id`) และมี view ชื่อเดิม (`orders`, `variants`, `shifts`, `payments`, `cash_movements`, `stock_moves`) ที่เห็นเฉพาะสาขาของคำขอ — query ผ่าน view ได้เลย ส่วนการ INSERT ใช้ตาราง `*_all` หรือ view ตามที่โค้ดเดิมทำ
- สินค้า/หมวดหมู่/SKU ใช้ร่วมกันทุกสาขา · สต็อกและราคาของแต่ละสาขาอยู่ใน `branch_stock`
- **บิลไม่ถูกลบ** — ยกเลิกเก็บเหตุผล/ผู้ทำ/ผู้อนุมัติ · บิลเก็บอัตรา VAT ที่ใช้จริง (`vat_rate`, `vat_base`, `exempt_amount`)
- เงินปัดด้วย `round2()` ทุกครั้ง · วันที่เป็นเวลาเครื่อง `YYYY-MM-DD HH:MM:SS`

| ตาราง | เก็บอะไร |
|---|---|
| `branches` · `staff` · `staff_branches` · `sessions` | สาขา · พนักงาน · สาขาที่เข้าได้ · การเข้าสู่ระบบ |
| `categories` · `products` · `variants_all` · `branch_stock` · `stock_moves_all` | สินค้า · SKU · สต็อกต่อสาขา · ความเคลื่อนไหวสต็อก |
| `orders_all` · `order_items` · `order_edits` · `promos` | บิล · รายการ · ประวัติแก้ไข/ยกเลิก/ใบลดหนี้ · โค้ดส่วนลด |
| `shifts_all` · `payments_all` · `cash_movements_all` | กะ · เงินรับ/คืนต่อบิล · นำเงินเข้า/ออก |
| `held_bills` · `expenses` · `expense_items` | พักบิล · ค่าใช้จ่าย |
| `shipments` · `shipment_items` · `shipment_seq` | ใบส่งของ |
| `vat_rates` · `pos_terminals` · `tax_invoices` · `credit_notes` · `credit_note_items` | ภาษี |
| `settings` · `api_keys` | ตั้งค่าร้าน · API key |

ข้อมูลเดิมที่คงไว้ให้ฐานข้อมูลเก่าอ่านได้ (ไม่ต้องใช้ในโค้ดใหม่): `settings.payments.vat.rate` (อัตราจริงอยู่ใน `vat_rates`) ·
API key สิทธิ์ `sync` และ `settings.stock.sync` (ระบบเชื่อมสาขาแบบแยกเครื่องที่เลิกแล้ว)

## หน้าจอ (`src/`)

| ส่วน | ไฟล์ |
|---|---|
| เริ่มแอป · เลือกหน้า | `App.tsx` (route ตามเมนู `components/NavMenu.tsx`) |
| เรียก API | `api.ts` — ทุก endpoint อยู่ใน `api.xxx()` |
| ชนิดข้อมูล | `types.ts` (ข้อมูลหลัก) · ชนิดเฉพาะ API อยู่ท้าย `api.ts` |
| ตั้งค่าร้านฝั่งจอ | `appSettings.ts` · `useAppSettings()` |
| หน้าหลักแต่ละเมนู | `screens/*Screen.tsx` |
| ชิ้นส่วนตามหัวข้อ | `components/` — `history/` บิล · `shift/` กะ · `stock/` สินค้า · `report/` ชุดรายงาน |
| หน้าตั้งค่า | `screens/SettingsScreen.tsx` = เมนูหมวด + ปุ่มบันทึก · **แต่ละหมวดแยกไฟล์ใน `settings/`** (ดูตารางด้านล่าง) |
| พิมพ์ | `print.ts` (ใบเสร็จ · ปิดกะ · A4) · `labels.ts` (ป้ายบาร์โค้ด) · `receiptText.ts` |
| แอปเดสก์ท็อป | `desktop.ts` (มีเฉพาะเมื่อเปิดในแอป .exe) · `terminal.ts` (เครื่อง POS ของเครื่องนี้) |
| สไตล์ | `theme.ts` · `layout.ts` |

### หน้าตั้งค่า (`src/settings/`)
แก้หมวดไหน เปิดไฟล์ของหมวดนั้นไฟล์เดียว — ชิ้นส่วนหน้าตาที่ใช้ร่วมกัน (การ์ด · ช่องกรอก · สวิตช์ · สไตล์ `s`) อยู่ใน `ui.tsx`

| เมนูในหน้าตั้งค่า | ไฟล์ |
|---|---|
| ข้อมูลร้าน | `ShopSection.tsx` |
| การแสดงผลหน้าขาย | `DisplaySection.tsx` |
| สต็อก | `StockSection.tsx` |
| วิธีชำระเงิน & ค่าธรรมเนียม | `PaymentsSection.tsx` |
| ภาษี (VAT) | `TaxSection.tsx` |
| บาร์โค้ด | `BarcodeSection.tsx` |
| กระดาษบาร์โค้ด | `LabelsSection.tsx` |
| ตั้งค่าเครื่องพิมพ์บาร์โค้ด | `LabelPrinterSection.tsx` |
| ใบเสร็จ | `ReceiptSection.tsx` |
| ตั้งค่าเครื่องพิมพ์ใบเสร็จ | `PrinterSection.tsx` |
| การแจ้งเตือน & API | `notify/NotifySection.tsx` + แท็บ `ChannelsTab` · `EventsTab` · `DesignTab` · `ApiTab` |
| สำรอง & กู้คืนข้อมูล | `BackupSection.tsx` (ดาวน์โหลด .db ทั้งร้าน/รายสาขา · ลากไฟล์มาวางเพื่อกู้คืน เลือกสาขา · PIN ผู้จัดการ) |

เพิ่มหมวดใหม่: สร้างไฟล์ใน `settings/` แล้วเพิ่มรายการใน `SECTIONS` + บรรทัดแสดงผลใน `screens/SettingsScreen.tsx`

### สองภาษา ไทย / English (`src/i18n/`)
- สลับภาษาที่ปุ่ม TH / EN ท้ายเมนู — จำแยกต่อเครื่อง (`localStorage` `pos.lang`)
- `th.ts` / `en.ts` + `t('key')` — ใช้กับข้อความใหม่ (เมนู บทบาท หน้าเข้าสู่ระบบ) · ตรวจคีย์ที่ขาด: `node scripts/i18n-check.mjs`
- `dom.ts` + `phrases.ts` — ข้อความไทยที่ยังเขียนตรง ๆ ในหน้าจอ (หลายพันข้อความ) ถูกแปลบนหน้าจอตอนเลือก EN: คอยดู DOM แล้วเทียบพจนานุกรม (รวม placeholder / aria-label / title / alert / วันที่จาก Intl) · เลือก TH = คืนข้อความเดิม · ไม่แตะค่าในช่องกรอกและข้อมูลร้าน (ชื่อสินค้า ชื่อพนักงาน ฯลฯ)
- เพิ่มหน้าจอ/ข้อความใหม่ → รัน `node scripts/i18n-extract.cjs` ดูข้อความไทยที่ยังไม่มีคำแปล แล้วเติมใน `phrases.ts` (ไม่เติม = หน้าจอ EN แสดงไทยตรงนั้น ไม่พัง)
- ไม่แปลส่วนที่ครอบด้วย `testID="noi18n"` · ใบเสร็จ/ป้ายบาร์โค้ดใช้ภาษาตามตั้งค่าใบเสร็จ (หน้าต่างพิมพ์แยก ไม่โดนแปล) · ข้อความ error จาก server ยังเป็นไทย

## แอปเดสก์ท็อป (`desktop/`)
`main.cjs` หน้าต่าง · ตั้งค่าเครื่อง · พิมพ์ · อัปเดต · license ชุดทดลอง · `preload.cjs` สะพานให้หน้าเว็บ (`window.posDesktop`) ·
`escpos.cjs` พิมพ์ ESC/POS · หน้าในแอป: `settings.html` `offline.html` `splash.html` `activate.html` · รายละเอียดใน `desktop/README.md`

## ระบบ license (`license-server/`)
| ไฟล์ | หน้าที่ |
|---|---|
| `server.ts` | API ของแอป (`/api/activate`, `/api/check`) · แผงควบคุม `/admin` · หมดอายุ → ปิดร้าน |
| `store.ts` | ฐานข้อมูล license (`licenses`, `instances`, `machines`, `events`) |
| `provision.ts` | สร้าง/เปิด/ปิดร้าน: บนเครื่อง (child process) หรือ VPS (`deploy/pos-trial-ctl.sh`) |
| `gateway.ts` | ประตูเดียวเข้าทุกร้าน: แยกร้านด้วย header `X-POS-Shop` · ตรวจ license + เครื่องทุกคำขอ · ผู้ดูแลเปิดดูร้านด้วย cookie ที่มีลายเซ็น |
| `shopdata.ts` | ข้อมูลร้าน (จำนวนสินค้า/บิล/ยอดขาย) + สำรองข้อมูลร้าน ทั้งร้าน/รายสาขา (กดเอง + อัตโนมัติวันละครั้ง · เก็บ 20 ไฟล์) ผ่าน API ภายในของร้าน `server/internal.ts` (token = HMAC ต่อร้าน) |
| `http.ts` | ตัวช่วย HTTP · กันเดารหัส · ล็อกงานทีละร้าน |
| `admin.html` | หน้าแผงควบคุม (ไฟล์เดียว) |

## ข้อควรระวัง
- repo เป็นสาธารณะ: ห้าม commit `desktop/app-key.txt`, `data/`, `license-server/data/`, รหัสผ่าน/โทเคนใด ๆ
- ห้ามทดสอบบนเซิร์ฟเวอร์จริง — ใช้ `data/` บนเครื่อง
- แก้ `server/` / `src/` → `pos-update` บน VPS · แก้ `desktop/` → ต้องเพิ่มเวอร์ชันใน `desktop/package.json` และออกตัวติดตั้งใหม่
