#!/usr/bin/env bash
# Collects diagnostics WITHOUT secrets (env values are redacted).
#   sudo ./deploy/diagnose.sh > diag.txt
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
require_root
h() { printf '\n===== %s =====\n' "$1"; }
redact() { sed -E 's/^([A-Z0-9_]*(SECRET|PASS|PASSWORD|TOKEN|KEY|DATABASE_URL|REDIS_URL)[A-Z0-9_]*)=.*/\1=<redacted>/'; }
h "system"; uname -a; cat /etc/os-release | head -3; nproc; free -h; df -h /; uptime
h "versions"; node -v 2>&1; npm -v 2>&1; psql --version; redis-server --version; nginx -v 2>&1
h "release"; readlink -f "$SPARKY_CURRENT" || true; ls -1t "$SPARKY_RELEASES" 2>/dev/null | head -5; cat "$SPARKY_STATE_DIR/migrated-release" 2>/dev/null || true
h "installer state"; ls -l "$SPARKY_STATE_DIR" 2>/dev/null || true
h "services"; systemctl --no-pager --lines=0 status sparky-medusa-server sparky-medusa-worker sparky-storefront nginx postgresql redis-server 2>&1 | grep -E "●|Active:|Main PID" || true
h "listening sockets"; ss -ltnp 2>/dev/null || lsof -iTCP -sTCP:LISTEN -nP
h "env (redacted)"; for f in "$SPARKY_BACKEND_ENV" "$SPARKY_STOREFRONT_ENV"; do echo "# $f"; redact <"$f" 2>/dev/null || true; done
h "nginx -t"; nginx -t 2>&1 || true
h "journal: medusa server"; journalctl -u sparky-medusa-server -n 80 --no-pager 2>&1 | redact || true
h "journal: medusa worker"; journalctl -u sparky-medusa-worker -n 80 --no-pager 2>&1 | redact || true
h "journal: storefront"; journalctl -u sparky-storefront -n 60 --no-pager 2>&1 | redact || true
h "firewall"; iptables -L INPUT -n --line-numbers 2>/dev/null | head -20 || true
h "health"; "$DEPLOY_DIR/healthcheck.sh" 2>&1 || true
