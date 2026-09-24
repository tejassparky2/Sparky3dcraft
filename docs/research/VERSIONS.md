# Versions (verified 2026-09-24)

These are exact versions from `package-lock.json` and from the Ubuntu 24.04 test install. "Checked
against" names where the current stable version was confirmed. Research notes are in `external/`.

## Application

| Component | Version | Channel | Checked against | Notes |
|---|---|---|---|---|
| `@medusajs/medusa`, `framework`, `js-sdk`, `cli` | **2.21.1** | npm `latest` (published 2026-09-22) | `npm view @medusajs/medusa dist-tags`; GitHub releases v2.18–v2.21.1 | 2.22 exists only as a snapshot/preview, which is excluded |
| `@medusajs/ui` | 4.2.5 | latest compatible | npm | Admin extensions |
| Node.js | **22.23.3** LTS "Jod" | NodeSource `node_22.x` (arm64 + amd64) | nodejs.org release list, NodeSource Release file 2026-09-23 | Medusa ≥ 20, Next ≥ 20.9. `engines: >=22.12.0` |
| `next` | **16.3.6** | npm `latest` (2026-09-22) | npm, GitHub advisories | ≥ 16.3.3 needed for the AVIF RCE fix. Turbopack build |
| `react` / `react-dom` | 19.3.0 | latest | npm | |
| TypeScript | 5.9.3 | latest 5.x | npm | TS 7 (native) not adopted: Medusa tooling is not ready |
| ESLint / eslint-config-next | 10.11.0 / 16.3.6 | latest | npm | flat config. `settings.react.version` pinned to work around a plugin crash |
| `@aws-sdk/client-s3` | 3.1139.0 | latest | npm | used by file-s3 and the backup scripts |
| `nodemailer` | 10.0.10 | latest | npm | SMTP notification provider |
| `sanitize-html` | 2.17.7 | latest | npm | product HTML |
| `sharp` | 0.35.4 | latest | npm | Next image optimization (prebuilt linux-arm64 available) |
| `@playwright/test` | 1.63.0 | latest | npm | E2E |
| jest / @swc/jest | 29.7.0 / 0.2.39 | Medusa's documented test setup | Medusa docs | |
| `lodash` (override) | 4.18.1 | latest | npm, GHSA-r5fr-rjxr-66jc | forced for transitive CLI deps |

## System (Ubuntu 24.04.5 LTS "noble")

| Component | Version | Source |
|---|---|---|
| PostgreSQL | 16.15 | noble-updates |
| Redis | 7.0.15 | noble-updates |
| nginx | 1.24.0 | noble |
| certbot | 2.9.0 | noble |

## Policy

- Medusa, Next.js, React (storefront) and every runtime dependency we added are pinned exactly. Some backend dev/tooling dependencies inherited from Medusa's project template (jest, @types/*, vite and react 18 for Admin extensions) keep `^` ranges. Lockfiles are committed, and servers install with `npm ci`, so installed versions are exact either way.
- Upgrades happen only through `deploy/upgrade.sh --ref`. A Medusa version change needs `--confirm-medusa-upgrade` after reading every release note in between (`.claude/skills/medusa-research`).
- Never `npm update`, `medusa upgrade`, or `npm audit fix --force`.
