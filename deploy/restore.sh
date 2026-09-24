#!/usr/bin/env bash
# Sparky restore.
#
#   sudo ./deploy/restore.sh --verify-latest
#       Restores the newest local backup into a TEMPORARY database, checks
#       products/orders/customers against the backup manifest, drops it.
#       Non-destructive; run by install.sh and final-verification.sh.
#
#   sudo ./deploy/restore.sh --list
#
#   sudo ./deploy/restore.sh --from /var/backups/sparky/<dir> --yes-restore-production [--with-uploads]
#       Replaces the PRODUCTION database with that backup:
#       1) takes a safety backup of the current database
#       2) stops Medusa server/worker + storefront
#       3) restores into a new database, verifies it, then swaps it in
#       4) restarts services and runs the health check
#
#   sudo ./deploy/restore.sh --fetch-remote <name>   (download + decrypt an off-machine backup)
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
require_root
CURRENT_STAGE=restore
SPARKY_LOG=${SPARKY_LOG:-$SPARKY_LOG_DIR/restore.log}
trap 'on_error $LINENO' ERR

MODE="" FROM="" CONFIRM=0 UPLOADS=0 REMOTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --verify-latest) MODE=verify; shift ;;
    --list) MODE=list; shift ;;
    --from) MODE=restore; FROM=$2; shift 2 ;;
    --yes-restore-production) CONFIRM=1; shift ;;
    --with-uploads) UPLOADS=1; shift ;;
    --fetch-remote) MODE=fetch; REMOTE=$2; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$MODE" ] || die "choose --verify-latest, --list, --from <dir> or --fetch-remote <name>"

load_backend_env
db_parse
latest() { ls -1dt "$SPARKY_BACKUP_DIR"/2*Z-* 2>/dev/null | head -1; }
psql_su() { sudo -u postgres psql -q -v ON_ERROR_STOP=1 "$@"; }
count_in() {
  pg_env psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$1" -tAc "$2"
}

verify_dump_into() {
  local dir=$1 db=$2
  (cd "$dir" && sha256sum -c SHA256SUMS >/dev/null) || die "checksum mismatch in $dir"
  pass "checksums OK ($(basename "$dir"))"
  psql_su -c "DROP DATABASE IF EXISTS \"$db\";" -c "CREATE DATABASE \"$db\" OWNER $DB_USER;"
  # extensions (pg_trgm, unaccent) are trusted: the dump recreates them as the owner
  CURRENT_CMD="pg_restore into $db"
  pg_env pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$db" --no-owner --exit-on-error "$dir/db.dump" >>"$SPARKY_LOG" 2>&1
  local k want got
  for k in products orders customers; do
    want=$(jq -r ".counts.$k" "$dir/manifest.json")
    case $k in
      products) got=$(count_in "$db" "select count(*) from product where deleted_at is null") ;;
      orders) got=$(count_in "$db" "select count(*) from \"order\" where deleted_at is null") ;;
      customers) got=$(count_in "$db" "select count(*) from customer where deleted_at is null") ;;
    esac
    [ "$want" = "$got" ] || die "restored $k=$got but manifest says $want"
    pass "restored $k: $got (matches manifest)"
  done
}

case "$MODE" in
  list)
    ls -1dt "$SPARKY_BACKUP_DIR"/2*Z-* 2>/dev/null | while read -r d; do
      printf '%s  %s  %s\n' "$(basename "$d")" "$(du -sh "$d" | cut -f1)" "$(jq -c .counts "$d/manifest.json" 2>/dev/null)"
    done
    ;;
  verify)
    d=$(latest)
    [ -n "$d" ] || die "no local backups in $SPARKY_BACKUP_DIR"
    tmpdb="sparky_restore_check_$$"
    verify_dump_into "$d" "$tmpdb"
    psql_su -c "DROP DATABASE IF EXISTS \"$tmpdb\";"
    date -u +%FT%TZ >"$SPARKY_STATE_DIR/last-restore-verify"
    echo "$(basename "$d")" >>"$SPARKY_STATE_DIR/last-restore-verify"
    pass "restore verified in a temporary database (dropped afterwards)"
    ;;
  fetch)
    KEY=$(conf_get "$SPARKY_SECRETS" BACKUP_ENCRYPTION_KEY) || die "BACKUP_ENCRYPTION_KEY not in $SPARKY_SECRETS (restore it from your offline copy first)"
    BACKUP_S3_BUCKET=${BACKUP_S3_BUCKET:-$(conf_get "$SPARKY_INSTALL_CONF" BACKUP_S3_BUCKET)}
    export BACKUP_S3_BUCKET
    tmp=$(mktemp -d)
    (cd "$SPARKY_CURRENT/apps/backend/.medusa/server" && node "$DEPLOY_DIR/scripts/s3-backup.mjs" get "sparky-backups/$REMOTE.tar.enc" "$tmp/b.enc")
    KEY="$KEY" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$tmp/b.enc" -out "$tmp/b.tar" -pass env:KEY
    out="$SPARKY_BACKUP_DIR/$REMOTE"
    install -d -m 0700 "$out"
    tar -xf "$tmp/b.tar" -C "$out"
    rm -rf "$tmp"
    (cd "$out" && sha256sum -c SHA256SUMS >/dev/null) || die "checksum mismatch after download"
    pass "remote backup fetched and decrypted to $out"
    ;;
  restore)
    [ -d "$FROM" ] || die "backup directory not found: $FROM"
    [ "$CONFIRM" = 1 ] || die "refusing to overwrite production without --yes-restore-production"
    info "1/5 safety backup of the current database"
    "$DEPLOY_DIR/backup.sh" --tag pre-restore --quiet
    newdb="${DB_NAME}_restore_$$"
    info "2/5 restoring into $newdb and verifying"
    verify_dump_into "$FROM" "$newdb"
    info "3/5 stopping services"
    systemctl stop sparky-storefront sparky-medusa-worker sparky-medusa-server
    info "4/5 swapping databases"
    old="${DB_NAME}_replaced_$(date -u +%Y%m%d%H%M%S)"
    psql_su -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB_NAME','$newdb') AND pid <> pg_backend_pid();" >/dev/null
    psql_su -c "ALTER DATABASE \"$DB_NAME\" RENAME TO \"$old\";" -c "ALTER DATABASE \"$newdb\" RENAME TO \"$DB_NAME\";"
    pass "database swapped (previous database kept as $old — drop it manually after verifying)"
    if [ "$UPLOADS" = 1 ] && [ -f "$FROM/private-uploads.tgz" ]; then
      tar -xzf "$FROM/private-uploads.tgz" -C "$SPARKY_VAR"
      chown -R "$SPARKY_USER:$SPARKY_USER" "$SPARKY_VAR/private-uploads"
      pass "private uploads restored"
    fi
    info "5/5 starting services"
    systemctl start sparky-medusa-server sparky-medusa-worker sparky-storefront
    wait_http http://127.0.0.1:9000/health 90 || die "medusa did not start after restore"
    "$DEPLOY_DIR/healthcheck.sh" || warn "health check reported problems after restore"
    pass "production restored from $(basename "$FROM")"
    ;;
esac
