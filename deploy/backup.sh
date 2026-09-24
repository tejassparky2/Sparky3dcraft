#!/usr/bin/env bash
# Sparky backup: PostgreSQL dump + configuration + private uploads + metadata.
#   sudo ./deploy/backup.sh [--tag NAME] [--quiet]
# Local: /var/backups/sparky/<UTC timestamp>-<tag>/ (root-only, rotated).
# Remote (optional, BACKUP_S3_BUCKET): AES-256 encrypted copies — the key is
# BACKUP_ENCRYPTION_KEY in /etc/sparky/secrets.env; keep an offline copy of it.
# Safe to re-run: every run creates a new timestamped backup.
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
TAG=manual QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG=$2; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    *) die "unknown argument $1" ;;
  esac
done
require_root
CURRENT_STAGE=backup
SPARKY_LOG=${SPARKY_LOG:-$SPARKY_LOG_DIR/backup.log}
trap 'on_error $LINENO' ERR
say() { [ "$QUIET" = 1 ] || "$@"; }

load_backend_env
db_parse
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$SPARKY_BACKUP_DIR/$TS-$TAG"
install -d -m 0700 "$OUT"

CURRENT_CMD="pg_dump medusa_db"
pg_env pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=6 --no-owner --file="$OUT/db.dump"
pg_restore --list "$OUT/db.dump" >/dev/null || die "dump is not readable by pg_restore"
say pass "database dump $(du -h "$OUT/db.dump" | cut -f1)"

CURRENT_CMD="archive configuration"
CFG=("${SPARKY_ETC#/}")
for extra in etc/nginx/sites-available/sparky etc/redis/sparky.conf; do if [ -e "/$extra" ]; then CFG+=("$extra"); fi; done
tar -czf "$OUT/config.tgz" -C / "${CFG[@]}"
tar -tzf "$OUT/config.tgz" >/dev/null
say pass "configuration archived (contains secrets — root only)"

if [ -d "$SPARKY_VAR/private-uploads" ] && [ -n "$(ls -A "$SPARKY_VAR/private-uploads" 2>/dev/null)" ]; then
  tar -czf "$OUT/private-uploads.tgz" -C "$SPARKY_VAR" private-uploads
  tar -tzf "$OUT/private-uploads.tgz" >/dev/null
  say pass "customer personalization uploads archived"
fi

count() { pg_env psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null || echo "?"; }
jq -n \
  --arg ts "$TS" --arg tag "$TAG" \
  --arg release "$(readlink -f "$SPARKY_CURRENT" 2>/dev/null || echo none)" \
  --arg products "$(count "select count(*) from product where deleted_at is null")" \
  --arg orders "$(count "select count(*) from \"order\" where deleted_at is null")" \
  --arg customers "$(count "select count(*) from customer where deleted_at is null")" \
  --arg mappings "$(count "select count(*) from sparky_source_mapping")" \
  '{created_at: $ts, tag: $tag, release: $release, counts: {products: ($products|tonumber? // $products), orders: ($orders|tonumber? // $orders), customers: ($customers|tonumber? // $customers), source_mappings: ($mappings|tonumber? // $mappings)}}' >"$OUT/manifest.json"
(cd "$OUT" && sha256sum ./* >SHA256SUMS)
chmod -R go-rwx "$OUT"
say pass "manifest + checksums written: $OUT"

# ----- remote copy (encrypted)
BACKUP_S3_BUCKET=${BACKUP_S3_BUCKET:-$(conf_get "$SPARKY_INSTALL_CONF" BACKUP_S3_BUCKET 2>/dev/null || true)}
if [ -n "$BACKUP_S3_BUCKET" ]; then
  export BACKUP_S3_BUCKET
  KEY=$(secret BACKUP_ENCRYPTION_KEY 32)
  TMPENC=$(mktemp -d)
  tar -cf "$TMPENC/bundle.tar" -C "$OUT" .
  CURRENT_CMD="openssl enc (backup bundle)"
  KEY="$KEY" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$TMPENC/bundle.tar" -out "$TMPENC/bundle.tar.enc" -pass env:KEY
  CURRENT_CMD="upload backup to $BACKUP_S3_BUCKET"
  (cd "$SPARKY_CURRENT/apps/backend/.medusa/server" && node "$DEPLOY_DIR/scripts/s3-backup.mjs" put "$TMPENC/bundle.tar.enc" "sparky-backups/$TS-$TAG.tar.enc") >>"$SPARKY_LOG" 2>&1
  rm -rf "$TMPENC"
  echo "$TS-$TAG" >"$SPARKY_STATE_DIR/last-remote-backup"
  say pass "encrypted copy uploaded to s3://$BACKUP_S3_BUCKET/sparky-backups/$TS-$TAG.tar.enc"
  (cd "$SPARKY_CURRENT/apps/backend/.medusa/server" && node "$DEPLOY_DIR/scripts/s3-backup.mjs" prune sparky-backups/ "${BACKUP_REMOTE_RETENTION_DAYS:-60}") >>"$SPARKY_LOG" 2>&1 || warn "remote prune failed"
else
  say warn "no off-machine backup bucket configured (BACKUP_S3_BUCKET) — backups exist on this VPS only"
fi

# ----- rotation (keep at least 3 regardless of age)
RET=${BACKUP_RETENTION_DAYS:-$(conf_get "$SPARKY_INSTALL_CONF" BACKUP_RETENTION_DAYS 2>/dev/null || echo 14)}
mapfile -t ALL < <(ls -1dt "$SPARKY_BACKUP_DIR"/2*Z-* 2>/dev/null || true)
if [ "${#ALL[@]}" -gt 3 ]; then
  for d in "${ALL[@]:3}"; do
    if [ -n "$(find "$d" -maxdepth 0 -mtime +"$RET" 2>/dev/null)" ]; then rm -rf "$d" && say info "rotated out $(basename "$d")"; fi
  done
fi
echo "$OUT" >"$SPARKY_STATE_DIR/last-backup"
say pass "backup complete"
