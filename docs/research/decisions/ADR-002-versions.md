# ADR-002: Version pins

- **Status:** accepted (2026-09-24)

## Question
Which versions do we build on, and how do they change?

## Current evidence (npm registry and vendor pages, 2026-09-24)
- `@medusajs/medusa` **2.21.1** is `latest` (published 2026-09-22). 2.22 is only a snapshot/preview.
- `next` **16.3.6** is `latest` (2026-09-22) with no known advisories. Stay at or above 16.3.3 for the AVIF RCE fix.
- React 19.3.0 and TypeScript 5.9.3. TypeScript 7 (native) is not yet supported by Medusa's tooling.
- Node **22.23.3** LTS "Jod". Medusa requires Node ≥ 20. Next 16 requires ≥ 20.9.
- PostgreSQL 16.15 and Redis 7.0.15 (noble-updates).

## Sources
- `docs/research/VERSIONS.md` (full table)
- `docs/research/external/medusa-release-notes.md`, `nextjs16.md`, `oci.md`

## Options
Latest stable, a preview/canary, or an older, "battle-tested" minor.

## Chosen
Latest **stable** of each. Core packages (Medusa, Next.js, React, runtime deps) are pinned exactly, and all installs are locked by `package-lock.json` + `npm ci` (see VERSIONS.md §Policy).

## Reason
- The 2.18→2.21 release notes contain security fixes (the Store API field-filter bypass in 2.20.1) and the strict field allowlist, and our code is written against those.
- Previews are excluded by policy.

## Tradeoffs
New releases may have undiscovered bugs. This is mitigated by the test suite and staging verification.

## Impact
- `upgrade.sh` refuses a Medusa version change without `--confirm-medusa-upgrade`.
- `npm update` / `medusa upgrade` are never run implicitly.
- Transitive security fixes are applied only as targeted, reviewed `overrides` (for example `lodash` 4.18.1).

## Verification
- Typecheck, 39 unit tests, 37 E2E tests and a production build all pass on these versions.
- `final-verification.sh` checks the installed Medusa version against the lock.
