#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit): (1) block writing secrets into tracked files,
# (2) ask the user before changing protected deploy/security files or the hook
# configuration itself. Never modifies anything.
set -uo pipefail
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
content=$(printf '%s' "$input" | jq -r '[.tool_input.content, .tool_input.new_string, (.tool_input.edits // [] | .[].new_string)] | map(select(. != null)) | join("\n")')
[ -n "$path" ] || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
rel=${path#"$root"/}

# 1) secrets: allowed only in git-ignored local env files (never committed)
if printf '%s' "$content" | grep -Eq 'rzp_live_[A-Za-z0-9]{8,}|rzp_test_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|shpat_[a-f0-9]{16,}|sk_live_[A-Za-z0-9]{10,}'; then
  if ! git -C "$root" check-ignore -q "$path" 2>/dev/null; then
    echo "BLOCKED by .claude/hooks/guard-edit.sh: content for $rel looks like a real credential, and the file is tracked by git. Use a placeholder (REPLACE_ME) and keep real values in /etc/sparky or a git-ignored .env." >&2
    exit 2
  fi
fi

# 2) protected files: require explicit user confirmation
case "$rel" in
  .claude/settings.json | .claude/settings.local.json | .claude/hooks/*)
    reason="hook configuration — changes must be visible to and approved by the user" ;;
  deploy/systemd/* | deploy/nginx/* | deploy/lib/common.sh | deploy/postgres/* | deploy/redis/*)
    reason="production deploy file (service hardening / exposure / shared installer library)" ;;
  apps/backend/src/lib/env.ts | apps/backend/src/modules/razorpay/* | apps/backend/src/api/hooks/razorpay/*)
    reason="security-critical code (production env validation / payment verification)" ;;
  *) exit 0 ;;
esac
jq -n --arg r "Protected file $rel: $reason. Confirm this change." \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
exit 0
