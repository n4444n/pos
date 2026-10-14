# ติดตั้ง Clothing POS บน VPS (Ubuntu 24.04)

เซิร์ฟเวอร์กลางเครื่องเดียว ทุกสาขา (กรุงเทพ / ภูเก็ต / สมุย) ใช้ฐานข้อมูลเดียวกันผ่าน `https://pos.greenthread.online`

| ตำแหน่ง | ใช้ทำอะไร |
|---|---|
| `/opt/pos` | โค้ด (git clone) |
| `/var/lib/pos` | **ข้อมูลร้าน**: `pos.db`, `uploads/` (รูปสินค้า), `.pin-secret` |
| `/var/backups/pos` | ไฟล์สำรองรายวัน (เก็บ 30 วัน) |
| `/var/www/pos-updates` | ไฟล์อัปเดตแอป .exe → `https://pos.greenthread.online/updates/` |

## 1. ชี้โดเมนย่อยมาที่ VPS
ในหน้าจัดการ DNS ของ `greenthread.online` เพิ่มระเบียน:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `pos` | `179.197.244.102` | 300 |

ตรวจ: `ping pos.greenthread.online` ต้องได้ 179.197.244.102 (รอไม่กี่นาทีถึง 1 ชม.)

## 2. เข้า VPS
Windows: เปิด PowerShell แล้ว `ssh root@179.197.244.102` (หรือกด **Web console** ใน hPanel)

## 3. ดึงโค้ดและติดตั้ง
```bash
apt-get update && apt-get install -y git
git clone -b vps-deploy https://github.com/n4444n/pos.git /opt/pos
bash /opt/pos/deploy/setup-vps.sh pos.greenthread.online
```
ใช้เวลาราว 5–15 นาที (build หน้าเว็บนานที่สุด)

## 4. เข้าใช้งานครั้งแรก — ทำทันที
1. เปิด `https://pos.greenthread.online`
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
