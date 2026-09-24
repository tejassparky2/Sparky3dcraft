# CLAUDE.md: Sparky 3D Craft Co commerce platform

## Purpose
This repo replaces the Shopify store https://sparky3dcraft.tech with a self-hosted stack:
- Medusa 2.21.1 backend + Admin
- Next.js 16.3.6 storefront
- PostgreSQL 16, Redis 7, nginx, systemd
- deployed on one Oracle Cloud Ampere A1 VM (ARM64, Ubuntu 24.04), with media in OCI Object Storage

Payments are Razorpay (custom provider) plus optional COD. India only, INR, tax-inclusive prices.

## Architecture (details: docs/ARCHITECTURE.md, ADRs: docs/research/decisions/)
- `sparky-medusa-server` (127.0.0.1:9000): Store/Admin API, Admin UI at `https://api.<domain>/app`, `/hooks/razorpay`.
- `sparky-medusa-worker` (health on 127.0.0.1:9001): subscribers, jobs, payment webhook processing.
- `sparky-storefront` (127.0.0.1:3000): `next start`. Server components call Medusa on 127.0.0.1.
- Redis DBs: 0 sessions, 1 events, 2 workflows, 3 locks, 4 cache. Postgres `medusa_db`. nginx is the only public listener.

## Directory map
```
apps/backend/src/modules/{razorpay,cod,smtp-notification,sparky}   providers + custom tables
apps/backend/src/api/{hooks/razorpay,store/sparky,admin/sparky,middlewares.ts}
apps/backend/src/lib/{env.ts,personalization*.ts,shopify/}          env validation, personalization, importer
apps/backend/src/scripts/   setup-store, import-shopify, apply-personalization, send-customer-activation
apps/backend/src/{subscribers,jobs,admin}
apps/storefront/src/{app,components,lib}   App Router pages; lib/data = Medusa access
apps/storefront/content/policies/*.md      legal pages (merchant-owned text, status front-matter)
apps/storefront/e2e/                       Playwright
deploy/   install.sh upgrade.sh rollback.sh backup.sh restore.sh healthcheck.sh diagnose.sh
          migrate.sh medusa-exec.sh final-verification.sh  lib/ scripts/ systemd/ nginx/ postgres/ redis/ tests/
tests/fakes/  razorpay-fake.mjs (9911), smtp-capture.py (2525), shopify-admin-fake.mjs (9922)
docs/     runbooks, research/, audit/, release/
```

## Commands
- **Backend dev:** `cd apps/backend && npm run dev`
  - Checks: `npm run typecheck`, `npm run test:unit`, `npm run build`.
- **Storefront dev:** `cd apps/storefront && npm run dev`
  - Checks: `npm run typecheck`, `npm run lint`, `npm run build`, `npx playwright test`. E2E needs the local stack and fakes, with `PW_CHROMIUM_PATH` pointing at a Chromium binary.
- **Import:** `IMPORT_MODE=dry-run|apply SHOPIFY_SOURCE=public SHOPIFY_STORE_URL=https://sparky3dcraft.tech npm run import:shopify`
- **Integration:** `bash tests/integration/shopify-import.sh`
- **Deploy scripts:** `shellcheck -x deploy/*.sh deploy/lib/*.sh deploy/scripts/*.sh` must be clean at warning level.
- **Server:** `sudo ./deploy/install.sh`, `healthcheck.sh`, `final-verification.sh`, `upgrade.sh --ref <sha>`, `rollback.sh --previous`, `migrate.sh [--apply]`, `medusa-exec.sh <script>`.
- **Production** is always `medusa build` + `medusa start` and `next build` + `next start`. **Never dev servers.**

## Invariants (do not break)
1. **Payments:**
   - An order is only marked paid after a **server-side** Razorpay check (`authorizePayment` fetches payments), or after a webhook verified by HMAC over the raw body with the webhook secret.
   - Never from a client redirect.
   - One order per cart. Refunds are idempotent (`receipt = refund id`).
