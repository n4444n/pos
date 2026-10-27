#!/usr/bin/env bash
# ติดตั้งระบบ license + ร้านทดลองอัตโนมัติ บน VPS เดิม (หลัง setup-vps.sh) — รันด้วย root
#   bash /opt/pos/deploy/license-setup.sh license.sh0p.tech trial.sh0p.tech
#   bash /opt/pos/deploy/license-setup.sh --password      เปลี่ยนรหัสผ่านแผงควบคุม
# DNS ที่ต้องมีก่อน:  A  license  → IP VPS   และ   A  *.trial  → IP VPS
# รันซ้ำได้ (อัปเดตสคริปต์/บริการ ไม่ลบข้อมูล)
set -euo pipefail
APP_DIR=/opt/pos
ENV_FILE=/etc/pos-license/env
[ "$(id -u)" = 0 ] || { echo "ต้องรันด้วย root"; exit 1; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

set_password() {
  local pw pw2
  read -rsp "ตั้งรหัสผ่านแผงควบคุม (อย่างน้อย 10 ตัว): " pw; echo
  read -rsp "ยืนยันอีกครั้ง: " pw2; echo
  [ "$pw" = "$pw2" ] || { echo "รหัสไม่ตรงกัน"; exit 1; }
  [ ${#pw} -ge 10 ] || { echo "สั้นเกินไป"; exit 1; }
  sed -i '/^ADMIN_PASSWORD=/d' "$ENV_FILE"
  printf 'ADMIN_PASSWORD=%s\n' "$pw" >> "$ENV_FILE"
}

if [ "${1:-}" = "--password" ]; then
  set_password
  systemctl restart pos-license
  echo "เปลี่ยนรหัสผ่านแล้ว ✓"
  exit 0
fi

LICENSE_DOMAIN="${1:?ใช้: bash deploy/license-setup.sh license.example.com trial.example.com}"
TRIAL_DOMAIN="${2:?ใช้: bash deploy/license-setup.sh license.example.com trial.example.com}"
[ -f "$APP_DIR/license-server/server.ts" ] || { echo "ไม่พบ $APP_DIR/license-server — อัปเดตโค้ดก่อน (pos-update)"; exit 1; }
id pos >/dev/null 2>&1 || { echo "ยังไม่ได้ติดตั้ง POS หลัก — รัน setup-vps.sh ก่อน"; exit 1; }
[ -d "$APP_DIR/dist" ] || { echo "ยังไม่ได้ build หน้าเว็บ — cd $APP_DIR && npm run build:web"; exit 1; }

step "ผู้ใช้ระบบ + โฟลเดอร์"
id poslic >/dev/null 2>&1 || useradd --system --home-dir /var/lib/pos-license --shell /usr/sbin/nologin poslic
mkdir -p /var/lib/pos-license /var/lib/pos-trial /etc/pos-trial /etc/pos-license /etc/caddy/conf.d /etc/caddy/trials /var/www/pos-trial-updates
chown poslic:poslic /var/lib/pos-license && chmod 750 /var/lib/pos-license
chown pos:pos /var/lib/pos-trial && chmod 755 /var/lib/pos-trial
chmod 700 /etc/pos-trial
chmod 755 /var/www/pos-trial-updates

step "ค่าตั้ง $ENV_FILE"
touch "$ENV_FILE"
chown root:poslic "$ENV_FILE" && chmod 640 "$ENV_FILE"
sed -i -e '/^TRIAL_DOMAIN=/d' -e '/^DOWNLOAD_URL=/d' "$ENV_FILE"
printf 'TRIAL_DOMAIN=%s\nDOWNLOAD_URL=https://%s/updates/ClothingPOS-Trial-Setup.exe\n' "$TRIAL_DOMAIN" "$LICENSE_DOMAIN" >> "$ENV_FILE"
grep -q '^ADMIN_PASSWORD=' "$ENV_FILE" || set_password

step "คำสั่งจัดการร้าน (pos-trial-ctl) + สิทธิ์ sudo เฉพาะคำสั่งนี้"
install -m 755 -o root -g root "$APP_DIR/deploy/pos-trial-ctl.sh" /usr/local/bin/pos-trial-ctl
echo 'poslic ALL=(root) NOPASSWD: /usr/local/bin/pos-trial-ctl' > /etc/sudoers.d/pos-license
chmod 440 /etc/sudoers.d/pos-license
visudo -cf /etc/sudoers.d/pos-license

step "บริการ systemd"
install -m 644 "$APP_DIR/deploy/pos-trial@.service" /etc/systemd/system/pos-trial@.service
install -m 644 "$APP_DIR/deploy/pos-license.service" /etc/systemd/system/pos-license.service
systemctl daemon-reload
systemctl enable --now pos-license
systemctl restart pos-license

step "Caddy: $LICENSE_DOMAIN + *.$TRIAL_DOMAIN"
sed -e "s/{\$LICENSE_DOMAIN}/$LICENSE_DOMAIN/g" -e "s/{\$TRIAL_DOMAIN}/$TRIAL_DOMAIN/g" "$APP_DIR/deploy/license.caddy" > /etc/caddy/conf.d/license.caddy
# Caddyfile เดิม (ก่อนมีระบบนี้) ยังไม่มีบรรทัด import → เพิ่มให้
grep -q 'import /etc/caddy/conf.d/' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/conf.d/*.caddy\n' >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy

step "ตรวจสอบ"
sleep 2
curl -fsS http://127.0.0.1:3100/api/health >/dev/null && echo "เซิร์ฟเวอร์ license ทำงานแล้ว ✓" || echo "ยังไม่ตอบ — journalctl -u pos-license -n 50"

cat <<EOT

=====================================================================
 แผงควบคุม     : https://$LICENSE_DOMAIN/admin
 ร้านทดลอง     : https://<ร้าน>.$TRIAL_DOMAIN  (สร้างเองเมื่อร้านกรอก license)
 ตัวติดตั้ง      : วาง ClothingPOS-Trial-Setup.exe + latest.yml ที่ /var/www/pos-trial-updates/
 ดู log         : journalctl -u pos-license -f   ·   journalctl -u pos-trial@<ร้าน> -f
 รายชื่อร้าน    : pos-trial-ctl list
=====================================================================
EOT
