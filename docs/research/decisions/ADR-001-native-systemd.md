# ADR-001: Native packages + systemd instead of Docker

- **Status:** accepted (2026-09-24)

## Question
How do we run Medusa, Next.js, PostgreSQL, Redis and nginx on one OCI Ampere A1 VM (2 OCPU / 12 GB, ARM64, Ubuntu 24.04)?

## Current evidence
- Ubuntu 24.04 (noble) ships PostgreSQL 16.15, Redis 7.0.15, nginx and certbot 2.9.0 for arm64 from its own archive.
- NodeSource `node_22.x` publishes arm64 packages (22.23.3).
- Medusa's deployment guide describes two Node processes (server + worker) from one build. It does not require containers.
- OCI Ubuntu images need iptables rules, not UFW. Docker's iptables manipulation interacts with the image's REJECT rule.

## Sources
- `docs/research/external/oci.md` (package versions, iptables/UFW guidance)
- `docs/research/external/medusa-deploy.md`
- https://docs.medusajs.com/learn/deployment/general

## Options
1. Docker Compose (images for Postgres/Redis/Node).
2. Native apt packages + systemd units per process.
3. Managed PaaS (Medusa Cloud, Railway): off the chosen platform, adds recurring cost.

## Chosen
Option 2.

## Reason
- One VM and one tenant. systemd gives restart-on-failure, journald logs, resource hardening (`ProtectSystem=strict`, `NoNewPrivileges`) and boot ordering without an extra daemon.
- It avoids Docker's memory overhead and its iptables interplay on OCI.
- Security updates for Postgres, Redis and nginx come through `unattended-upgrades`.

## Tradeoffs
- Less isolation between processes than containers.
- Upgrades of Postgres major versions are OS-level work.
- The environment is less reproducible on other hosts. The installer compensates by being idempotent and staged.

## Impact
`deploy/install.sh` and `deploy/systemd/*`. Releases are immutable directories with a `current` symlink.

## Verification
A fresh Ubuntu 24.04 systemd container passed:
- install, re-run with identical state, upgrade, rollback
- worker SIGKILL recovery
- reboot recovery (services came back without intervention)

ARM64 is verified only by package availability, **not by a real A1 run**.
