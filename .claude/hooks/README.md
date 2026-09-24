# Claude Code hooks for this repository

These are registered in `.claude/settings.json`. Every hook is **read-only with respect to data**:
- none deletes files, databases or branches
- none prints or exfiltrates secrets
- none contacts the network

The only file modification is `eslint --fix` on the storefront file that was just edited.
Changing these hooks or `settings.json` triggers an explicit confirmation prompt (guard-edit.sh),
so hook configuration can't be changed silently.

| Hook | Event / matcher | What it does | Blocks? |
|---|---|---|---|
| `guard-bash.sh` | PreToolUse / `Bash` | Refuses destructive or policy-violating commands (listed below). Before `git commit`, it scans the **staged** diff for credentials and staged `.env` files | exit 2 = blocked, reason shown |
| `guard-edit.sh` | PreToolUse / `Edit\|Write\|MultiEdit` | (1) Blocks writing credential-looking values into git-tracked files. Git-ignored local `.env` files are allowed. (2) Asks the user before edits to protected files: hook config, `deploy/systemd`, `deploy/nginx`, `deploy/lib/common.sh`, postgres/redis config, `src/lib/env.ts`, the Razorpay provider and webhook route | exit 2 or `permissionDecision: ask` |
| `post-edit-check.sh` | PostToolUse / `Edit\|Write\|MultiEdit` | Storefront TS/TSX/MJS: `eslint --fix`, then report remaining errors. `deploy/**/*.sh` and hooks: `shellcheck -S warning`. `*.json`: syntax check | reports (exit 2) and never reverts |
| `stop-verify.sh` | Stop | For files changed vs `HEAD`: backend typecheck, storefront typecheck + lint, deploy shellcheck. Skips when nothing relevant changed. `stop_hook_active` prevents loops | exit 2 = keep working until clean |

## Commands `guard-bash.sh` refuses
- recursive delete of `/`, `~`, `/opt/sparky`, `/var/lib/sparky`, `/var/backups/sparky` or `/etc/sparky`
- `mkfs`, `wipefs`, `dd of=/dev/…`
- dropping `medusa_db`; `redis-cli FLUSHALL/FLUSHDB`
- `npm update`, `npm audit fix --force`, `medusa upgrade` (version policy: docs/research/VERSIONS.md)
- `ufw enable` (breaks OCI Ubuntu networking)
- disabling TLS verification: `curl -k`/`--insecure`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `strict-ssl false`, `GIT_SSL_NO_VERIFY`
- force-push to `main`/`master`

## Formatting
No code formatter (Prettier, shfmt) is installed in this repo, and none was added without review.
"Format" therefore means ESLint auto-fixes for the storefront. The backend is checked by `tsc`.

## Requirements
`bash`, `jq`, `git`. Optional: `shellcheck`, and installed `node_modules` in each app (checks
are skipped when a tool is missing, never failed).

## Tested
Each hook was exercised with crafted inputs on 2026-09-24:
- blocked: `rm -rf /`, `rm -rf /var/lib/sparky`, `npm update`, `dropdb medusa_db`, `curl -k`/`-kfsS`/`--insecure`, `ufw enable`, force-push to main, a secret in a tracked file
- allowed: `rm -rf ./node_modules`, `dropdb medusa_db_replaced_*`, normal curl, pushing a feature branch, a secret in a git-ignored `.env`
- asked: an edit to `deploy/nginx/tls.conf`
- Stop loop guard: honoured
