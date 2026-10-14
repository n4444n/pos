#!/usr/bin/env bash
# สำรองฐานข้อมูล + รูปสินค้า (รันได้ขณะระบบเปิดขายอยู่) · เก็บย้อนหลัง 30 วัน
set -euo pipefail
DATA_DIR=/var/lib/pos
BACKUP_DIR=/var/backups/pos
KEEP_DAYS=30
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR" && chown pos:pos "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
# รัน sqlite3 ด้วยผู้ใช้ pos — ถ้ารันด้วย root ไฟล์ -wal/-shm อาจกลายเป็นของ root แล้วเซิร์ฟเวอร์เปิดฐานข้อมูลไม่ได้
# VACUUM INTO = สำเนาที่สมบูรณ์แม้ฐานข้อมูลกำลังถูกเขียน (ห้าม cp ไฟล์ .db ตรงๆ เพราะใช้โหมด WAL)
runuser -u pos -- sqlite3 "$DATA_DIR/pos.db" "VACUUM INTO '$BACKUP_DIR/pos-$STAMP.db'"
sqlite3 "$BACKUP_DIR/pos-$STAMP.db" "PRAGMA integrity_check" | grep -qx ok || { echo "[backup] integrity check FAILED"; exit 1; }
gzip "$BACKUP_DIR/pos-$STAMP.db"

# รูปสินค้า + .pin-secret (ไม่มีไฟล์นี้ PIN เดิมทั้งหมดจะใช้ไม่ได้)
tar -czf "$BACKUP_DIR/files-$STAMP.tar.gz" -C "$DATA_DIR" --ignore-failed-read uploads .pin-secret 2>/dev/null || true

find "$BACKUP_DIR" -name 'pos-*.db.gz' -mtime +$KEEP_DAYS -delete
find "$BACKUP_DIR" -name 'files-*.tar.gz' -mtime +$KEEP_DAYS -delete
echo "[backup] $(date '+%F %T') ok → $BACKUP_DIR/pos-$STAMP.db.gz ($(du -h "$BACKUP_DIR/pos-$STAMP.db.gz" | cut -f1))"
