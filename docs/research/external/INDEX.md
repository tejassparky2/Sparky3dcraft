# External research index (as of 2026-09-24)

Targets: Medusa **2.21.1** (npm latest, published 2026-09-22), Next.js **16.3.6** (2026-09-22), Node 22 LTS (v22.23.3), Ubuntu 24.04 arm64 on OCI Ampere A1.

| File | Topic |
|---|---|
| [razorpay.md](razorpay.md) | Razorpay providers for Medusa v2, a code review of the top two, Razorpay APIs, and the build-vs-buy recommendation |
| [medusa-release-notes.md](medusa-release-notes.md) | 2.18 → 2.21.1 breaking changes, the Store API allowlist, caching and search status, and Redis issues |
| [medusa-deploy.md](medusa-deploy.md) | Server/worker deployment, exact Redis module config, build, cookies behind a proxy, DB pool |
| [medusa-shopify-migration.md](medusa-shopify-migration.md) | Official Shopify migration guidance (MCP tool plus the Magento reference pattern), mapping, passwords |
| [medusa-search-and-files.md](medusa-search-and-files.md) | `q` search, Postgres Search Module, Index Module status, S3 file provider options |
| [oci.md](oci.md) | OCI S3 compatibility gotchas, Always Free limits, iptables/UFW, arm64 packages |
| [nextjs16.md](nextjs16.md) | Next 16 self-hosting, caching APIs, proxy.ts, async APIs, image and ESLint changes |

## Top findings

1. **Razorpay: build our own provider in the repo.**
   - All v2 npm packages are community forks of one code base.
   - The most used, `medusa-plugin-razorpay-v2@0.1.4` (~1.2k downloads/month, pinned to Medusa 2.12.3), has a bug that makes Medusa ignore every webhook: it returns `notes.session_id`, which it never sets. It also has unawaited captures and truncates paise.
   - `@devx-commerce/razorpay@6.0.0-beta.0` captures in rupees instead of paise and has no public repo.
   - A custom provider is about 300–400 LOC using `razorpay@2.9.8`:
     - `receipt` and `notes.session_id` = Medusa payment session id, and auto-capture
     - `receipt` = `refund.id` for refund idempotency
     - webhook HMAC over the raw body with the **webhook secret**
     - webhook URL `/hooks/payment/razorpay_razorpay`
   - Medusa processes webhooks asynchronously on the **worker** and completes the cart on `authorized` or `captured`.
