#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit): fast per-file format/lint feedback.
#   storefront *.ts/*.tsx/*.mjs → eslint --fix (the only formatter configured in this repo)
#   deploy/**/*.sh            → shellcheck (warning level)
#   *.json                    → JSON syntax check
# Exit 2 reports remaining problems to Claude; the edit itself is never reverted.
set -uo pipefail
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
[ -n "$path" ] && [ -f "$path" ] || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
rel=${path#"$root"/}
out=""
case "$rel" in
  apps/storefront/*.ts | apps/storefront/*.tsx | apps/storefront/*.mjs)
    if [ -x "$root/apps/storefront/node_modules/.bin/eslint" ]; then
      out=$(cd "$root/apps/storefront" && timeout 60 ./node_modules/.bin/eslint --fix "${rel#apps/storefront/}" 2>&1) || true
    fi ;;
  deploy/*.sh | .claude/hooks/*.sh)   # a case-pattern * also matches "/"
    if command -v shellcheck >/dev/null; then
      out=$(cd "$root" && LC_ALL=C.UTF-8 shellcheck -x -S warning "$rel" 2>&1) || true
    fi ;;
  *.json)
    case "$rel" in *tsconfig*.json) exit 0 ;; esac   # tsconfig allows comments
    out=$(jq empty "$path" 2>&1) || true ;;
esac
if [ -n "$out" ]; then
  echo "post-edit check for $rel reported problems:" >&2
  printf '%s\n' "$out" | tail -40 >&2
  exit 2
fi
exit 0
