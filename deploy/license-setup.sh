#!/usr/bin/env bash
# ติดตั้ง/อัปเดตระบบ license บน VPS เดิม (หลัง setup-vps.sh) — รันด้วย root
#   bash /opt/pos/deploy/license-setup.sh license.sh0p.tech [pos.sh0p.tech]
#   bash /opt/pos/deploy/license-setup.sh --password        เปลี่ยนรหัสผ่านแผงควบคุม
#   bash /opt/pos/deploy/license-setup.sh --legacy off      ปิดช่วงย้ายระบบ (บังคับให้ทุกแอปต้องกรอก license)
#
# โครงสร้างหลังติดตั้ง
#   https://<โดเมนแอป>      ประตูเดียวเข้าทุกร้าน — แอปแนบ X-POS-Shop ทุกคำขอ (ร้านหลัก = pos.service พอร์ต 3000)
#   https://<โดเมน license> แผงควบคุมอย่างเดียว (/admin)
# DNS ที่ต้องมีก่อน:  A  license  → IP VPS   (โดเมนแอปมีอยู่แล้ว)
# รันซ้ำได้ (อัปเดตสคริปต์/บริการ ไม่ลบข้อมูล)
set -euo pipefail
APP_DIR=/opt/pos
ENV_FILE=/etc/pos-license/env
CADDYFILE=/etc/caddy/Caddyfile
[ "$(id -u)" = 0 ] || { echo "ต้องรันด้วย root"; exit 1; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
setenv() { # คีย์ ค่า
  mkdir -p "$(dirname "$ENV_FILE")"; touch "$ENV_FILE"
  sed -i "/^$1=/d" "$ENV_FILE"
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
}

set_password() {
  local pw pw2
  read -rsp "ตั้งรหัสผ่านแผงควบคุม (อย่างน้อย 10 ตัว): " pw; echo
  read -rsp "ยืนยันอีกครั้ง: " pw2; echo
  [ "$pw" = "$pw2" ] || { echo "รหัสไม่ตรงกัน"; exit 1; }
  [ ${#pw} -ge 10 ] || { echo "สั้นเกินไป"; exit 1; }
  setenv ADMIN_PASSWORD "$pw"
}

case "${1:-}" in
  --password)
    set_password
    systemctl restart pos-license
    echo "เปลี่ยนรหัสผ่านแล้ว ✓"
    exit 0
    ;;
  --legacy)
    case "${2:-}" in
      on)  setenv LEGACY_MAIN 1; echo "เปิดช่วงย้ายระบบ — แอปรุ่นเก่า (ยังไม่กรอก license) เข้าร้านหลักได้" ;;
      off) setenv LEGACY_MAIN 0; echo "ปิดช่วงย้ายระบบ — ทุกแอปต้องกรอก license แล้ว" ;;
      *)   echo "ใช้: $0 --legacy on|off"; exit 1 ;;
    esac
    systemctl restart pos-license
    exit 0
    ;;
esac

