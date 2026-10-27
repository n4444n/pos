#!/usr/bin/env bash
# จัดการ instance ร้านทดลอง — เรียกโดยเซิร์ฟเวอร์ license ผ่าน sudo (ติดตั้งที่ /usr/local/bin/pos-trial-ctl)
#   pos-trial-ctl create <ร้าน> <พอร์ต>   (อ่าน PIN ผู้จัดการ 6 หลักจาก stdin)
#   pos-trial-ctl start|stop|status <ร้าน>
#   pos-trial-ctl delete <ร้าน>          ปิด + ย้ายข้อมูลไป /var/lib/pos-trial/_deleted (ชื่อเดิมใช้ใหม่ได้โดยไม่เห็นข้อมูลร้านเก่า)
# ทุกร้านเข้าผ่านประตูเดียวของเซิร์ฟเวอร์ license (โดเมนของแอป) — ไม่มีโดเมนย่อยต่อร้านแล้ว
#   pos-trial-ctl list
# ตรวจค่าทุกตัวเข้มงวด เพราะรันเป็น root
set -euo pipefail

DATA_ROOT=/var/lib/pos-trial
ENV_DIR=/etc/pos-trial
CADDY_DIR=/etc/caddy/trials   # รุ่นเก่าเคยสร้างโดเมนย่อยต่อร้านไว้ที่นี่ — ลบทิ้งเมื่อลบร้าน
PORT_MIN=3101
PORT_MAX=3999

die() { echo "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "ต้องรันด้วย root"

slug_ok() { [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$ ]] || die "ชื่อร้านไม่ถูกต้อง: $1"; }

cmd="${1:-}"
case "$cmd" in
  create)
    slug="${2:-}"; port="${3:-}"
    slug_ok "$slug"
    [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge $PORT_MIN ] && [ "$port" -le $PORT_MAX ] || die "พอร์ตต้องอยู่ระหว่าง $PORT_MIN–$PORT_MAX"
    read -r pin || true
    [[ "$pin" =~ ^[0-9]{6}$ ]] || die "PIN ต้องเป็นตัวเลข 6 หลัก"
    read -r token || true
    [[ -z "$token" || "$token" =~ ^[a-f0-9]{64}$ ]] || die "token ไม่ถูกต้อง"
    if ss -ltnH "sport = :$port" | grep -q .; then die "พอร์ต $port ถูกใช้อยู่"; fi

    mkdir -p "$DATA_ROOT/$slug" "$ENV_DIR"
    chown pos:pos "$DATA_ROOT" "$DATA_ROOT/$slug" && chmod 750 "$DATA_ROOT/$slug"
    umask 077
    printf 'PORT=%s\nPOS_MANAGER_PIN=%s\nPOS_INTERNAL_TOKEN=%s\n' "$port" "$pin" "$token" > "$ENV_DIR/$slug.env"
    umask 022
    systemctl enable --now "pos-trial@$slug"
    echo "สร้างร้าน $slug (พอร์ต $port) — เข้าผ่านประตูของเซิร์ฟเวอร์ license"
    ;;
  start)
    slug_ok "${2:-}"
    [ -f "$ENV_DIR/$2.env" ] || die "ยังไม่มีร้าน $2"
    # token API ภายใน (stdin) — ร้านที่สร้างก่อนมีระบบนี้จะได้ token ตอนเปิดครั้งถัดไป
    read -r token || true
    if [[ "$token" =~ ^[a-f0-9]{64}$ ]] && ! grep -qx "POS_INTERNAL_TOKEN=$token" "$ENV_DIR/$2.env"; then
      umask 077
      { grep -v '^POS_INTERNAL_TOKEN=' "$ENV_DIR/$2.env" || true; echo "POS_INTERNAL_TOKEN=$token"; } > "$ENV_DIR/$2.env.new"
      mv "$ENV_DIR/$2.env.new" "$ENV_DIR/$2.env"
      umask 022
      systemctl is-active --quiet "pos-trial@$2" && systemctl restart "pos-trial@$2"
    fi
    systemctl enable --now "pos-trial@$2"
    ;;
  stop)
    slug_ok "${2:-}"
    systemctl disable --now "pos-trial@$2" 2>/dev/null || true
    ;;
  delete)
    slug_ok "${2:-}"
    systemctl disable --now "pos-trial@$2" 2>/dev/null || true
    rm -f "$ENV_DIR/$2.env"
    if [ -f "$CADDY_DIR/$2.caddy" ]; then rm -f "$CADDY_DIR/$2.caddy"; systemctl reload caddy || true; fi
    if [ -d "$DATA_ROOT/$2" ]; then
      mkdir -p "$DATA_ROOT/_deleted" && chmod 700 "$DATA_ROOT/_deleted"
      dest="$DATA_ROOT/_deleted/$2-$(date +%Y%m%d-%H%M%S)"
      mv "$DATA_ROOT/$2" "$dest"
      echo "ย้ายข้อมูลไป $dest"
    fi
    ;;
  status)
    slug_ok "${2:-}"
    systemctl is-active "pos-trial@$2" || true
    ;;
  list)
    systemctl list-units --all --no-legend 'pos-trial@*' || true
    ;;
  *) die "ใช้: $0 create <ร้าน> <พอร์ต> | start|stop|status|delete <ร้าน> | list" ;;
esac
