# Final report: Sparky 3D Craft Co migration to Medusa v2

Date: 2026-09-24. Branch: `claude/sparky-medusa-migration-ddclqu`.

## Verdict

**PRODUCTION READY = NO**

The code, the tests and the deployment system are complete. Every check that can run without real
credentials passes on a staging deployment. Going live is blocked by items only the merchant can
provide (section C), and by the mandatory live checks that need them:
- live Razorpay payment and refund
- legal pages
- shipping rate and GST
- SMTP
- OCI buckets
- DNS/TLS
- the first install on real ARM64 hardware

`deploy/final-verification.sh` prints `PRODUCTION READY = YES` only in production mode, with 0 FAIL
and 0 MANUAL. That is the only acceptable source of a YES.

## A. VERIFIED (executed, with evidence)

| Area | What was run | Result |
|---|---|---|
| Backend build | `npm run typecheck`, `npm run build` (Medusa 2.21.1, Node 22.23.3) | pass |
| Backend unit tests | `npm run test:unit`: Razorpay utils and service (paise math, signatures, authorize/capture/refund idempotency), env validation, Shopify normalization | **39/39 pass** |
| Storefront | `npm run typecheck`, `npm run lint`, `next build` (Next 16.3.6) | pass, 0 lint errors |
| Browser E2E | Playwright, desktop + Pixel 7, against the local stack with the Razorpay double and SMTP capture | **37/37 pass**. Covered: browse and search, cart and personalization, Razorpay success/cancel/failure→retry, webhook-only completion, duplicate and forged webhooks, 5 concurrent completions → 1 order, COD authorized, register/login/orders/addresses, password reset by email, contact/newsletter, Admin catalog cycle, mobile |
| Live Shopify import (public source) | dry-run → apply → re-apply against https://sparky3dcraft.tech | 9 products, 27 images and 2 collection images re-hosted, 9 sale prices, 2 categories, 2 videos. Second run: all unchanged |
| Admin API import path | `tests/integration/shopify-import.sh` against a schema-faithful Shopify Admin double | 15/15 checks: idempotent, CSV adoption by handle, customers, historical orders with no payment records |
| Fresh install | `deploy/install.sh` on a clean Ubuntu 24.04.5 systemd container (x86_64), staging mode, S3-compatible emulator | completed. `--reset-state` re-run produced an identical state fingerprint |
| Acceptance gate (staging) | `final-verification.sh --admin-email … --test-order` | **39 PASS**. The only FAILs were ports 2024/2025 owned by the test sandbox's host network (not part of the install). MANUAL: live payment, 4 legal pages |
| Catalog fidelity on server | the same gate: every product's price and compare-at vs the live Shopify JSON, handles, images | all match. No Shopify CDN dependency. Alt text present |
| Redis infrastructure | the gate: event bus, workflow engine, locking and cache on Redis | all Redis. No in-memory modules |
| Admin → storefront | `deploy/tests/catalog-cycle.mjs` on the server | create, edit, price, sale, stock 0, restock, unpublish, republish and delete all reflected |
| COD order | `deploy/tests/cod-order-cycle.mjs` | order visible in Admin as *authorized*, then cancelled |
| Crash recovery | worker SIGKILL | restarted automatically, health OK |
| Reboot recovery | `--prepare-reboot-test`, container restart, re-run | all services back, gate PASS |
| Backup / restore | `backup.sh`, `restore.sh --verify-latest`, production restore with DB swap, `--fetch-remote` | pass. The remote copy decrypts byte-identical |
| Upgrade / rollback | `upgrade.sh --ref <new commit>`, `rollback.sh --previous`, `--to`, incomplete-release refusal | pass. The migration-set comparison avoided a false alarm |
| Upgrade failure paths | Deliberately broken commits: (1) TypeScript error, (2) runtime error after the switch | (1) nothing switched, shop 200 throughout; (2) automatic rollback, previous release verified healthy, shop 200 |
| Private media | `s3-check.mjs`: public bucket anonymously readable, private bucket **not**. The negative test makes the bucket public and the check fails | pass |
| Security checks | secret scans (no credentials in git), `npm audit` triage (storefront 0; backend lodash fixed by override; vite dev-server advisory not applicable), env validation refuses weak production config, hook guards tested | see docs/SECURITY.md |