LICENSE_DOMAIN="${1:?ใช้: bash deploy/license-setup.sh license.example.com [pos.example.com]}"
# โดเมนของแอป = ที่ตั้งไว้ใน Caddyfile อยู่แล้ว (บรรทัดแรกที่ไม่ใช่คอมเมนต์) ถ้าไม่ได้ระบุ
APP_DOMAIN="${2:-$(grep -v '^\s*#' "$CADDYFILE" | grep -m1 -oE '^[^ {]+')}"
[[ "$APP_DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "หาโดเมนของแอปไม่เจอ — ระบุเป็นอาร์กิวเมนต์ที่ 2"; exit 1; }
[ "$APP_DOMAIN" != "$LICENSE_DOMAIN" ] || { echo "โดเมนแผงควบคุมต้องคนละตัวกับโดเมนของแอป"; exit 1; }
[ -f "$APP_DIR/license-server/server.ts" ] || { echo "ไม่พบ $APP_DIR/license-server — อัปเดตโค้ดก่อน (pos-update)"; exit 1; }
id pos >/dev/null 2>&1 || { echo "ยังไม่ได้ติดตั้ง POS หลัก — รัน setup-vps.sh ก่อน"; exit 1; }
[ -d "$APP_DIR/dist" ] || { echo "ยังไม่ได้ build หน้าเว็บ — cd $APP_DIR && npm run build:web"; exit 1; }

step "ผู้ใช้ระบบ + โฟลเดอร์"
id poslic >/dev/null 2>&1 || useradd --system --home-dir /var/lib/pos-license --shell /usr/sbin/nologin poslic
mkdir -p /var/lib/pos-license /var/lib/pos-trial /etc/pos-trial /etc/pos-license /etc/caddy/conf.d /var/www/pos-updates
chown poslic:poslic /var/lib/pos-license && chmod 750 /var/lib/pos-license
chown pos:pos /var/lib/pos-trial && chmod 755 /var/lib/pos-trial
chmod 700 /etc/pos-trial
chmod 755 /var/www/pos-updates

step "ค่าตั้ง $ENV_FILE"
touch "$ENV_FILE"
chown root:poslic "$ENV_FILE" && chmod 640 "$ENV_FILE"
sed -i -e '/^TRIAL_DOMAIN=/d' "$ENV_FILE"          # รุ่นเก่า: โดเมนย่อยต่อร้าน (เลิกใช้แล้ว)
setenv ADMIN_DOMAIN "$LICENSE_DOMAIN"               # โดเมนที่มีแผงควบคุม
setenv APP_BASE "https://$APP_DOMAIN"               # โดเมนที่ทุกแอปเข้าใช้งาน
setenv MAIN_SLUG main                               # ร้านของเจ้าของระบบ (pos.service)
setenv MAIN_PORT 3000
setenv DOWNLOAD_URL "https://$APP_DOMAIN/download/"
grep -q '^MAIN_NAME=' "$ENV_FILE" || setenv MAIN_NAME "ร้านหลัก"
# ครั้งแรก: เปิดช่วงย้ายระบบไว้ เพื่อให้แอปเดิมที่ยังไม่กรอก license ขายต่อได้ (ปิดด้วย --legacy off)
grep -q '^LEGACY_MAIN=' "$ENV_FILE" || setenv LEGACY_MAIN 1
grep -q '^ADMIN_PASSWORD=' "$ENV_FILE" || set_password

step "คำสั่งจัดการร้าน (pos-trial-ctl) + สิทธิ์ sudo เฉพาะคำสั่งนี้"
install -m 755 -o root -g root "$APP_DIR/deploy/pos-trial-ctl.sh" /usr/local/bin/pos-trial-ctl
echo 'poslic ALL=(root) NOPASSWD: /usr/local/bin/pos-trial-ctl' > /etc/sudoers.d/pos-license
chmod 440 /etc/sudoers.d/pos-license
visudo -cf /etc/sudoers.d/pos-license

step "บริการ systemd"
install -m 644 "$APP_DIR/deploy/pos-trial@.service" /etc/systemd/system/pos-trial@.service
install -m 644 "$APP_DIR/deploy/pos-license.service" /etc/systemd/system/pos-license.service
install -m 644 "$APP_DIR/deploy/pos.service" /etc/systemd/system/pos.service
systemctl daemon-reload
systemctl restart pos            # รับเฉพาะ 127.0.0.1 (เข้าได้ทางประตูเท่านั้น)
systemctl enable --now pos-license
systemctl restart pos-license

step "Caddy: $APP_DOMAIN (ประตูเข้าทุกร้าน) + $LICENSE_DOMAIN (แผงควบคุม)"
# รุ่นเก่าเคยสร้างโดเมนย่อยต่อร้าน — เลิกใช้ ไม่งั้นจะเข้าร้านได้โดยไม่ผ่านประตู
rm -f /etc/caddy/trials/*.caddy
sed -i '/import \/etc\/caddy\/trials/d' /etc/caddy/conf.d/license.caddy 2>/dev/null || true
sed -e "s/{\$LICENSE_DOMAIN}/$LICENSE_DOMAIN/g" "$APP_DIR/deploy/license.caddy" > /etc/caddy/conf.d/license.caddy
# โดเมนของแอปต้องชี้ไปที่ประตู (พอร์ต 3100) — สร้างใหม่จากแม่แบบ คงสถานะล็อกเดิมไว้ (ใส่บรรทัด import conf.d ให้ด้วย)
bash "$APP_DIR/deploy/app-lock.sh" reapply
grep -q 'import /etc/caddy/conf.d/' "$CADDYFILE" || printf '\nimport /etc/caddy/conf.d/*.caddy\n' >> "$CADDYFILE"
caddy validate --config "$CADDYFILE" --adapter caddyfile
systemctl reload caddy

step "ตรวจสอบ"
sleep 2
curl -fsS http://127.0.0.1:3100/api/health >/dev/null && echo "เซิร์ฟเวอร์ license ทำงานแล้ว ✓" || echo "ยังไม่ตอบ — journalctl -u pos-license -n 50"
curl -fsS http://127.0.0.1:3000/api/health >/dev/null && echo "ร้านหลักทำงานแล้ว ✓" || echo "ร้านหลักยังไม่ตอบ — journalctl -u pos -n 50"
MAIN_CODE=$(sqlite3 /var/lib/pos-license/license.db "SELECT code FROM licenses WHERE slug='main'" 2>/dev/null || true)

cat <<EOT

=====================================================================
 แผงควบคุม     : https://$LICENSE_DOMAIN/admin
 ทุกร้านเข้าที่  : https://$APP_DOMAIN   (แยกร้านด้วย license — ไม่มีโดเมนย่อยต่อร้านแล้ว)
 license ร้านหลัก: ${MAIN_CODE:-ดูในแผงควบคุม}
 ตัวติดตั้ง      : วาง ClothingPOS-Setup.exe + latest.yml ที่ /var/www/pos-updates/
 ดู log         : journalctl -u pos-license -f   ·   journalctl -u pos-trial@<ร้าน> -f
 รายชื่อร้าน    : pos-trial-ctl list

 ขั้นต่อไป (ช่วงย้ายระบบเปิดอยู่ — แอปเดิมยังขายได้)
   1. bash $APP_DIR/deploy/app-lock.sh on      ปิดกั้นไม่ให้เปิดผ่านเบราว์เซอร์
   2. อัปเดตแอปทุกเครื่องในร้าน แล้วกรอก license ร้านหลักข้างบน
   3. bash $0 --legacy off                     บังคับให้ทุกแอปต้องมี license
=====================================================================
EOT
