#!/usr/bin/env bash
# จัดการ instance ร้านทดลอง — เรียกโดยเซิร์ฟเวอร์ license ผ่าน sudo (ติดตั้งที่ /usr/local/bin/pos-trial-ctl)
#   pos-trial-ctl create <ร้าน> <พอร์ต>   (อ่าน PIN ผู้จัดการ 6 หลักจาก stdin)
#   pos-trial-ctl start|stop|status <ร้าน>
#   pos-trial-ctl delete <ร้าน>          ปิด + ถอดโดเมน + ย้ายข้อมูลไป /var/lib/pos-trial/_deleted (ชื่อเดิมใช้ใหม่ได้โดยไม่เห็นข้อมูลร้านเก่า)
#   pos-trial-ctl list
# ตรวจค่าทุกตัวเข้มงวด เพราะรันเป็น root
set -euo pipefail

DATA_ROOT=/var/lib/pos-trial
ENV_DIR=/etc/pos-trial
CADDY_DIR=/etc/caddy/trials
CONF=/etc/pos-license/env     # TRIAL_DOMAIN=trial.sh0p.tech
PORT_MIN=3101
PORT_MAX=3999

die() { echo "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "ต้องรันด้วย root"
TRIAL_DOMAIN=$(grep -E '^TRIAL_DOMAIN=' "$CONF" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
[[ "$TRIAL_DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "ตั้ง TRIAL_DOMAIN ใน $CONF ก่อน"

slug_ok() { [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$ ]] || die "ชื่อร้านไม่ถูกต้อง: $1"; }

caddy_reload() {
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || {
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >&2 || true
    return 1
  }
  systemctl reload caddy
}

write_caddy() { # $1 slug $2 port
  mkdir -p "$CADDY_DIR"
  cat > "$CADDY_DIR/$1.caddy" <<CADDY
# ร้านทดลอง $1 — สร้างอัตโนมัติโดย pos-trial-ctl
$1.$TRIAL_DOMAIN {
	encode gzip
	respond /api/internal/* 404
	reverse_proxy 127.0.0.1:$2
}
CADDY
}

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
    write_caddy "$slug" "$port"
    if ! caddy_reload; then rm -f "$CADDY_DIR/$slug.caddy"; die "Caddy ไม่ผ่านการตรวจ — ยกเลิก"; fi
    systemctl enable --now "pos-trial@$slug"
    echo "สร้างร้าน $slug → https://$slug.$TRIAL_DOMAIN (พอร์ต $port)"
    ;;
  start)
    slug_ok "${2:-}"
    [ -f "$ENV_DIR/$2.env" ] || die "ยังไม่มีร้าน $2"
    port=$(grep -E '^PORT=' "$ENV_DIR/$2.env" | cut -d= -f2)
    [ -f "$CADDY_DIR/$2.caddy" ] || { write_caddy "$2" "$port"; caddy_reload; }
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
    rm -f "$CADDY_DIR/$2.caddy" "$ENV_DIR/$2.env"
    caddy_reload || true
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
