#!/usr/bin/env bash
# อัปเดตโค้ดบนเซิร์ฟเวอร์ — สำรองข้อมูลก่อน แล้ว pull + build + restart
# ใช้: pos-update            (ดึง branch main ล่าสุดจาก GitHub)
#      pos-update --force    (build + restart ใหม่ แม้โค้ดไม่เปลี่ยน)
# ควรทำนอกเวลาขาย: ระหว่าง restart (ไม่กี่วินาที) ทุกสาขาจะใช้งานไม่ได้
set -euo pipefail
APP_DIR=/opt/pos

echo "==> สำรองข้อมูลก่อนอัปเดต"
/usr/local/bin/pos-backup

cd "$APP_DIR"
echo "==> ดึงโค้ดใหม่ (main)"
OLD=$(git rev-parse --short HEAD)
# ใช้ main เสมอ — เครื่องที่ติดตั้งจาก branch อื่น (เช่น vps-deploy ที่ถูกลบไปแล้ว) ย้ายมา main ให้เอง
git fetch origin main
git checkout -q -B main origin/main
git branch -q --set-upstream-to=origin/main main
NEW=$(git rev-parse --short HEAD)
if [ "$OLD" = "$NEW" ] && [ "${1:-}" != "--force" ]; then
  echo "ไม่มีอะไรใหม่ ($NEW) — ถ้าต้องการ build ใหม่ใช้: pos-update --force"
  exit 0
fi

echo "==> ติดตั้งแพ็กเกจ + build หน้าเว็บ"
npm install --no-audit --no-fund
npm run build:web

# สคริปต์ติดตั้งอาจเปลี่ยน — อัปเดตตัวที่ติดตั้งไว้ด้วย
install -m 644 deploy/pos.service /etc/systemd/system/pos.service
install -m 755 deploy/backup.sh /usr/local/bin/pos-backup
install -m 755 deploy/update.sh /usr/local/bin/pos-update
systemctl daemon-reload

echo "==> รีสตาร์ตเซิร์ฟเวอร์"
systemctl restart pos
sleep 3
curl -fsS http://127.0.0.1:3000/api/health >/dev/null && echo "อัปเดต $OLD → $NEW สำเร็จ ✓" || { echo "เซิร์ฟเวอร์ไม่ตอบ — journalctl -u pos -n 50"; exit 1; }