2. **Store API strict allowlist (2.21.0, #16702).**
   - Fields not on a route's `allowed` list are **silently dropped**. Sorting by a non-allowed field returns **400**.
   - Relation depth is capped at 3 (4 for products) since 2.20.0; exceeding it returns 400.
   - Examples not allowed on `/store/products`: `variants.metadata`, `categories.handle`.
   - Re-expose fields with `allowFields(...)` from `@medusajs/framework/http`, and only in a **global** middleware (no `method` key).
   - 2.20.1 fixed a field-filter bypass. 2.20.0 added payment-provider-to-region validation.
3. **Redis modules for 2.21.1** (exact, from the docs):
   - `@medusajs/medusa/event-bus-redis` `{ redisUrl }`, optionally with `jobOptions.removeOnComplete/removeOnFail`
   - `@medusajs/medusa/workflow-engine-redis` `{ redis: { redisUrl } }`. It **must be nested**: the loader only reads `options.redis`, and a top-level `redisUrl` type-checks but fails at boot (#16697, open).
   - `@medusajs/medusa/locking` with provider `@medusajs/medusa/locking-redis` (id `locking-redis`, `is_default: true`, `{ redisUrl }`)
   - `projectConfig.redisUrl` for sessions
   - Caching Module plus `@medusajs/caching-redis` is documented, but core caching is still behind **`MEDUSA_FF_CACHING` (default false, "[WIP]")**, and #16474 (invalidation OOM) is open. Skip it at launch.
   - Also register the deprecated `@medusajs/medusa/cache-redis` if using OAuth or MFA with more than one server process (#16498).
4. **Known Redis bugs:**
   - event-bus-redis startup hang "Creating server" (#15835): affected 2.17.0–2.17.1, **fixed in 2.17.2** (#15838).
   - caching-redis `KEYS` blocking: fixed (#14869).
   - Stale or closed without fixes: "jobs stop executing" (#14889), "events not consumed" (#14357).
   - Redis cache format changed in 2.20.0, so expect a cold cache after upgrading.
5. **Deploy:**
   - Two processes from the same `.medusa/server` build: `MEDUSA_WORKER_MODE=server|worker`, with `admin.disable` in the worker.
   - Run `npm install` inside `.medusa/server` after every build.
   - `predeploy: medusa db:migrate` runs once per deploy (it also syncs links).
   - `admin.backendUrl` is inlined at build time.
   - Medusa sets `trust proxy 1` and production cookies `secure: true, sameSite: "lax"` (source; the docs say "none"). **nginx must send `X-Forwarded-Proto`.**
   - DB pool goes in `databaseDriverOptions.pool` (a sibling of `connection`).
6. **Search:**
   - The Search Module with the Postgres provider is registered by default in 2.21.1. Define a `product` index and expose it with `configureStoreSearch`; the endpoint is `POST /store/search`.
   - The provider needs `pg_trgm` and `unaccent`. The migration soft-fails without superuser rights, so pre-create them.
   - `q` on `/store/products` is an ILIKE substring match.
   - The Index Module is still experimental and behind a flag.
7. **OCI Object Storage:**
   - Endpoint: `https://<ns>.compat.objectstorage.<region>.oraclecloud.com`, or the dedicated `...oci.customer-oci.com` form.
   - Use `forcePathStyle: true`, a Customer Secret Key, the OCI region id, and `acl: false` (OCI has no object ACLs; this option exists in file-s3 2.21.1 but is not in the docs table).
   - Set `requestChecksumCalculation/responseChecksumValidation: "WHEN_REQUIRED"`.
   - **Bulk `DeleteObjects` still sends CRC32**, which OCI rejects, and Medusa swallows the error, so orphaned files are possible.
   - Public URL: `https://objectstorage.<region>.oraclecloud.com/n/<ns>/b/<bucket>/o/<key>`.
8. **OCI Always Free is now 2 OCPU / 12 GB A1** (1,500 OCPU-h and 9,000 GB-h per month), plus 200 GB block, 20 GB object storage, **50k Object Storage API requests/month** and 10 TB egress. Idle instances are reclaimed below 20% CPU/network/memory over 7 days.
9. **Ubuntu on OCI:** never enable UFW (the instance may fail to boot). Insert ACCEPT rules for 80/443 before the REJECT rule in `/etc/iptables/rules.v4`, then run `netfilter-persistent save`, and also open them in the Security List or NSG.
   - noble ships nodejs 18, which is too old. Use the NodeSource `node_22.x` repo (arm64 22.23.3).
   - PostgreSQL 16.15 and Redis 7.0.15 come from noble-updates; certbot 2.9.0.
10. **Next 16:**
    - Turbopack is the default for build.
    - `middleware` → `proxy.ts` (Node runtime only).
    - `params`, `searchParams`, `cookies()` and `headers()` are async only.
    - `revalidateTag(tag, 'max')` needs two arguments; `updateTag(tag)` works only in Server Actions.
    - `cacheLife` and `cacheTag` are stable but require `cacheComponents: true`; `use cache` cannot read cookies or headers.
    - `next lint` is removed; use the ESLint flat config.
    - Image defaults changed: `minimumCacheTTL` 4 h, `qualities` `[75]`, and local IPs blocked.
    - Standalone output needs `public` and `.next/static` copied.
    - The Medusa starter is still on Next 15.3.9, so a port is required.
    - `next@16.3.6` has no known advisories; stay ≥16.3.3 for the AVIF RCE fix.

## Open items / UNVERIFIED

- The OCI public-access-type wording (ObjectRead vs ObjectReadWithoutList) appears inverted in Oracle's page. Test anonymous listing.
- Whether OCI accepts an `x-amz-checksum-crc32` header on unchunked PutObject. Test it, or just set WHEN_REQUIRED.
- Whether Shopify can export password hashes. Third parties say no; plan for password-reset emails.
- The procedure for importing customers as account holders with an emailpass identity (inferred from source).
- Whether Razorpay copies order notes onto the payment entity. Our design fetches the order, so it does not depend on this.
