# shellcheck shell=bash
# Common helpers for the Sparky deployment scripts. Sourced, never executed.
#
# Conventions:
#   - every script runs with `set -Eeuo pipefail`
#   - output uses [PASS] [WARN] [FAIL] [SKIP] [INFO]
#   - secrets are never echoed; only variable NAMES are printed
#   - stages are idempotent and record completion in $SPARKY_STATE_DIR

# ---------------------------------------------------------------- layout
SPARKY_USER=${SPARKY_USER:-sparky}
SPARKY_HOME=${SPARKY_HOME:-/opt/sparky}
SPARKY_ETC=${SPARKY_ETC:-/etc/sparky}
SPARKY_VAR=${SPARKY_VAR:-/var/lib/sparky}
SPARKY_STATE_DIR=${SPARKY_STATE_DIR:-$SPARKY_VAR/state}
SPARKY_LOG_DIR=${SPARKY_LOG_DIR:-/var/log/sparky}
SPARKY_BACKUP_DIR=${SPARKY_BACKUP_DIR:-/var/backups/sparky}
SPARKY_RELEASES=${SPARKY_RELEASES:-$SPARKY_HOME/releases}
SPARKY_CURRENT=${SPARKY_CURRENT:-$SPARKY_HOME/current}
SPARKY_BACKEND_ENV=${SPARKY_BACKEND_ENV:-$SPARKY_ETC/backend.env}
SPARKY_STOREFRONT_ENV=${SPARKY_STOREFRONT_ENV:-$SPARKY_ETC/storefront.env}
SPARKY_INSTALL_CONF=${SPARKY_INSTALL_CONF:-$SPARKY_ETC/install.conf}
SPARKY_SECRETS=${SPARKY_SECRETS:-$SPARKY_ETC/secrets.env}
SPARKY_STORE_CONFIG=${SPARKY_STORE_CONFIG:-$SPARKY_ETC/store.config.json}
DEPLOY_DIR=${DEPLOY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
REPO_DIR=${REPO_DIR:-$(cd "$DEPLOY_DIR/.." && pwd)}

# ---------------------------------------------------------------- output
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_G=$'\e[32m' C_Y=$'\e[33m' C_R=$'\e[31m' C_B=$'\e[36m' C_D=$'\e[2m' C_0=$'\e[0m'
else
  C_G="" C_Y="" C_R="" C_B="" C_D="" C_0=""
fi
# Keep the original terminal on fds 3/4 so failure reports reach the operator
# even when the failing command's output is redirected to the log.
if [ -z "${SPARKY_FDS_SET:-}" ]; then
  exec 3>&1 4>&2
  SPARKY_FDS_SET=1
fi
CURRENT_STAGE=${CURRENT_STAGE:-init}
CURRENT_CMD=""
# Each entry script sets SPARKY_LOG (the installer exports it to children).
SPARKY_LOG=${SPARKY_LOG:-}

_log() { if [ -n "$SPARKY_LOG" ]; then printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$SPARKY_LOG" 2>/dev/null || true; fi; }
pass() { printf '%s[PASS]%s %s\n' "$C_G" "$C_0" "$*"; _log "[PASS] $*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_Y" "$C_0" "$*"; _log "[WARN] $*"; }
fail() { printf '%s[FAIL]%s %s\n' "$C_R" "$C_0" "$*" >&2; _log "[FAIL] $*"; }
skip() { printf '%s[SKIP]%s %s\n' "$C_D" "$C_0" "$*"; _log "[SKIP] $*"; }
info() { printf '%s[INFO]%s %s\n' "$C_B" "$C_0" "$*"; _log "[INFO] $*"; }
die() {
  fail "$*"
  exit 1
}

# Run a command, logging it (the command line is logged, never its secret env).
run() {
  CURRENT_CMD="$*"
  _log "\$ $*"
  "$@" >>"${SPARKY_LOG:-/dev/null}" 2>&1
}

# Error trap: explains where it failed and whether a re-run is safe.
on_error() {
  local code=$? line=${1:-?}
  # subshells inherit the ERR trap (set -E); report once, from the main shell
  if [ "${BASH_SUBSHELL:-0}" -gt 0 ]; then exit "$code"; fi
  exec 1>&3 2>&4
  fail "stage: ${CURRENT_STAGE}"
  fail "command: ${CURRENT_CMD:-<see log>} (line ${line}, exit ${code})"
  if [ -f "$SPARKY_LOG" ]; then
    fail "last log lines:"
    tail -n 15 "$SPARKY_LOG" 2>/dev/null | sed 's/^/        /' >&2 || true
  fi
  fail "likely cause: $(likely_cause "$CURRENT_STAGE")"
  fail "diagnose:  sudo $DEPLOY_DIR/diagnose.sh   (full log: $SPARKY_LOG)"
  fail "re-run is safe: completed stages are skipped and every stage is idempotent."
  exit "$code"
}

likely_cause() {
  case "$1" in
    system) echo "apt/network problem or unsupported OS" ;;
    node) echo "NodeSource repository unreachable or wrong architecture" ;;
    database) echo "PostgreSQL not running, or the medusa role password does not match" ;;
    redis) echo "Redis failed to start with the Sparky config (check journalctl -u redis-server)" ;;
    medusa) echo "npm install/build failure (network, RAM) or migration error — see log" ;;
    storefront) echo "Next.js build failure; the Medusa server must be reachable during the build" ;;
    storage) echo "S3/OCI credentials, endpoint, bucket name or bucket policy are wrong" ;;
    migration) echo "Shopify source unreachable or credentials/scopes missing" ;;
    systemd) echo "a service failed to start — journalctl -u sparky-* -n 100" ;;
    nginx) echo "nginx config test failed or another service uses port 80/443" ;;
    tls) echo "DNS does not point at this server yet, or ports 80/443 are closed in OCI security lists" ;;
    tests) echo "a health or smoke check failed — see the check output above" ;;
    *) echo "see the log" ;;
  esac
}

