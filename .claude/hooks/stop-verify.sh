#!/usr/bin/env bash
# Stop: before Claude finishes, typecheck/lint/shellcheck whatever changed in
# the working tree (vs HEAD). Exit 2 makes Claude continue and fix the errors.
# Read-only; skips when nothing relevant changed; never loops (stop_hook_active).
set -uo pipefail
input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = true ] && exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
changed=$( (git -C "$root" diff --name-only HEAD; git -C "$root" ls-files --others --exclude-standard) 2>/dev/null | sort -u)
[ -n "$changed" ] || exit 0
fail=""
if echo "$changed" | grep -q '^apps/backend/.*\.tsx\?$' && [ -d "$root/apps/backend/node_modules" ]; then
  o=$(cd "$root/apps/backend" && timeout 300 npm run -s typecheck 2>&1) || fail+=$'\n[backend typecheck]\n'"$(echo "$o" | tail -30)"
fi
if echo "$changed" | grep -q '^apps/storefront/' && [ -d "$root/apps/storefront/node_modules" ]; then
  o=$(cd "$root/apps/storefront" && timeout 300 npm run -s typecheck 2>&1) || fail+=$'\n[storefront typecheck]\n'"$(echo "$o" | tail -30)"
  o=$(cd "$root/apps/storefront" && timeout 300 npm run -s lint 2>&1) || fail+=$'\n[storefront lint]\n'"$(echo "$o" | tail -30)"
fi
if echo "$changed" | grep -q '^deploy/.*\.sh$' && command -v shellcheck >/dev/null; then
  o=$(cd "$root" && LC_ALL=C.UTF-8 shellcheck -x -S warning deploy/*.sh deploy/lib/*.sh deploy/scripts/*.sh 2>&1) || fail+=$'\n[shellcheck deploy]\n'"$(echo "$o" | tail -30)"
fi
if [ -n "$fail" ]; then
  echo "Stop verification failed — fix before finishing:$fail" >&2
  exit 2
fi
exit 0
