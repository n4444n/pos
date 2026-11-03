#!/usr/bin/env bash
# วางไฟล์ติดตั้งแอปมือถือ (APK) ขึ้นหน้าดาวน์โหลด https://<โดเมน>/app
#   bash /opt/pos/deploy/mobile-app.sh ~/tally-1.0.0.apk            เวอร์ชันอ่านจากชื่อไฟล์
#   bash /opt/pos/deploy/mobile-app.sh ~/app.apk 1.2.0              ระบุเวอร์ชันเอง
#   bash /opt/pos/deploy/mobile-app.sh status
#
# รันซ้ำได้ = อัปเวอร์ชันใหม่ (ทับไฟล์เดิม · QR ในโปรแกรม .exe ชี้ที่หน้าเว็บ ไม่ต้องแก้อะไร)
# ไม่แตะ Caddy ไม่แตะเซิร์ฟเวอร์ POS — แค่เขียนไฟล์ลง /var/www/pos-app
set -euo pipefail
APP_DIR=/opt/pos
WWW=/var/www/pos-app
OWNER=posrelease            # ผู้ใช้เดียวกับที่ GitHub Actions ใช้วางไฟล์ .exe
CADDYFILE=/etc/caddy/Caddyfile
[ "$(id -u)" = 0 ] || { echo "ต้องรันด้วย root"; exit 1; }

domain() { grep -v '^\s*#' "$CADDYFILE" | grep -m1 -oE '^[^ {]+'; }

if [ "${1:-status}" = status ]; then
  if [ -s "$WWW/clothing-pos.apk" ]; then
    echo "แอปมือถือ: มีแล้ว — https://$(domain)/app"
    ls -lh "$WWW/clothing-pos.apk" | awk '{print "  ไฟล์:", $5, "·", $6, $7, $8}'
  else
    echo "แอปมือถือ: ยังไม่มีไฟล์ติดตั้ง"
  fi
  grep -q '/app/\*' "$CADDYFILE" && echo "เส้นทาง /app ใน Caddy: เปิดแล้ว" \
    || echo "เส้นทาง /app ใน Caddy: ยังไม่เปิด — git pull แล้วรัน: bash $APP_DIR/deploy/app-lock.sh reapply"
  exit 0
fi

APK=$1
[ -f "$APK" ] || { echo "ไม่พบไฟล์: $APK"; exit 1; }
case "$APK" in *.apk) ;; *) echo "ต้องเป็นไฟล์ .apk"; exit 1 ;; esac

# เวอร์ชัน: จากอาร์กิวเมนต์ที่ 2 หรือเดาจากชื่อไฟล์ (เช่น tally-1.2.0.apk) ไม่ได้ก็ใช้วันที่
VER=${2:-$(basename "$APK" .apk | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)}
VER=${VER:-$(date +%Y.%m.%d)}
SIZE=$(du -h "$APK" | cut -f1)
DATE=$(date '+%-d/%-m/%Y')

mkdir -p "$WWW"
install -m 644 "$APK" "$WWW/clothing-pos.apk.new"
mv -f "$WWW/clothing-pos.apk.new" "$WWW/clothing-pos.apk"   # สลับทีเดียว คนที่กำลังโหลดอยู่ไม่ได้ไฟล์ครึ่ง ๆ
sed -e "s/{{VERSION}}/$VER/g" -e "s/{{SIZE}}/$SIZE/g" -e "s|{{DATE}}|$DATE|g" \
  "$APP_DIR/deploy/app-page.html" > "$WWW/index.html"
chmod 644 "$WWW/index.html"
id "$OWNER" >/dev/null 2>&1 && chown -R "$OWNER:$OWNER" "$WWW" || true

echo "เรียบร้อย — เวอร์ชัน $VER ($SIZE)"
echo "ทดสอบ: https://$(domain)/app"
grep -q '/app/\*' "$CADDYFILE" || echo "เตือน: Caddy ยังไม่เปิดเส้นทาง /app — รัน bash $APP_DIR/deploy/app-lock.sh reapply"
