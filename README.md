# Sparky 3D Craft Co: self-hosted commerce

This is the replacement for the Shopify store at https://sparky3dcraft.tech. It uses:

- **Medusa 2.21.1** (commerce backend + Admin)
- a **Next.js 16** storefront replicating the current "Craft" theme
- **PostgreSQL 16**, **Redis 7** and **nginx** with Let's Encrypt
- **systemd** on an Oracle Cloud Ampere A1 VM (ARM64, Ubuntu 24.04)
- product media in **OCI Object Storage**
- **Razorpay** (custom Medusa v2 provider) and optional **Cash on Delivery**

```
apps/backend      Medusa application (modules, providers, API routes, importer, Admin extensions)
apps/storefront   Next.js storefront (App Router) + Playwright E2E tests
deploy/           installer, upgrade/rollback, backup/restore, health, acceptance verification
docs/             architecture, runbooks, migration, payment, security, research, ADRs, audit
tests/            local fakes (Razorpay, SMTP, Shopify Admin) and integration tests
```

**Install on a server:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (`sudo ./deploy/install.sh`).
**Status:** [docs/release/FINAL-REPORT.md](docs/release/FINAL-REPORT.md). Go-live is blocked on
merchant inputs and live credentials listed in the release checklist.

## Local development

Requirements: Node 22.12+ and local PostgreSQL 16 and Redis 7.

```bash
# backend
cd apps/backend
cp .env.example .env              # edit DATABASE_URL, secrets
npm ci
npx medusa db:create --db medusa_db && npm run db:migrate
SPARKY_STORE_CONFIG=integration-tests/fixtures/store.config.test.json SPARKY_PUBLISHABLE_KEY_FILE=./publishable_key npm run setup:store
IMPORT_MODE=apply SHOPIFY_SOURCE=public SHOPIFY_STORE_URL=https://sparky3dcraft.tech npm run import:shopify
npx medusa user -e you@example.com -p '<strong password>'
npm run dev                       # http://localhost:9000/app

# storefront
cd apps/storefront
cp .env.example .env.local        # NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = contents of apps/backend/publishable_key
npm ci && npm run dev             # http://localhost:3000
```

## Tests

```bash
cd apps/backend && npm run typecheck && npm run test:unit
cd apps/storefront && npm run typecheck && npm run lint && npx playwright test   # needs the local stack + tests/fakes
bash tests/integration/shopify-import.sh
shellcheck -x deploy/*.sh deploy/lib/*.sh deploy/scripts/*.sh
```
