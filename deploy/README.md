# ติดตั้ง Clothing POS บน VPS (Ubuntu 24.04)

เซิร์ฟเวอร์กลางเครื่องเดียว ทุกสาขา (กรุงเทพ / ภูเก็ต / สมุย) ใช้ฐานข้อมูลเดียวกันผ่าน `https://pos.sh0p.tech`

| ตำแหน่ง | ใช้ทำอะไร |
|---|---|
| `/opt/pos` | โค้ด (git clone) |
| `/var/lib/pos` | **ข้อมูลร้าน**: `pos.db`, `uploads/` (รูปสินค้า), `.pin-secret` |
| `/var/backups/pos` | ไฟล์สำรองรายวัน (เก็บ 30 วัน) |
| `/var/www/pos-updates` | ไฟล์อัปเดตแอป .exe → `https://pos.sh0p.tech/updates/` |

## 1. ชี้โดเมนย่อยมาที่ VPS
ในหน้าจัดการ DNS ของ `sh0p.tech` เพิ่มระเบียน:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `pos` | `179.197.244.102` | 300 |

ตรวจ: `ping pos.sh0p.tech` ต้องได้ 179.197.244.102 (รอไม่กี่นาทีถึง 1 ชม.)

## 2. เข้า VPS
Windows: เปิด PowerShell แล้ว `ssh root@179.197.244.102` (หรือกด **Web console** ใน hPanel)

## 3. ดึงโค้ดและติดตั้ง
```bash
apt-get update && apt-get install -y git
git clone -b vps-deploy https://github.com/n4444n/pos.git /opt/pos
bash /opt/pos/deploy/setup-vps.sh pos.sh0p.tech
```
ใช้เวลาราว 5–15 นาที (build หน้าเว็บนานที่สุด)

## 4. เข้าใช้งานครั้งแรก — ทำทันที
1. เปิด `https://pos.sh0p.tech`
2. ดู PIN เริ่มต้น: `journalctl -u pos | grep PIN`
3. **ระบบสร้างพนักงานตัวอย่างที่ PIN เดาง่าย (123456, 234567, 345678) และผู้จัดการ PIN 999999**
   เว็บนี้เปิดสู่อินเทอร์เน็ต → เปลี่ยน PIN ผู้จัดการ และลบ/ปิดพนักงานตัวอย่างก่อนทำอย่างอื่น
4. ลบสินค้าตัวอย่าง แล้วตั้งสาขา (กรุงเทพ / ภูเก็ต / สมุย) + พนักงานของแต่ละสาขา

## 5. ความปลอดภัย SSH (แนะนำ)
- เปลี่ยนรหัส root ให้ยาว: `passwd`
- ดีที่สุด: ใช้ SSH key แทนรหัสผ่าน (hPanel → รหัส SSH → เพิ่ม) แล้วปิดล็อกอินด้วยรหัสผ่าน

## งานประจำ
| ต้องการ | คำสั่ง |
|---|---|
| ดูสถานะ | `systemctl status pos` |
| ดู log สด | `journalctl -u pos -f` |
| อัปเดตโค้ด (นอกเวลาขาย) | `pos-update` |
| สำรองทันที | `pos-backup` |
| รีสตาร์ต | `systemctl restart pos` |

