#!/usr/bin/env bash
# Roll back to a previous release (code), optionally restoring the database.
#   sudo ./deploy/rollback.sh --list
#   sudo ./deploy/rollback.sh --previous
#   sudo ./deploy/rollback.sh --to <release-dir-name>
#   sudo ./deploy/rollback.sh --previous --restore-db /var/backups/sparky/<pre-upgrade backup>
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
require_root
SPARKY_LOG="$SPARKY_LOG_DIR/rollback-$(date -u +%Y%m%dT%H%M%SZ).log"
trap 'on_error $LINENO' ERR
TARGET="" DB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) ls -1dt "$SPARKY_RELEASES"/*/ | while read -r r; do printf '%s%s\n' "$(basename "$r")" "$([ "$(readlink -f "$r")" = "$(readlink -f "$SPARKY_CURRENT")" ] && echo '   <- current')"; done; exit 0 ;;
    --previous) TARGET=$(ls -1dt "$SPARKY_RELEASES"/*/ | while read -r r; do [ "$(readlink -f "$r")" = "$(readlink -f "$SPARKY_CURRENT")" ] || { basename "$r"; break; }; done); shift ;;
    --to) TARGET=$2; shift 2 ;;
    --restore-db) DB=$2; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$TARGET" ] && [ -d "$SPARKY_RELEASES/$TARGET" ] || die "no such release: ${TARGET:-<none>} (see --list)"
[ -d "$SPARKY_RELEASES/$TARGET/apps/backend/.medusa/server/node_modules" ] || die "release $TARGET is not built"
CURRENT_STAGE=rollback
info "switching to $TARGET"
ln -sfn "$SPARKY_RELEASES/$TARGET" "$SPARKY_HOME/.current.tmp"
mv -T "$SPARKY_HOME/.current.tmp" "$SPARKY_CURRENT"
if [ -n "$DB" ]; then
  "$DEPLOY_DIR/restore.sh" --from "$DB" --yes-restore-production
  echo "$TARGET" >"$SPARKY_STATE_DIR/migrated-release"
else
  mig=$(cat "$SPARKY_STATE_DIR/migrated-release" 2>/dev/null || true)
  [ "$mig" = "$TARGET" ] || warn "database was migrated by release $mig; if the older code fails, re-run with --restore-db <pre-upgrade backup>"
  systemctl restart sparky-medusa-server sparky-medusa-worker
  wait_http http://127.0.0.1:9000/health 120 || die "medusa not healthy after rollback"
  systemctl restart sparky-storefront
  wait_http http://127.0.0.1:3000/robots.txt 60 || die "storefront not healthy after rollback"
fi
"$DEPLOY_DIR/healthcheck.sh" || warn "health check reports problems"
pass "rolled back to $TARGET"