## B. ASSUMED (from documentation, not executed here)

- **ARM64:** everything runs on Ampere A1 because every component ships arm64 builds: NodeSource `node_22.x`, Ubuntu packages, sharp linux-arm64 prebuilds, and Medusa and Next are pure JS. The installer checks the architecture. (RISKS R-02)
- **OCI Object Storage** behaves like the S3 emulator with our client options: path-style, no ACL, `WHEN_REQUIRED` checksums. (ADR-005)
- **Razorpay** production APIs behave as documented: order and payment entities, webhook signature, refund receipts. (ADR-003)
- **Let's Encrypt** issuance works once DNS points to the VM and ports 80/443 are open in the OCI Security List. The certbot webroot flow is implemented but was never run against the real ACME server.
- **Idle reclamation:** OCI will not reclaim a VM serving real traffic. Converting to Pay-As-You-Go is reported to exempt it (UNVERIFIED).
- **`unattended-upgrades`** is active on the OCI Ubuntu image.

## C. BLOCKED BY EXTERNAL CREDENTIAL OR MERCHANT INPUT

| Item | Needed from | Where it is used |
|---|---|---|
| Razorpay live keys + webhook secret; one live order and refund | merchant's Razorpay account | PAYMENT.md live test (MANUAL gate) |
| Terms, shipping and refund policies; revised privacy policy | merchant/counsel | `content/policies/*.md` (the gate FAILs in production until they are approved) |
| Standard shipping price, free-shipping threshold | merchant | installer (refuses to guess) |
| GST rates / invoicing requirements | merchant's accountant | Admin tax region (no rate invented) |
| SMTP credentials with SPF/DKIM | email provider | order emails, password reset, activation |
| OCI tenancy: A1 VM, buckets, Customer Secret Key | merchant's OCI account | install |
| DNS changes and TLS | domain registrar | cutover |
| Shopify Admin API token (read-only) | Shopify Admin | importing customers and order history (the public source covers the catalog) |
| COD yes/no | merchant | installer |

## D. NOT TESTED (possible, but not done yet)

- An install on a **real OCI A1 VM**. This is the first step when credentials exist.
- Playwright against a deployed staging URL. The suite ran against the local stack, and the browse/mobile specs need only `E2E_BASE_URL`.
- Display of imported historical orders in the storefront account page. The DB linkage is verified.
- A promo-code E2E test (no promotions exist on the live store).
- The Medusa Admin personalization widget (download link) in a browser test.
- An automated pixel comparison with the live theme. Comparison was manual, against the audit screenshots.
- Full disaster recovery onto a second VM. Each step is tested individually.
- Load or performance testing on 2 OCPU.

## E. Deliverables

- **Code:** `apps/backend` (Medusa 2.21.1: Razorpay, COD and SMTP providers, `sparky` module, importer, personalization, Admin extensions) and `apps/storefront` (Next.js 16, all required routes).
- **Deployment:** `deploy/`, containing:
  - install, upgrade, rollback, backup, restore, healthcheck, diagnose, migrate, medusa-exec and final-verification
  - systemd units, nginx, PostgreSQL and Redis configuration
  - server test scripts
- **Docs:** `docs/` (architecture and runbooks), `docs/research/` (versions, summary, risks, 13 ADRs, external research), `docs/audit/` (live site audit), `docs/release/` (checklist, this report).
- **Agent tooling:** `CLAUDE.md`, 7 project skills in `.claude/skills/`, and documented safety hooks in `.claude/hooks/`.

## F. Next steps to reach YES

1. The merchant supplies section C.
2. Create the OCI resources and run `install.sh` in staging on the A1 VM. Then run `final-verification.sh` and the reboot test (checklist C1–C8).
3. Pay with Razorpay test mode on staging, and have the merchant sign off the visual review.
4. Cutover per docs/MIGRATION.md. The live order and refund, then `--payment-verified`, must produce **PRODUCTION READY = YES**.
