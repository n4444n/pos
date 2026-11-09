#!/usr/bin/env bash
# จัดการ instance ร้านทดลอง — เรียกโดยเซิร์ฟเวอร์ license ผ่าน sudo (ติดตั้งที่ /usr/local/bin/pos-trial-ctl)
#   pos-trial-ctl create <ร้าน> <พอร์ต>   (อ่าน PIN ผู้จัดการ 6 หลักจาก stdin)
#   pos-trial-ctl start|stop|status <ร้าน>
#   pos-trial-ctl delete <ร้าน>          ปิด + ย้ายข้อมูลไป /var/lib/pos-trial/_deleted (ชื่อเดิมใช้ใหม่ได้โดยไม่เห็นข้อมูลร้านเก่า)
# ทุกร้านเข้าผ่านประตูเดียวของเซิร์ฟเวอร์ license (โดเมนของแอป) — ไม่มีโดเมนย่อยต่อร้านแล้ว
#   pos-trial-ctl list
# ระบบสำรองข้อมูลทั้งระบบ (license-server/sysbackup.ts) — <เป้าหมาย> = @main (ร้านหลัก /var/lib/pos) หรือชื่อร้านทดลอง
#   pos-trial-ctl data-init                          สร้าง /var/lib/pos-backups (ของ poslic)
#   pos-trial-ctl data-stat <เป้าหมาย>                เวลาแก้ไขล่าสุดของฐานข้อมูล (ms) · missing = ไม่มี
#   pos-trial-ctl data-snap <เป้าหมาย> <งาน> <0|1>     สำเนาฐานข้อมูล (+ รูปสินค้าถ้า 1) ไป /var/lib/pos-backups/.staging/<งาน>
#   pos-trial-ctl data-restore <เป้าหมาย> <งาน>        หยุดร้าน → เก็บไฟล์เดิมใน .restore-old → วางไฟล์จาก .staging/<งาน> → เปิดร้าน
#   pos-trial-ctl data-rollback <เป้าหมาย>             ย้อนกลับไปใช้ไฟล์ใน .restore-old
# ตรวจค่าทุกตัวเข้มงวด เพราะรันเป็น root
set -euo pipefail

DATA_ROOT=/var/lib/pos-trial
ENV_DIR=/etc/pos-trial
CADDY_DIR=/etc/caddy/trials   # รุ่นเก่าเคยสร้างโดเมนย่อยต่อร้านไว้ที่นี่ — ลบทิ้งเมื่อลบร้าน
PORT_MIN=3101
PORT_MAX=3999
BK_ROOT=/var/lib/pos-backups
STAGE=$BK_ROOT/.staging

