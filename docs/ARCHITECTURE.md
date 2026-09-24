# Architecture

Sparky 3D Craft Co runs on self-hosted **Medusa 2.21.1** (commerce backend + Admin), a
**Next.js 16.3.6** storefront, **PostgreSQL 16**, **Redis 7**, and **nginx** with Let's Encrypt.
Everything runs natively under **systemd** on one Oracle Cloud Ampere A1 VM
(2 OCPU / 12 GB, ARM64, Ubuntu 24.04). Product media lives in **OCI Object Storage**, reached
through its S3-compatible API.

```
                         Internet (only 22, 80, 443 open)
                                     │
                               ┌─────┴─────┐
                               │   nginx   │  TLS, HTTP→HTTPS, rate limits, security headers
                               └──┬─────┬──┘
          https://sparky3dcraft.tech │     │ https://api.sparky3dcraft.tech
                                  ▼     ▼
             ┌────────────────────────┐   ┌───────────────────────────────────┐
             │ sparky-storefront       │   │ sparky-medusa-server               │
             │ next start 127.0.0.1:3000│──▶│ medusa start 127.0.0.1:9000        │
             │ (server components call │   │ MEDUSA_WORKER_MODE=server          │
             │  Medusa on 127.0.0.1)   │   │ Store API, Admin API, Admin UI /app│
             └────────────────────────┘   │ /hooks/razorpay                     │
                     ▲ revalidate           └──────────────┬────────────────────┘
                     │ (catalog events)                    │ events / workflows / locks
             ┌───────┴────────────────┐    ┌──────────────┴─────────┐
             │ sparky-medusa-worker    │◀──▶│ Redis 127.0.0.1:6379    │ db0 sessions, db1 events,
             │ MEDUSA_WORKER_MODE=worker│    │ noeviction, AOF, password│ db2 workflows, db3 locks,
             │ subscribers, jobs,       │    └─────────────────────────┘ db4 cache
             │ webhook processing       │    ┌─────────────────────────┐
             │ health on 127.0.0.1:9001 │───▶│ PostgreSQL 127.0.0.1:5432│ medusa_db, scram-sha-256
             └────────────────────────┘    └─────────────────────────┘
                     │ uploads (S3 API)
                     ▼
     OCI Object Storage: sparky-media (public read: product media)
                         sparky-private (customer personalization photos, private)
                         sparky-backups (encrypted database/config backups, private)
```

## Components

| Component | What it does | Code |
|---|---|---|
| Medusa server | Store/Admin HTTP APIs, Admin dashboard at `https://<api>/app`, Razorpay webhook endpoint | `apps/backend` |
| Medusa worker | Subscribers (order emails, revalidation, upload attachment), scheduled jobs, async workflow steps, payment webhook processing | same build, `MEDUSA_WORKER_MODE=worker` |
| Razorpay provider | Custom Medusa v2 payment provider. Verification happens server-side, amounts are in paise, and refunds are idempotent | `apps/backend/src/modules/razorpay` |
| COD provider | Cash on Delivery. Authorizes at order time and is captured when the cash is collected; it never pretends to be an online payment | `apps/backend/src/modules/cod` |
| SMTP notification | Order confirmation, password reset and account activation, contact form | `apps/backend/src/modules/smtp-notification` |
| `sparky` module | Tables for source-ID mappings, the webhook event ledger, migration runs, customer uploads, contact messages and the newsletter | `apps/backend/src/modules/sparky` |
| Shopify importer | Public JSON / Admin GraphQL / CSV sources → idempotent import with source-ID mapping | `apps/backend/src/lib/shopify`, `src/scripts/import-shopify.ts` |
| Storefront | Next.js App Router pages replicating the current Shopify "Craft" theme | `apps/storefront` |
| Deploy package | Installer, upgrade, rollback, backup/restore, health, verification | `deploy/` |

## Key design decisions (ADRs in `docs/research/decisions/`)

- **Native systemd, not Docker** (ADR-001). One VM, and every package has an arm64 build. Using
  systemd means one fewer layer and less memory.
- **Server + worker split** (ADR-002), with all infrastructure modules backed by Redis (event bus,
  workflow engine, locking, cache). In production no module falls back to in-memory.
- **Custom Razorpay provider** (ADR-003). The community packages had disqualifying bugs
  (`docs/research/external/razorpay.md`).
- **OCI Object Storage via the S3 API** (ADR-004), with `forcePathStyle`, no ACLs and
  `WHEN_REQUIRED` checksums.
- **Postgres ILIKE search via `q`** (ADR-005). The catalog is small, so no external search engine is needed.
- **Shopify collections → Medusa product categories** (ADR-006). The Store API exposes
  categories with handles, and the storefront keeps `/collections/<handle>` URLs.
- **Compare-at prices → base price + a "sale" price list** (ADR-007). The storefront then shows
  the struck-through price exactly as Shopify does.
- **Personalization as product metadata + validated line-item metadata** (ADR-008). Photos go to
  private storage.
- **Admin on the API domain** (`https://api.<domain>/app`) (ADR-009).
- **Source-ID mapping for migration** (ADR-010). Re-runs are idempotent, and methods are never mixed without mapping.

## Request paths

- **Browsing:** browser → nginx → Next (server components) → Medusa `127.0.0.1:9000` with the
  publishable key. Catalog data is cached under the `catalog` tag. The worker's
  `storefront-revalidate` subscriber posts to `/api/revalidate` on product, variant, category
  and inventory events, so Admin edits appear within seconds.
- **Checkout (Razorpay):**
  1. Next creates a payment session, and the provider creates a Razorpay order with
     `receipt/notes.session_id`.
  2. Browser checkout.js → Next calls cart complete.
  3. The provider **fetches the order's payments from Razorpay** and authorizes only on a
     captured or authorized payment of the exact amount and currency.
  4. In parallel, Razorpay webhooks → `/hooks/razorpay` (HMAC check, dedupe ledger) →
     Medusa `processPaymentWorkflow` on the worker. This completes the cart if the browser was closed.
  5. Medusa's cart-completion lock plus idempotent completion guarantee one order per cart.
- **Checkout (COD):** the payment session is authorized with `collected:false`. The order is
  created with payment status *authorized*. The merchant captures in Admin once the cash is received.

## Data locations on the server

| Path | Contents |
|---|---|
| `/opt/sparky/releases/<UTC ts>-<sha>` | Immutable built releases; `/opt/sparky/current` symlink is active |
| `/etc/sparky/` | `backend.env`, `storefront.env` (0640 root:sparky), `secrets.env` (0600), `install.conf`, `store.config.json` |
| `/var/lib/sparky/` | Publishable key, private uploads (if local), migration snapshots, installer state, verification reports |
| `/var/backups/sparky/` | Local backups (0700 root) |
| `/var/log/sparky/` | Installer, upgrade and backup logs. The services log to journald |
