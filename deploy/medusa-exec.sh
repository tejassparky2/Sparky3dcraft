#!/usr/bin/env bash
# Run one of the backend's maintenance scripts against the ACTIVE release with
# the production environment, as the sparky user.
#
#   sudo ./deploy/medusa-exec.sh <script> [KEY=value ...]
#
#   sudo ./deploy/medusa-exec.sh send-customer-activation ACTIVATION_MODE=dry-run
#   sudo ./deploy/medusa-exec.sh send-customer-activation ACTIVATION_MODE=send ACTIVATION_LIMIT=100
#   sudo ./deploy/medusa-exec.sh apply-personalization
#   sudo ./deploy/medusa-exec.sh setup-store SPARKY_STORE_CONFIG=/etc/sparky/store.config.json
#
# Only scripts shipped in apps/backend/src/scripts are allowed (no arbitrary code).
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
require_root
[ $# -ge 1 ] || die "usage: $0 <script> [KEY=value ...]   (scripts: $(ls "$SPARKY_CURRENT/apps/backend/.medusa/server/src/scripts" 2>/dev/null | sed -n 's/\.js$//p' | tr '\n' ' '))"
name=${1%.js}
name=${name%.ts}
shift
[[ "$name" =~ ^[a-z0-9-]+$ ]] || die "invalid script name: $name"
srv="$SPARKY_CURRENT/apps/backend/.medusa/server"
[ -f "$srv/src/scripts/$name.js" ] || die "no such script in the active release: $name"
extra=()
for kv in "$@"; do
  [[ "$kv" =~ ^[A-Z_][A-Z0-9_]*=.*$ ]] || die "arguments must be KEY=value, got: $kv"
  extra+=("$kv")
done
(
  load_env_file "$SPARKY_BACKEND_ENV"
  cd "$srv"
  exec sudo -u "$SPARKY_USER" -H --preserve-env env HOME="$SPARKY_HOME" "${extra[@]}" npx medusa exec "./src/scripts/$name.js"
)
