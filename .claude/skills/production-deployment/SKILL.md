---
name: production-deployment
description: Install, upgrade, roll back or reconfigure the Sparky stack on the Oracle Cloud VM using the deploy/ package. Use for any server-side change, deploy script change, or incident.
---

# Production deployment

Everything goes through `deploy/`. Never run dev servers, `npm update`, or ad-hoc edits under `/opt/sparky/releases`.

## Procedure
- **Fresh install (staging first):** `sudo ./deploy/install.sh` (docs/DEPLOYMENT.md).
- **Change configuration:** `sudo KEY=value ./deploy/install.sh --from-stage medusa`. Explicit env overrides stored answers.
- **Upgrade code:** `sudo ./deploy/upgrade.sh --ref <sha|tag>`. A Medusa version change additionally needs the medusa-research skill and `--confirm-medusa-upgrade`.
- **Roll back:** `sudo ./deploy/rollback.sh --list`, then `--previous` or `--to <release>`. Add `--restore-db <pre-upgrade backup>` if the schema is incompatible.
- **Incident:** `sudo ./deploy/healthcheck.sh`, then `sudo ./deploy/diagnose.sh`, then docs/TROUBLESHOOTING.md.

## When editing deploy scripts
- `set -Eeuo pipefail`, idempotent, output `[PASS]/[WARN]/[FAIL]/[SKIP]`.
- No `[ cond ] && cmd` as the last command of a function or group: under `set -e` it aborts. Use `if`.
- Parse env files with `load_env_file`. Never `source` them.
- Destructive steps follow BACKUP → VALIDATE BACKUP → CHANGE → VERIFY.
- Never open ports other than 80/443. Never enable UFW on OCI.

## Validation
```bash
shellcheck -x -S warning deploy/*.sh deploy/lib/*.sh deploy/scripts/*.sh
```
Then test in a disposable Ubuntu 24.04 systemd container or VM:
- install, `--reset-state` re-run (identical state)
- `upgrade.sh`, `rollback.sh --previous`
- `restore.sh --verify-latest`
- `final-verification.sh`, including the reboot test

## Expected evidence
- Script output with 0 FAIL.
- `final-verification` report path (`/var/lib/sparky/verification-*.md`).
- Release directory names before and after.

## Failure handling
- `install.sh` failures print stage, command, log tail and likely cause. Fix and re-run: stages are idempotent.
- `upgrade.sh` rolls back automatically after the switch. Before the switch, nothing changed.
- Never force: no editing of state files to skip checks, no disabling of validation in `env.ts`.
