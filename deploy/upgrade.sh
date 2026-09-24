#!/usr/bin/env bash
# Controlled upgrade to an explicit git ref. Never "latest" implicitly.
#   sudo ./deploy/upgrade.sh --ref <tag|branch|sha> [--confirm-medusa-upgrade]
#
# git status clean → fetch → version check → BACKUP → build new release
# (backend build, typecheck, unit tests, storefront build — the old release
# keeps serving meanwhile) → stop Medusa → migrate → switch → start →
# restart storefront → health check.  Failure after the
# switch rolls back to the previous release automatically; the pre-upgrade
# backup is kept for a database restore (rollback.sh --restore-db).
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# This script checks out another git ref in the repository it lives in. Bash
# reads scripts lazily, so run from a frozen copy of deploy/ to never execute
# a half-old, half-new script.
if [ -z "${SPARKY_UPGRADE_FROZEN:-}" ]; then
  [ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
  frozen=$(mktemp -d /tmp/sparky-upgrade.XXXXXX)
  cp -a "$DEPLOY_DIR" "$frozen/deploy"
  REPO_DIR=$(cd "$DEPLOY_DIR/.." && pwd) SPARKY_UPGRADE_FROZEN="$frozen" exec "$frozen/deploy/upgrade.sh" "$@"
fi
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
require_root
export REPO_DIR
SPARKY_DIAGNOSE="$REPO_DIR/deploy/diagnose.sh"
SPARKY_RERUN_HINT="nothing was switched unless a rollback message says otherwise; the site keeps serving $(readlink -f "$SPARKY_CURRENT"). Fix the cause and re-run."
trap 'rm -rf "${SPARKY_UPGRADE_FROZEN:?}"' EXIT
REF="" CONFIRM_MEDUSA=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF=$2; shift 2 ;;
    --confirm-medusa-upgrade) CONFIRM_MEDUSA=1; shift ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$REF" ] || die "--ref is required (tag, branch or commit to deploy)"
SPARKY_LOG="$SPARKY_LOG_DIR/upgrade-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$SPARKY_LOG" && chmod 600 "$SPARKY_LOG"
trap 'on_error $LINENO' ERR
for f in "$DEPLOY_DIR"/scripts/*.sh; do
  # shellcheck disable=SC1090
  . "$f"
done
# answers from the original install
while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done <"$SPARKY_INSTALL_CONF"

CURRENT_STAGE=preflight
[ -z "$(git -C "$REPO_DIR" status --porcelain)" ] || die "working tree $REPO_DIR is not clean (git status)"
run git -C "$REPO_DIR" fetch --tags origin
PREV_RELEASE=$(readlink -f "$SPARKY_CURRENT")
cur_ver=$(jq -r '.dependencies["@medusajs/medusa"]' "$PREV_RELEASE/apps/backend/package.json")
new_ver=$(git -C "$REPO_DIR" show "$REF:apps/backend/package.json" | jq -r '.dependencies["@medusajs/medusa"]')
info "Medusa: current $cur_ver → target $new_ver"
if [ "$cur_ver" != "$new_ver" ] && [ "$CONFIRM_MEDUSA" != 1 ]; then
  die "Medusa version changes. Read https://github.com/medusajs/medusa/releases for every version between, then re-run with --confirm-medusa-upgrade"
fi
info "commits: $(git -C "$REPO_DIR" log --oneline "HEAD..$REF" | wc -l) new"

CURRENT_STAGE=backup
"$DEPLOY_DIR/backup.sh" --tag pre-upgrade
PRE_BACKUP=$(cat "$SPARKY_STATE_DIR/last-backup")

CURRENT_STAGE=build
run git -C "$REPO_DIR" checkout --detach "$REF"
new_release
build_backend
CURRENT_CMD="typecheck + unit tests"
(cd "$RELEASE_DIR/apps/backend" && as_sparky npm run -s typecheck && as_sparky npm run -s test:unit) >>"$SPARKY_LOG" 2>&1 || die "typecheck/unit tests failed on $REF — nothing was switched"
CURRENT_CMD="storefront build (old release keeps serving)"
build_storefront "$RELEASE_DIR"
release_complete "$RELEASE_DIR" || die "release $RELEASE_DIR is incomplete — nothing was switched"
pass "new release built and tested: $RELEASE_DIR"

rollback_now() {
  fail "upgrade failed after switching — rolling back to $PREV_RELEASE"
  ln -sfn "$PREV_RELEASE" "$SPARKY_HOME/.current.tmp" && mv -T "$SPARKY_HOME/.current.tmp" "$SPARKY_CURRENT"
  trap - ERR
  systemctl restart sparky-medusa-server sparky-medusa-worker sparky-storefront || true
  if wait_http http://127.0.0.1:9000/health 90 && wait_http http://127.0.0.1:3000/robots.txt 60; then
    pass "previous release is serving again: $PREV_RELEASE"
  else
    fail "previous release did NOT come back healthy — run: sudo $REPO_DIR/deploy/healthcheck.sh"
  fi
  fail "code rolled back. If migrations changed the schema incompatibly: sudo $REPO_DIR/deploy/rollback.sh --restore-db $PRE_BACKUP"
  exit 1
}

CURRENT_STAGE=migrate
info "stopping Medusa for migrations (storefront keeps serving cached pages)"
systemctl stop sparky-medusa-worker sparky-medusa-server
run_migrations "$RELEASE_DIR/apps/backend/.medusa/server" || rollback_now
trap 'rollback_now' ERR
activate_release
systemctl start sparky-medusa-server sparky-medusa-worker
wait_http http://127.0.0.1:9000/health 120 || rollback_now
wait_http http://127.0.0.1:9001/health 120 || rollback_now

CURRENT_STAGE=storefront
systemctl restart sparky-storefront
wait_http http://127.0.0.1:3000/robots.txt 60 || rollback_now

CURRENT_STAGE=verify
"$DEPLOY_DIR/healthcheck.sh" || rollback_now
trap - ERR
# keep the 5 newest releases (never the active or the previous one)
list_releases | tail -n +6 | while read -r old; do
  case "$SPARKY_RELEASES/$old" in "$(readlink -f "$SPARKY_CURRENT")" | "$PREV_RELEASE") continue ;; esac
  rm -rf "${SPARKY_RELEASES:?}/$old"
done
pass "upgrade to $REF complete (previous release kept for rollback: $PREV_RELEASE)"