die() { echo "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "ต้องรันด้วย root"

job_ok() { [[ "$1" =~ ^[a-z0-9-]{1,60}$ ]] || die "ชื่องานไม่ถูกต้อง: $1"; }
# เป้าหมาย → T_DIR (โฟลเดอร์ข้อมูล) T_DB (ฐานข้อมูล) T_SVC (บริการ)
target_of() {
  if [ "$1" = "@main" ]; then T_DIR=/var/lib/pos; T_SVC=pos
  else slug_ok "$1"; T_DIR="$DATA_ROOT/$1"; T_SVC="pos-trial@$1"; fi
  T_DB="$T_DIR/pos.db"
}
ms_of() { if [ -e "$1" ]; then date -r "$1" +%s%3N; else echo 0; fi; }

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
  data-init)
    mkdir -p "$STAGE"
    chown poslic:poslic "$BK_ROOT" "$STAGE" && chmod 700 "$BK_ROOT" "$STAGE"
    ;;
  data-stat)
    target_of "${2:-}"
    if [ ! -f "$T_DB" ]; then echo missing; exit 0; fi
    a=$(ms_of "$T_DB"); b=$(ms_of "$T_DB-wal")
    if [ "$a" -gt "$b" ]; then echo "$a"; else echo "$b"; fi
    ;;
  data-snap)
    target_of "${2:-}"; job_ok "${3:-}"
    [ -f "$T_DB" ] || die "ยังไม่มีฐานข้อมูลของร้านนี้"
    command -v sqlite3 >/dev/null || die "ต้องติดตั้ง sqlite3 ก่อน: apt install -y sqlite3"
    out="$STAGE/$3"
    rm -rf "$out" && mkdir -p "$out"
    tmp="$T_DIR/.snap-$3.db"
    rm -f "$tmp"
    # VACUUM INTO ด้วยผู้ใช้ pos = สำเนาสมบูรณ์แม้ร้านกำลังขาย (ถ้าใช้ root ไฟล์ -wal/-shm อาจกลายเป็นของ root แล้วร้านเปิดฐานข้อมูลไม่ได้)
    if ! runuser -u pos -- sqlite3 -bail -cmd ".timeout 15000" "$T_DB" "VACUUM INTO '$tmp'"; then rm -f "$tmp"; die "สำเนาฐานข้อมูลไม่สำเร็จ"; fi
    mv "$tmp" "$out/pos.db"
    if [ -f "$T_DIR/.pin-secret" ]; then cp -p "$T_DIR/.pin-secret" "$out/.pin-secret"; fi
    if [ "${4:-0}" = 1 ] && [ -d "$T_DIR/uploads" ]; then cp -a "$T_DIR/uploads" "$out/uploads"; fi
    chown -R poslic:poslic "$out" && chmod -R u+rwX,go-rwx "$out"
    echo ok
    ;;
  data-restore)
    target_of "${2:-}"; job_ok "${3:-}"
    src="$STAGE/$3"
    [ -f "$src/pos.db" ] || die "ไม่พบไฟล์ที่จะกู้คืน"
    [ "$(head -c 15 "$src/pos.db")" = "SQLite format 3" ] || die "ไฟล์ที่จะกู้คืนไม่ใช่ฐานข้อมูล SQLite"
    if [ "$2" != "@main" ] && [ ! -f "$ENV_DIR/$2.env" ]; then die "ยังไม่มีร้าน $2 บนเครื่องนี้"; fi
    was=0
    if systemctl is-active --quiet "$T_SVC"; then was=1; fi
    systemctl stop "$T_SVC" || true
    mkdir -p "$T_DIR"
    old="$T_DIR/.restore-old"
    rm -rf "$old" && mkdir -p "$old" && chmod 700 "$old"
    for f in pos.db pos.db-wal pos.db-shm; do
      if [ -e "$T_DIR/$f" ]; then mv "$T_DIR/$f" "$old/$f"; fi
    done
    if [ -f "$src/.pin-secret" ]; then
      if [ -e "$T_DIR/.pin-secret" ]; then mv "$T_DIR/.pin-secret" "$old/.pin-secret"; fi
      cp "$src/.pin-secret" "$T_DIR/.pin-secret"
    fi
    if [ -d "$src/uploads" ]; then
      if [ -e "$T_DIR/uploads" ]; then mv "$T_DIR/uploads" "$old/uploads"; fi
      cp -a "$src/uploads" "$T_DIR/uploads"
    fi
    cp "$src/pos.db" "$T_DB"
    chown -R pos:pos "$T_DIR"
    chmod 600 "$T_DB"
    if [ -f "$T_DIR/.pin-secret" ]; then chmod 600 "$T_DIR/.pin-secret"; fi
    if [ "$was" = 1 ]; then systemctl start "$T_SVC"; echo started; else echo stopped; fi
    ;;
  data-rollback)
    target_of "${2:-}"
    old="$T_DIR/.restore-old"
    [ -d "$old" ] || die "ไม่มีไฟล์เดิมให้ย้อนกลับ"
    systemctl stop "$T_SVC" || true
    rm -f "$T_DB" "$T_DB-wal" "$T_DB-shm"
    for f in "$old"/* "$old/.pin-secret"; do
      [ -e "$f" ] || continue
      n=$(basename "$f")
      rm -rf "${T_DIR:?}/$n"
      mv "$f" "$T_DIR/$n"
    done
    rm -rf "$old"
    chown -R pos:pos "$T_DIR"
    systemctl start "$T_SVC"
    echo started
    ;;
  *) die "ใช้: $0 create <ร้าน> <พอร์ต> | start|stop|status|delete <ร้าน> | list | data-init | data-stat|data-snap|data-restore|data-rollback ..." ;;
esac