## ย้ายข้อมูลเดิมจากเครื่องที่เคยใช้ (ถ้ามี)
บนเครื่องเดิม ปิดโปรแกรม POS ก่อน แล้วอัปโหลดโฟลเดอร์ข้อมูล (`data\` หรือ `%APPDATA%\Clothing POS\data`):
```bash
# บน VPS
systemctl stop pos
# บน Windows (PowerShell) — คัดลอก pos.db, uploads, .pin-secret
scp -r "C:\path\to\data\*" root@179.197.244.102:/var/lib/pos/
# บน VPS
chown -R pos:pos /var/lib/pos && systemctl start pos
```
`.pin-secret` ต้องมาด้วย ไม่งั้น PIN เดิมทั้งหมดจะใช้ไม่ได้

## กู้ข้อมูลจากไฟล์สำรอง
```bash
systemctl stop pos
cd /var/lib/pos && mkdir -p old && mv pos.db* old/
gunzip -c /var/backups/pos/pos-YYYYMMDD-HHMMSS.db.gz > pos.db
chown pos:pos pos.db && systemctl start pos
```

## สำรองนอกเครื่อง (ขั้นถัดไป)
ไฟล์สำรองตอนนี้อยู่บน VPS เครื่องเดียวกัน ถ้า VPS เสียจะหายไปด้วย
ควรตั้ง `rclone` ส่งไฟล์ใน `/var/backups/pos` ขึ้น Google Drive ทุกวัน

## ล็อกให้ใช้ได้เฉพาะแอป .exe
เปิด `https://pos.sh0p.tech` ในเบราว์เซอร์จะได้ **403** · ผ่านได้เฉพาะแอปที่ build พร้อม "กุญแจแอป"
(ระบบภายนอกที่ใช้ API key จากเมนูตั้งค่ายังเรียก API ได้ตามปกติ)

**ลำดับสำคัญ — ถ้าเปิดล็อกก่อนทุกเครื่องมีแอปที่มีกุญแจ สาขานั้นจะใช้งานไม่ได้และอัปเดตเองไม่ได้**

1. VPS: `bash /opt/pos/deploy/app-lock.sh key` → คัดลอกกุญแจที่แสดง
2. เครื่อง build: สร้างไฟล์ `desktop\app-key.txt` ใส่กุญแจบรรทัดเดียว (ไฟล์นี้ไม่ขึ้น GitHub)
3. `build-desktop.bat` → `publish-update.bat`
4. รอจน **ทุกเครื่องทุกสาขา** อัปเดตแล้ว (ดู "แอป x.x.x" ท้ายเมนูซ้าย)
5. VPS: `bash /opt/pos/deploy/app-lock.sh on`
6. ทดสอบ: Chrome → 403 · แอปที่ร้าน → ใช้ได้ปกติ

| ต้องการ | คำสั่งบน VPS |
|---|---|
| ดูสถานะ | `bash /opt/pos/deploy/app-lock.sh status` |
| ปลดล็อกชั่วคราว (เช่น เครื่องใหม่ยังไม่มีแอป) | `bash /opt/pos/deploy/app-lock.sh off` |
| ล็อกอีกครั้ง | `bash /opt/pos/deploy/app-lock.sh on` |

หมายเหตุ
- กุญแจฝังอยู่ในตัวติดตั้ง .exe — **อย่าแจกไฟล์ .exe ให้คนนอก** (ใครมีไฟล์ก็เข้าหน้า login ได้ แต่ยังต้องมี PIN)
- ถ้ากุญแจหลุด: ลบ `/etc/pos/app-key` → `app-lock.sh key` (ได้กุญแจใหม่) → `off` → build + publish แอปใหม่ → รอทุกเครื่องอัปเดต → `on`
- รัน `setup-vps.sh` ซ้ำจะเขียน Caddyfile แบบไม่ล็อกทับ → รัน `app-lock.sh on` อีกครั้ง

## สร้างตัวติดตั้งอัตโนมัติ (GitHub Actions) + หน้าดาวน์โหลด
ไม่ต้องรัน .bat เอง — push ขึ้น main แล้ว GitHub build `.exe` บน Windows ของ GitHub และส่งขึ้น VPS ให้

ตั้งค่าครั้งเดียว:
1. VPS: `bash /opt/pos/deploy/release-setup.sh` → ตั้งรหัสผ่านหน้าดาวน์โหลด → สคริปต์แสดงค่า 3 ค่า
2. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret** สร้าง `VPS_HOST`, `APP_KEY`, `VPS_SSH_KEY` ตามที่แสดง
3. GitHub → แท็บ **Actions → Desktop installer → Run workflow** (ครั้งแรก)

หลังจากนั้น: แก้ไฟล์ใน `desktop/` + **เพิ่ม version** ใน `desktop/package.json` → push ขึ้น main → รอ ~10 นาที
- ทุกร้านได้ปุ่ม "อัปเดต" ในโปรแกรม
- เครื่องใหม่: เปิด `https://pos.sh0p.tech/download/` (ชื่อผู้ใช้ `shop` + รหัสที่ตั้ง) → กดดาวน์โหลด → ติดตั้ง
- เปลี่ยนรหัสหน้าดาวน์โหลด: `bash /opt/pos/deploy/release-setup.sh --password`

ห้ามเก็บไฟล์ .exe ไว้ใน GitHub (repo เป็นสาธารณะ และไฟล์มีกุญแจแอป) — workflow ส่งขึ้น VPS เท่านั้น
`build-desktop.bat` / `publish-update.bat` ยังใช้ได้เป็นทางสำรอง