# ---------------------------------------------------------------- state
stage_done() { [ -f "$SPARKY_STATE_DIR/$1.done" ]; }
mark_done() {
  mkdir -p "$SPARKY_STATE_DIR"
  date -u +%FT%TZ >"$SPARKY_STATE_DIR/$1.done"
}
clear_stage() { rm -f "$SPARKY_STATE_DIR/$1.done"; }

# ---------------------------------------------------------------- checks
require_root() { [ "$(id -u)" -eq 0 ] || die "run as root: sudo $0"; }
have() { command -v "$1" >/dev/null 2>&1; }

arch() {
  case "$(uname -m)" in
    aarch64 | arm64) echo arm64 ;;
    x86_64 | amd64) echo amd64 ;;
    *) echo unsupported ;;
  esac
}

# ---------------------------------------------------------------- config
# Reads KEY=VALUE files without executing them (values may contain $ etc).
conf_get() {
  local file=$1 key=$2
  [ -f "$file" ] || return 1
  local line
  line=$(grep -E "^${key}=" "$file" | tail -n 1) || return 1
  printf '%s' "${line#*=}"
}

# Sets KEY=VALUE in a file (creates it), replacing an existing key.
conf_set() {
  local file=$1 key=$2 value=$3 tmp
  touch "$file"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$file" >"$tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

gen_secret() { openssl rand -hex "${1:-32}"; }

# Returns an existing secret from $SPARKY_SECRETS or generates + stores one.
secret() {
  local key=$1 len=${2:-32} v
  v=$(conf_get "$SPARKY_SECRETS" "$key" 2>/dev/null || true)
  if [ -z "$v" ]; then
    v=$(gen_secret "$len")
    (umask 077 && conf_set "$SPARKY_SECRETS" "$key" "$v")
  fi
  printf '%s' "$v"
}

# Interactive prompt with default; non-interactive (SPARKY_NONINTERACTIVE=1)
# uses env var of the same name or the default, or fails if required.
ask() {
  local var=$1 question=$2 default=${3:-} required=${4:-yes} value
  value=${!var:-}
  if [ -z "$value" ]; then value=$(conf_get "$SPARKY_INSTALL_CONF" "$var" 2>/dev/null || conf_get "$SPARKY_SECRETS" "$var" 2>/dev/null || true); fi
  if [ -z "$value" ] && [ "${SPARKY_NONINTERACTIVE:-0}" != 1 ] && [ -t 0 ]; then
    read -r -p "$question${default:+ [$default]}: " value
  fi
  value=${value:-$default}
  if [ -z "$value" ] && [ "$required" = yes ]; then die "missing required answer: $var ($question)"; fi
  printf -v "$var" '%s' "$value"
  export "${var?}"
  # secrets go to the root-only secrets file, never to install.conf
  case "$var" in
    *PASSWORD* | *SECRET* | *TOKEN* | *ACCESS_KEY*) (umask 077 && conf_set "$SPARKY_SECRETS" "$var" "$value") ;;
    *) conf_set "$SPARKY_INSTALL_CONF" "$var" "$value" ;;
  esac
}

