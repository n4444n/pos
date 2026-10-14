#!/usr/bin/env bash
# ติดตั้ง Clothing POS บน VPS (Ubuntu 24.04) — รันครั้งเดียวด้วย root
#   sudo bash /opt/pos/deploy/setup-vps.sh pos.greenthread.online
# รันซ้ำได้ (ขั้นที่ทำไปแล้วจะข้าม)
set -euo pipefail

DOMAIN="${1:?ใช้งาน: bash deploy/setup-vps.sh pos.example.com}"
APP_DIR=/opt/pos
DATA_DIR=/var/lib/pos            # ฐานข้อมูล + รูปสินค้า + .pin-secret
BACKUP_DIR=/var/backups/pos
UPDATES_DIR=/var/www/pos-updates # ไฟล์อัปเดตแอป .exe (electron-updater)

[ "$(id -u)" = 0 ] || { echo "ต้องรันด้วย root"; exit 1; }
[ -f "$APP_DIR/server/index.ts" ] || { echo "ไม่พบโค้ดที่ $APP_DIR — git clone ก่อน"; exit 1; }

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

step "ตั้งเวลาเครื่องเป็นเวลาไทย (บิล/รายงานใช้เวลาเครื่อง)"
timedatectl set-timezone Asia/Bangkok

step "อัปเดตระบบ + ติดตั้งเครื่องมือ"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git sqlite3 ufw ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades   # อัปเดตความปลอดภัยอัตโนมัติ

step "ติดตั้ง Node.js 24"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

step "ติดตั้ง Caddy (HTTPS อัตโนมัติ)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

step "เพิ่ม swap 2 GB (ช่วยตอน build หน้าเว็บบนเครื่อง RAM 4 GB)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "สร้างผู้ใช้ระบบ 'pos' และโฟลเดอร์ข้อมูล"
id pos >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin pos
mkdir -p "$DATA_DIR" "$BACKUP_DIR" "$UPDATES_DIR"
chown pos:pos "$DATA_DIR" && chmod 750 "$DATA_DIR"
chown pos:pos "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
chmod 755 "$UPDATES_DIR"

step "ติดตั้งแพ็กเกจ + build หน้าเว็บ (ครั้งแรกใช้เวลาหลายนาที)"
cd "$APP_DIR"
npm install --no-audit --no-fund
npm run build:web

step "ตั้งค่าบริการ pos (systemd)"
install -m 644 "$APP_DIR/deploy/pos.service" /etc/systemd/system/pos.service
systemctl daemon-reload
systemctl enable --now pos
systemctl restart pos

step "ตั้งค่า Caddy สำหรับ $DOMAIN"
sed "s/{\$POS_DOMAIN}/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy || systemctl restart caddy

step "สำรองข้อมูลอัตโนมัติทุกวัน 02:30"
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/pos-backup
install -m 755 "$APP_DIR/deploy/update.sh" /usr/local/bin/pos-update
echo '30 2 * * * root /usr/local/bin/pos-backup >> /var/log/pos-backup.log 2>&1' > /etc/cron.d/pos-backup

step "Firewall: เปิดเฉพาะ SSH / HTTP / HTTPS"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

step "ตรวจสอบ"
sleep 3
if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
  echo "เซิร์ฟเวอร์ POS ทำงานแล้ว ✓"
else
  echo "เซิร์ฟเวอร์ยังไม่ตอบ — ดู log: journalctl -u pos -n 50"
fi

cat <<EOF

=====================================================================
 เสร็จแล้ว
 เปิดใช้งาน : https://$DOMAIN   (ต้องตั้ง DNS ชี้มาที่ VPS นี้ก่อน)
 PIN เริ่มต้น: journalctl -u pos | grep PIN    ← เข้าแล้วเปลี่ยน PIN ทันที
 ดู log     : journalctl -u pos -f
 อัปเดตโค้ด : pos-update
 สำรองทันที : pos-backup   (ไฟล์อยู่ที่ $BACKUP_DIR)
=====================================================================
EOF