2. **Money:** convert to paise with decimal-string math (`toMinorUnits`). Never with floats.
3. **COD:** authorizes (`collected:false`) and is captured only when the cash is collected. Never a fake online payment.
4. **Production has no in-memory infrastructure modules and no `pp_system_default`.** `src/lib/env.ts` refuses a weak or missing production env. Keep it strict.
5. **Store API 2.21 strict allowlist:** request only allowed fields. `categories.*` is dropped on `/store/products`, so use `/store/product-categories`. `allowFields` must be a global middleware.
6. **`/store/orders/:id` is unauthenticated.** The storefront only shows orders to their owner or to the browser that placed them (the `_sparky_orders` cookie).
7. **Personalization metadata is validated and stripped server-side** (`personalization-middleware.ts`). Photos stay private.
8. **Migration:**
   - Shopify is read-only.
   - Every import goes through the `sparky_source_mapping` table.
   - Never mix sources without the mapping (RULE 11).
   - Never migrate passwords.
   - Historical orders never get Medusa payments.
9. **SEO:** Shopify URLs keep working (same handles, redirects in `next.config.ts`). Production never has `noindex`, and staging always has it.
10. **Deploy scripts:**
    - `set -Eeuo pipefail`, idempotent, output `[PASS]/[WARN]/[FAIL]/[SKIP]`.
    - Env files are parsed with `load_env_file` (never `source`d).
    - Never fail silently.

## Security
- Never commit `.env*` (only `*.env.example` with placeholders), keys, or real customer data. Runtime secrets live in `/etc/sparky/*.env` (0640/0600).
- Public ports are 22, 80 and 443 only. Postgres, Redis, 3000 and 9000 bind to localhost. On OCI, never enable UFW (use iptables).
- Don't log secrets, tokens or customer passwords.
- Don't disable TLS verification. Test-only overrides (`RAZORPAY_API_BASE`, `SMTP_INSECURE_NO_TLS`, `SHOPIFY_ADMIN_API_BASE_TEST_ONLY`) are refused in production.

## Migration rules
See docs/MIGRATION.md.
- Dry-run first. `migrate.sh --apply` backs up first.
- After cutover (`SPARKY_CUTOVER_COMPLETED=true`) imports are refused unless explicitly allowed.
- Legal text, shipping rates and tax rates come from the merchant. **Never invent them.**

## Version policy
See docs/research/VERSIONS.md.
- Exact pins for core packages, and lockfiles are committed.
- No `npm update`, `medusa upgrade` or `npm audit fix --force`.
- Transitive fixes go in `overrides` only after review (`lodash` 4.18.1).
- Before any Medusa or Next change, use the `medusa-research` skill: read every release note in between.
- `upgrade.sh` requires `--confirm-medusa-upgrade`.

## Deployment policy
- Releases are immutable under `/opt/sparky/releases/<ts>-<sha>`, and `current` is a symlink.
- Upgrades run through `upgrade.sh --ref`: backup → build and test while the old release serves → migrate → switch → health, with automatic rollback.
- Staging first. Production cutover follows docs/release/RELEASE-CHECKLIST.md.
- Keep Shopify as the rollback path during the cutover window.
- `final-verification.sh` is the gate. "PRODUCTION READY = YES" only comes from it, in production mode, with zero FAIL and zero MANUAL.

## Top risks
See docs/research/RISKS.md.
- Razorpay is untested with real keys.
- ARM64 is untested on real A1 hardware.
- Legal pages, shipping rate and GST depend on the merchant.
- OCI S3 quirks (bulk-delete CRC32, API-request quota).

## Status
See docs/release/FINAL-REPORT.md.
- Code, tests and the deploy package are complete and verified locally and in an Ubuntu 24.04 container.
- Go-live is blocked on external credentials (Razorpay live, SMTP, OCI, DNS/TLS, Shopify Admin token) and merchant approvals.

## Project skills and hooks
- `.claude/skills/*`: medusa-research, shopify-migration, storefront-fidelity, production-deployment, e2e-commerce-qa, security-audit, release-verification.
- `.claude/settings.json` hooks are documented in `.claude/hooks/README.md`. They only format, lint or check, and block unsafe actions. They never delete data.
