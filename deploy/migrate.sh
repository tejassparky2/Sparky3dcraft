#!/usr/bin/env bash
# Shopify → Medusa migration on the server (idempotent, re-runnable).
#   sudo ./deploy/migrate.sh              dry-run only (shows what would change)
#   sudo ./deploy/migrate.sh --apply      backup → dry-run → apply → verify
#   sudo ./deploy/migrate.sh --probe      (admin source) validate token/scopes/schema
# Source settings come from /etc/sparky/install.conf (MIGRATION_SOURCE etc.)
# and /etc/sparky/secrets.env (SHOPIFY_ADMIN_TOKEN). Shopify is only READ.
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
require_root
CURRENT_STAGE=migration
SPARKY_LOG=${SPARKY_LOG:-$SPARKY_LOG_DIR/migrate-$(date -u +%Y%m%dT%H%M%SZ).log}
trap 'on_error $LINENO' ERR
MODE=dry-run
case "${1:-}" in --apply) MODE=apply ;; --probe) MODE=probe ;; "") ;; *) die "unknown argument $1" ;; esac

SRC=${MIGRATION_SOURCE:-$(conf_get "$SPARKY_INSTALL_CONF" MIGRATION_SOURCE)}
[ "$SRC" != skip ] || die "MIGRATION_SOURCE=skip in $SPARKY_INSTALL_CONF"
SERVER_DIR="$SPARKY_CURRENT/apps/backend/.medusa/server"
[ -d "$SERVER_DIR" ] || die "no built backend at $SERVER_DIR"

env_args=(SHOPIFY_SOURCE="$SRC" SHOPIFY_SNAPSHOT_DIR="$SPARKY_VAR/migration-snapshots")
case "$SRC" in
  public) env_args+=(SHOPIFY_STORE_URL="${SHOPIFY_STORE_URL:-$(conf_get "$SPARKY_INSTALL_CONF" SHOPIFY_STORE_URL)}" "IMPORT_ENTITIES=products,collections") ;;
  admin)
    env_args+=(SHOPIFY_SHOP_DOMAIN="${SHOPIFY_SHOP_DOMAIN:-$(conf_get "$SPARKY_INSTALL_CONF" SHOPIFY_SHOP_DOMAIN)}"
      SHOPIFY_ADMIN_TOKEN="${SHOPIFY_ADMIN_TOKEN:-$(conf_get "$SPARKY_SECRETS" SHOPIFY_ADMIN_TOKEN)}"
      IMPORT_ENTITIES="${SHOPIFY_IMPORT_ENTITIES:-$(conf_get "$SPARKY_INSTALL_CONF" SHOPIFY_IMPORT_ENTITIES || echo products,collections)}")
    ;;
  csv) env_args+=(SHOPIFY_CSV_PATH="${SHOPIFY_CSV_PATH:-$(conf_get "$SPARKY_INSTALL_CONF" SHOPIFY_CSV_PATH)}" "IMPORT_ENTITIES=products") ;;
  *) die "unknown MIGRATION_SOURCE $SRC" ;;
esac

importer() {
  (
    load_env_file "$SPARKY_BACKEND_ENV"
    # exported (not passed as arguments) so tokens never appear in `ps`
    export "${env_args[@]}" IMPORT_MODE="$1"
    cd "$SERVER_DIR" && sudo -u "$SPARKY_USER" -H --preserve-env env HOME="$SPARKY_HOME" npx medusa exec ./src/scripts/import-shopify.js
  )
}
# production logs are JSON lines; print just the importer's message text
summary() { grep -E "\] (products|images|sale prices|inventory|categories|customers|orders):|WARN|ERROR" "$1" | sed -E 's/.*\[shopify-import\] //; s/",".*$//; s/^/        /' || true; }

if [ "$MODE" = probe ]; then
  [ "$SRC" = admin ] || die "--probe is only for MIGRATION_SOURCE=admin"
  importer probe 2>&1 | tee -a "$SPARKY_LOG" | grep "probe:" | sed 's/.*probe: /        /'
  pass "Shopify Admin API probe finished"
  exit 0
fi

tmp=$(mktemp)
CURRENT_CMD="import dry-run ($SRC)"
importer dry-run >"$tmp" 2>&1 || { cat "$tmp" >>"$SPARKY_LOG"; die "dry-run failed"; }
cat "$tmp" >>"$SPARKY_LOG"
info "dry-run ($SRC):"
summary "$tmp"
[ "$MODE" = apply ] || { pass "dry-run complete (nothing written). Use --apply to import."; exit 0; }

"$DEPLOY_DIR/backup.sh" --tag pre-shopify-import --quiet
pass "backup taken before import"
CURRENT_CMD="import apply ($SRC)"
importer apply >"$tmp" 2>&1 || { cat "$tmp" >>"$SPARKY_LOG"; summary "$tmp"; die "import reported errors (re-run is safe; see log)"; }
cat "$tmp" >>"$SPARKY_LOG"
info "apply ($SRC):"
summary "$tmp"
CURRENT_CMD="apply personalization config"
(
  load_env_file "$SPARKY_BACKEND_ENV"
  cd "$SERVER_DIR" && sudo -u "$SPARKY_USER" -H --preserve-env env HOME="$SPARKY_HOME" PERSONALIZATION_FILE="$SPARKY_CURRENT/apps/backend/data/personalization.json" npx medusa exec ./src/scripts/apply-personalization.js
) >>"$SPARKY_LOG" 2>&1
pass "product personalization settings applied"
rm -f "$tmp"
pass "Shopify import applied (re-running is safe: unchanged records are skipped)"
