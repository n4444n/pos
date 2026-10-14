#!/usr/bin/env bash
# ล็อกเซิร์ฟเวอร์ให้ใช้ได้เฉพาะแอป .exe (เปิด URL ในเบราว์เซอร์จะได้ 403)
#   bash /opt/pos/deploy/app-lock.sh key      สร้าง/แสดงกุญแจ → ใส่ใน desktop\app-key.txt ก่อน build
#   bash /opt/pos/deploy/app-lock.sh on       เปิดล็อก (ทำหลังทุกสาขาอัปเดตเป็นแอปที่มีกุญแจแล้ว)
#   bash /opt/pos/deploy/app-lock.sh off      ปิดล็อก (เปิดผ่านเบราว์เซอร์ได้อีกครั้ง)
#   bash /opt/pos/deploy/app-lock.sh status
set -euo pipefail
APP_DIR=/opt/pos
KEY_FILE=/etc/pos/app-key
CADDYFILE=/etc/caddy/Caddyfile
[ "$(id -u)" = 0 ] || { echo "ต้องรันด้วย root"; exit 1; }

# โดเมน = บรรทัดแรกที่ไม่ใช่คอมเมนต์ของ Caddyfile ปัจจุบัน (เช่น pos.sh0p.tech)
domain() { grep -v '^\s*#' "$CADDYFILE" | grep -m1 -oE '^[^ {]+'; }

apply() { # $1 = template
  local d k tmp
  d=$(domain); k=$(cat "$KEY_FILE" 2>/dev/null || true)
  tmp=$(mktemp)
  sed -e "s/{\$POS_DOMAIN}/$d/g" -e "s/{\$POS_APP_KEY}/$k/g" "$1" > "$tmp"
  caddy validate --config "$tmp" --adapter caddyfile >/dev/null
  cp "$CADDYFILE" "$CADDYFILE.bak"
  install -m 640 -o root -g caddy "$tmp" "$CADDYFILE"
  rm -f "$tmp"
  systemctl reload caddy
}

case "${1:-status}" in
  key)
    if [ ! -s "$KEY_FILE" ]; then
      mkdir -p /etc/pos && chmod 700 /etc/pos
      openssl rand -hex 24 > "$KEY_FILE" && chmod 600 "$KEY_FILE"
      echo "สร้างกุญแจใหม่แล้ว"
    fi
    echo "กุญแจแอป (คัดลอกทั้งบรรทัดไปใส่ในไฟล์ desktop\\app-key.txt บนเครื่องที่ build):"
    echo
    cat "$KEY_FILE"
    ;;
  on)
    [ -s "$KEY_FILE" ] || { echo "ยังไม่มีกุญแจ — รัน: bash $0 key"; exit 1; }
    apply "$APP_DIR/deploy/Caddyfile.locked"
    echo "ล็อกแล้ว ✓  https://$(domain) ใช้ได้เฉพาะแอป .exe ที่มีกุญแจ"
    echo "ทดสอบ: เปิด URL ใน Chrome ต้องขึ้น 403 · แอปที่ร้านต้องใช้งานได้ตามปกติ"
    ;;
  off)
    apply "$APP_DIR/deploy/Caddyfile"
    echo "ปลดล็อกแล้ว — เปิดผ่านเบราว์เซอร์ได้"
    ;;
  status)
    if grep -q 'X-POS-App' "$CADDYFILE"; then echo "สถานะ: ล็อกอยู่ (เฉพาะแอป)"; else echo "สถานะ: ไม่ล็อก (เบราว์เซอร์เข้าได้)"; fi
    [ -s "$KEY_FILE" ] && echo "กุญแจ: มีแล้ว ($KEY_FILE)" || echo "กุญแจ: ยังไม่มี"
    ;;
  *) echo "ใช้: $0 key|on|off|status"; exit 1 ;;
esac
