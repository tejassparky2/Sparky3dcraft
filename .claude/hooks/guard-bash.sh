#!/usr/bin/env bash
# PreToolUse(Bash): block destructive or policy-violating shell commands, and
# scan staged changes for secrets before `git commit`. Never modifies anything.
# Exit 2 = block (stderr is shown to Claude). Exit 0 = allow.
set -uo pipefail
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
[ -n "$cmd" ] || exit 0

block() { echo "BLOCKED by .claude/hooks/guard-bash.sh: $1" >&2; echo "Command: $cmd" >&2; exit 2; }

# destructive filesystem / disk operations
printf '%s' "$cmd" | grep -Eq 'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r[[:space:]]+-f|-f[[:space:]]+-r)[[:space:]]+(/|~|\$HOME|/\*|/opt/sparky|/var/lib/sparky|/var/backups/sparky|/etc/sparky)([[:space:]]|/?$)' \
  && block "recursive delete of a system, home or Sparky data directory"
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])(mkfs(\.[a-z0-9]+)?|wipefs)[[:space:]]' && block "filesystem formatting"
printf '%s' "$cmd" | grep -Eq 'dd[[:space:]].*of=/dev/' && block "raw write to a block device"
# production data
printf '%s' "$cmd" | grep -Eiq '(drop[[:space:]]+database|dropdb)[[:space:]]+("?)(medusa_db)\b' && block "dropping the production database (use deploy/restore.sh, which swaps safely)"
printf '%s' "$cmd" | grep -Eiq 'redis-cli.*[[:space:]](flushall|flushdb)\b' && block "flushing Redis (event queue / workflow state)"
# dependency policy (docs/research/VERSIONS.md)
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])npm[[:space:]]+(update|upgrade|up)\b' && block "npm update is forbidden — change versions deliberately (medusa-research skill)"
printf '%s' "$cmd" | grep -Eq 'npm[[:space:]]+audit[[:space:]]+fix[[:space:]].*--force' && block "npm audit fix --force is forbidden — triage advisories (security-audit skill)"
printf '%s' "$cmd" | grep -Eq '(medusa|npx[[:space:]]+medusa)[[:space:]]+upgrade\b' && block "medusa upgrade is forbidden — use deploy/upgrade.sh with an explicit ref"
# network exposure / firewall on OCI
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])ufw[[:space:]]+enable\b' && block "never enable UFW on OCI Ubuntu images (docs/SECURITY.md)"
# TLS verification must never be disabled
printf '%s' "$cmd" | grep -Eq '(NODE_TLS_REJECT_UNAUTHORIZED=0|strict-ssl[[:space:]=]+false|curl[[:space:]](.*[[:space:]])?(-[a-zA-Z]*k[a-zA-Z]*|--insecure)([[:space:]]|$)|GIT_SSL_NO_VERIFY)' && block "disabling TLS verification"
# git history safety
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push[[:space:]].*(--force|-f)([[:space:]]|$).*\b(main|master)\b' && block "force-push to main/master"

# secret scan of staged changes before a commit
if printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit\b'; then
  root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
  bad_files=$(git -C "$root" diff --cached --name-only --diff-filter=AM | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
  [ -z "$bad_files" ] || block "staged env file(s) would be committed: $bad_files"
  hits=$(git -C "$root" diff --cached -U0 | grep -E '^\+' | grep -vE '^\+\+\+' | grep -nEo 'rzp_live_[A-Za-z0-9]{8,}|rzp_test_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|shpat_[a-f0-9]{16,}|sk_live_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}' | head -5 || true)
  [ -z "$hits" ] || block "staged diff contains what looks like a secret: $(echo "$hits" | sed -E 's/(.{12}).*/\1…/' | tr '\n' ' ')"
fi
exit 0