ask_secret() {
  local var=$1 question=$2 value
  value=${!var:-}
  if [ -z "$value" ]; then value=$(conf_get "$SPARKY_SECRETS" "$var" 2>/dev/null || true); fi
  if [ -z "$value" ] && [ "${SPARKY_NONINTERACTIVE:-0}" != 1 ] && [ -t 0 ]; then
    read -r -s -p "$question (input hidden, empty = skip): " value
    echo
  fi
  if [ -n "$value" ]; then
    (umask 077 && conf_set "$SPARKY_SECRETS" "$var" "$value")
  fi
  printf -v "$var" '%s' "$value"
  export "${var?}"
}

# Render a template replacing {{KEY}} with the value of $KEY.
render() {
  local src=$1 dst=$2 content key
  content=$(cat "$src")
  for key in $(grep -oE '\{\{[A-Z0-9_]+\}\}' "$src" | sort -u | tr -d '{}'); do
    [ -n "${!key+x}" ] || die "template $src needs $key"
    content=${content//\{\{$key\}\}/${!key}}
  done
  printf '%s\n' "$content" >"$dst"
}

# Write file only if content changed; returns 0 if changed, 1 otherwise.
install_if_changed() {
  local src=$1 dst=$2 mode=${3:-0644} owner=${4:-root:root}
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    rm -f "$src"
    return 1
  fi
  install -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$src" "$dst"
  rm -f "$src"
  return 0
}

# Run as the service user. Standard proxy/CA variables are passed through when
# the operator has set them (hosts behind an egress proxy); nothing else leaks.
as_sparky() {
  local pass=() v
  for v in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy NODE_EXTRA_CA_CERTS; do
    if [ -n "${!v:-}" ]; then pass+=("$v=${!v}"); fi
  done
  sudo -u "$SPARKY_USER" -H env HOME="$SPARKY_HOME" "${pass[@]}" "$@"
}

# Export KEY=VALUE lines from a systemd-style EnvironmentFile WITHOUT evaluating
# them (values may contain spaces, $, quotes). Comments/blank lines skipped.
load_env_file() {
  local file=$1 line key val
  [ -f "$file" ] || die "$file not found — run install.sh first"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    key=${line%%=*}
    val=${line#*=}
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key=$val"
  done <"$file"
}

load_backend_env() { load_env_file "$SPARKY_BACKEND_ENV"; }

# PostgreSQL connection pieces from DATABASE_URL (postgres://user:pass@host:port/db)
db_parse() {
  local url=${DATABASE_URL:?DATABASE_URL not set} rest
  rest=${url#*://}
  DB_USER=${rest%%:*}
  rest=${rest#*:}
  DB_PASS=${rest%%@*}
  rest=${rest#*@}
  DB_HOST=${rest%%:*}
  rest=${rest#*:}
  DB_PORT=${rest%%/*}
  DB_NAME=${rest#*/}
  DB_NAME=${DB_NAME%%\?*}
  export DB_USER DB_PASS DB_HOST DB_PORT DB_NAME
}

pg_env() { PGPASSWORD="$DB_PASS" "$@"; }

# Releases are named <UTC timestamp>-<sha>; newest first by name (mtime is not reliable).
list_releases() { find "$SPARKY_RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -r; }
# A release can be switched to only when both apps were fully built.
release_complete() {
  [ -d "$1/apps/backend/.medusa/server/node_modules" ] && [ -f "$1/apps/storefront/.next/BUILD_ID" ]
}

# Numbered migration files shipped with a release (Medusa core modules + ours).
migration_manifest() {
  (cd "$1/apps/backend/.medusa/server" 2>/dev/null && find . -path '*/migrations/*' -name 'Migration[0-9]*.js' | sort) || true
}
# Record which release (and which migration set) the database was migrated to.
record_migrated() {
  basename "$1" >"$SPARKY_STATE_DIR/migrated-release"
  migration_manifest "$1" >"$SPARKY_STATE_DIR/migrated-manifest"
}

wait_http() {
  local url=$1 tries=${2:-60}
  for _ in $(seq 1 "$tries"); do
    if curl -fs -o /dev/null --max-time 5 "$url" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
