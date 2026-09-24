#!/usr/bin/env bash
# Sparky 3D Craft Co — one-command installer for Ubuntu 24.04 (ARM64/Ampere A1; also x86_64)
#
#   sudo ./deploy/install.sh                     # interactive, STAGING mode (safe default)
#   sudo ./deploy/install.sh --mode production   # production cutover configuration
#   sudo SPARKY_NONINTERACTIVE=1 ./deploy/install.sh --answers /path/answers.env
#   sudo ./deploy/install.sh --from-stage nginx  # re-run from a stage
#   sudo ./deploy/install.sh --only tests        # run a single stage
#
# PLAN → VALIDATE → INSTALL → CONFIGURE → BUILD → START → TEST → REPORT
# Every stage is idempotent; completed stages are skipped on re-run.
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"

STAGES=(preflight system node database redis existing medusa storage storefront migration systemd nginx tls backups tests)
MODE_ARG="" FROM="" ONLY="" ANSWERS="" RESET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE_ARG=$2; shift 2 ;;
    --from-stage) FROM=$2; shift 2 ;;
    --only) ONLY=$2; shift 2 ;;
    --answers) ANSWERS=$2; shift 2 ;;
    --reset-state) RESET=1; shift ;;
    --non-interactive) export SPARKY_NONINTERACTIVE=1; shift ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown argument $1" ;;
  esac
done

require_root
mkdir -p "$SPARKY_ETC" "$SPARKY_STATE_DIR" "$SPARKY_LOG_DIR"
chmod 0750 "$SPARKY_ETC"
SPARKY_LOG="$SPARKY_LOG_DIR/install-$(date -u +%Y%m%dT%H%M%SZ).log"
export SPARKY_LOG
touch "$SPARKY_LOG" && chmod 0600 "$SPARKY_LOG"
trap 'on_error $LINENO' ERR

if [ -n "$ANSWERS" ]; then
  [ -f "$ANSWERS" ] || die "answers file not found: $ANSWERS"
  set -a
  # shellcheck disable=SC1090
  . "$ANSWERS"
  set +a
fi
if [ "$RESET" = 1 ]; then rm -f "$SPARKY_STATE_DIR"/*.done && info "installer state reset"; fi
if [ -n "$MODE_ARG" ]; then export SPARKY_MODE=$MODE_ARG; fi

for f in "$DEPLOY_DIR"/scripts/*.sh; do
  # shellcheck disable=SC1090
  . "$f"
done

echo
echo "SPARKY 3D CRAFT — self-hosted commerce installer"
echo "log: $SPARKY_LOG"
echo

# ---------------------------------------------------------------- answers
collect_answers
print_plan

run_stage() {
  local s=$1
  CURRENT_STAGE=$s
  if [ -z "$ONLY" ] && stage_done "$s" && [[ "${FORCE_STAGES:-}" != *"$s"* ]]; then
    skip "stage $s (already completed $(cat "$SPARKY_STATE_DIR/$s.done"))"
    return 0
  fi
  info "── stage: $s"
  "stage_$s"
  mark_done "$s"
}

started=0
for s in "${STAGES[@]}"; do
  if [ -n "$ONLY" ]; then
    if [ "$s" = "$ONLY" ]; then run_stage "$s"; fi
    continue
  fi
  if [ -n "$FROM" ] && [ "$started" = 0 ]; then
    [ "$s" = "$FROM" ] || { skip "stage $s (before --from-stage $FROM)"; continue; }
    started=1
    rm -f "$SPARKY_STATE_DIR/$s.done"
    FORCE_STAGES="${STAGES[*]}"
  fi
  run_stage "$s"
done

CURRENT_STAGE=report
print_report
