#!/usr/bin/env bash
# เตรียม VPS ให้ GitHub Actions ส่งตัวติดตั้งขึ้นมาได้อัตโนมัติ + หน้าดาวน์โหลดที่มีรหัสผ่าน — รันครั้งเดียวด้วย root
#   bash /opt/pos/deploy/release-setup.sh
# รันซ้ำได้: ใช้เปลี่ยนรหัสผ่านหน้าดาวน์โหลด หรือดูค่าที่ต้องใส่ใน GitHub อีกครั้ง
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "ต้องรันด้วย root"; exit 1; }

APP_DIR=/opt/pos
USER_NAME=posrelease                  # ผู้ใช้สำหรับ GitHub Actions — เขียนได้เฉพาะโฟลเดอร์ไฟล์ติดตั้ง
UPDATES_DIR=/var/www/pos-updates      # electron-updater
DOWNLOAD_DIR=/var/www/pos-download    # หน้าดาวน์โหลด (มีรหัสผ่าน)
CI_KEY=/etc/pos/ci_key
DL_HASH_FILE=/etc/pos/download-hash
APP_KEY_FILE=/etc/pos/app-key
mkdir -p /etc/pos && chmod 700 /etc/pos

# 1) ผู้ใช้ + SSH key สำหรับ GitHub Actions
id "$USER_NAME" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$USER_NAME"
mkdir -p "$UPDATES_DIR" "$DOWNLOAD_DIR"
chown -R "$USER_NAME:$USER_NAME" "$UPDATES_DIR" "$DOWNLOAD_DIR"
chmod 755 "$UPDATES_DIR" "$DOWNLOAD_DIR"
[ -f "$CI_KEY" ] || ssh-keygen -q -t ed25519 -N '' -C github-actions-pos -f "$CI_KEY"
H=$(getent passwd "$USER_NAME" | cut -d: -f6)
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$H/.ssh"
install -m 600 -o "$USER_NAME" -g "$USER_NAME" "$CI_KEY.pub" "$H/.ssh/authorized_keys"

# 2) กุญแจแอป (ถ้ายังไม่มี)
if [ ! -s "$APP_KEY_FILE" ]; then
  openssl rand -hex 24 > "$APP_KEY_FILE" && chmod 600 "$APP_KEY_FILE"
fi

# 3) รหัสผ่านหน้าดาวน์โหลด (ชื่อผู้ใช้: shop)
if [ ! -s "$DL_HASH_FILE" ] || [ "${1:-}" = "--password" ]; then
  while :; do
    read -rsp "ตั้งรหัสผ่านหน้าดาวน์โหลด (อย่างน้อย 8 ตัว): " P1; echo
    read -rsp "พิมพ์ซ้ำ: " P2; echo
    [ "$P1" = "$P2" ] && [ ${#P1} -ge 8 ] && break
    echo "รหัสไม่ตรงกันหรือสั้นเกินไป ลองใหม่"
  done
  caddy hash-password --plaintext "$P1" > "$DL_HASH_FILE"
  chmod 600 "$DL_HASH_FILE"
fi
bash "$APP_DIR/deploy/app-lock.sh" reapply >/dev/null

# หน้าแรกของหน้าดาวน์โหลด (GitHub Actions เขียนทับเมื่อมีเวอร์ชันใหม่)
[ -f "$DOWNLOAD_DIR/index.html" ] || cat > "$DOWNLOAD_DIR/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>Clothing POS</title>
<body style="font-family:system-ui;padding:40px">ยังไม่มีไฟล์ติดตั้ง — รอ GitHub Actions build ครั้งแรก</body>
HTML
chown "$USER_NAME:$USER_NAME" "$DOWNLOAD_DIR/index.html"

DOMAIN=$(grep -v '^\s*#' /etc/caddy/Caddyfile | grep -m1 -oE '^[^ {]+')
cat <<EOF

=====================================================================
 ตั้งค่า GitHub: repo n4444n/pos → Settings → Secrets and variables
 → Actions → New repository secret  (สร้าง 3 ตัวนี้)

 ชื่อ: VPS_HOST
 ค่า : $DOMAIN

 ชื่อ: APP_KEY
 ค่า : $(cat "$APP_KEY_FILE")

 ชื่อ: VPS_SSH_KEY
 ค่า : (คัดลอกทั้งหมด รวมบรรทัด BEGIN และ END)
$(cat "$CI_KEY")
=====================================================================
 หน้าดาวน์โหลด: https://$DOMAIN/download/
 ชื่อผู้ใช้: shop · รหัสผ่าน: ที่เพิ่งตั้ง
 เปลี่ยนรหัสผ่าน: bash $APP_DIR/deploy/release-setup.sh --password
=====================================================================
EOF
