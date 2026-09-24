# Medusa v2.18.0 → v2.21.1 release notes (plus Redis-related issues)

Researched: 2026-09-24.

## Question

What changed between Medusa 2.18 and 2.21.1? I focused on:

- breaking changes
- Store API `fields=` restrictions
- the caching module and Redis
- Node requirements
- admin, index and search changes
- security fixes

I also looked for known 2025–2026 Redis event-bus and workflow-engine issues.

## Findings

### Release dates (npm `time`)

| Version | Published |
|---|---|
| 2.17.2 | 2026-07-01 |
| 2.18.0 | 2026-07-23 |
| 2.19.0 | 2026-08-13 |
| 2.20.0 | 2026-09-02 |
| 2.20.1 | 2026-09-03 |
| 2.21.0 | 2026-09-11 |
| 2.21.1 | 2026-09-22 (current `latest`) |

`2.22.0-snapshot-20260911212358` exists under the `snapshot` dist-tag. `@medusajs/medusa@2.21.1` declares `engines.node: "^20.19.0 || >=22.12.0"`.

### v2.18.0 (2026-07-23)

- **BREAKING:** the default DB load strategy changed from `SELECT_IN` to `BALANCED`, to match MikroORM v7 defaults. Relation loading changes.
- **BREAKING:** generated internal service `delete` can now return `string[] | Record<string, any>[]` (composite primary keys).
- New `databaseDriverOptions.dynamicPassword` and `expirationChecker` (AWS RDS IAM).
- `redisOptions` option added to the caching-redis provider.
- #16125 adds a `disallowed` query config.
- #15930: the payment-webhook subscriber skips `pending` actions.
- #16036: captures and refunds of 0 or negative amounts are rejected.
- Fix for loading workflows in worker mode (#15702, "load workflows defined in index.[js,ts]").
- Dependency security bumps: multer 2.2.0, qs 6.15.2, OpenTelemetry 2.9.0. `OTEL_RESOURCE_ATTRIBUTES` is now parsed strictly.

### v2.19.0 (2026-08-13)

- **BREAKING:** the admin moved to Vite 7.3.6 and React Router 7.18.2.
  - **Node requirement raised** to `^20.19.0 || ^22.12.0` or newer LTS (#16314). Node 20.0–20.18 and 22.0–22.11 are no longer supported.
  - Browser targets: Chrome/Edge ≥107, Firefox ≥104, Safari ≥16.
- **BREAKING (JS SDK):** `sdk.admin.product.createOption/updateOption/retrieveOption/deleteOption` were removed. Use `sdk.admin.product.update`.
- **BREAKING:** selecting `*` on cart or order fields now includes computed totals. Select fields explicitly.
- **BREAKING:** DML `.json()` now takes type arguments.
- The Search Module was introduced (#16298), initially with an in-memory Orama provider.
- Generic OIDC auth provider.
- Inventory CSV export.

### v2.20.0 (2026-09-02)

- **BREAKING (#16688):** Store API routes limit relation expansion depth.
  - The default is `http.storeRelationsLimit = 3`; `/store/products` allows 4.
  - Going over the limit returns **400**.
  - Requires `db:migrate`.
- **BREAKING (#16545):** the in-memory search provider was removed. Use Postgres, Medusa Cloud or a custom provider. Search indexes are created only by `db:migrate`.
- **BREAKING (#16643):** custom search providers must implement `searchMany`.
- **BREAKING (#16610):** MFA routes require a completed MFA challenge.
- **Redis cache redesign (#16476):** caching-redis now stores entries under a 64-bit hash key. Existing entries become unreadable, so expect a **cold cache after deploy**.
- #16549: caching-redis `set` now overwrites existing keys.
- #16547: the caching module now **awaits** `set` and `clear` (backpressure).
- Security:
  - Payment provider IDs are validated against the cart's region (#16690). Arbitrary provider IDs could previously be used.
  - Store order routes block field-expansion pivots (#16480).
  - OAuth state cache write is now awaited (#16571).
- Fractional inventory quantities and units of measure were added.
- A Postgres search provider was added (#16361).

### v2.20.1 (2026-09-03): security

- #16704: **field filtering did not strip disallowed fields unless RBAC was enabled.** Upgrade is strongly advised.
- #16703: the `correlated` search flag was disabled.
- #16692: schema index JSON format is no longer accepted.

### v2.21.0 (2026-09-11): security hardening, BREAKING

**#16702: strict `allowed` list on every Store API route.**

- A requested field or relation is returned only if its **exact normalized path** appears in the route's `allowed` list.
- Prefix matching is gone.
- **Disallowed fields are silently stripped (no error).**
- **Sorting by a field that is not allowed returns 400** (`Order field {field} is not valid`).
- Admin routes are unaffected, except Customer and Product Category, which also restrict fields.
- The new `allowFields(...)` middleware (from `@medusajs/framework/http`) re-exposes fields. It **must be a global middleware** (no `method`/`methods` key), otherwise it runs after validation and has no effect (#16716, #16778). A lint rule covers this: `allow-fields-must-be-global-middleware`.
- Medusa published backported patches for 2.15.3–2.20.1.

Other 2.21.0 changes:

- Dashboard exports `@medusajs/dashboard/components`, `/hooks` and `/lib` (#16506).
- Promotion metadata management (#16719).
- Payment capture persistence fix (#16750).
- Store tag, collection, category and type routes return **published products only** (#16674).
- event-bus-redis applies a TTL to grouped event staging keys (#16563).
- #16787 reverts cross-module queries back to the index module.

**Allowed extra fields on `/store/products` in 2.21.1** (source: `packages/medusa/src/api/store/products/query-config.ts`):

- Defaults: `id, title, subtitle, description, handle, is_giftcard, discountable, thumbnail, collection_id, type_id, weight/length/height/width, hs_code, origin_country, mid_code, material, created_at, updated_at, *type, *collection, *options, *options.values, *tags, *images, *variants, *variants.options`
- Extras: `metadata, categories, status, external_id, deleted_at, variants.calculated_price, variants.inventory_quantity, variants.manage_inventory, variants.allow_backorder, variants.images, variants.thumbnail, variants.options.option, variants.inventory_items(.inventory_item_id/.required_quantity/.inventory/.inventory.location_levels), variants.prices`, the scalar `variants.*` columns (id, title, sku, barcode, ean, upc, …), `options.*`, `images.id/url/rank`, `type.*`, `tags.*` and `collection.*` (including `collection.metadata`).
- **Not allowed** (examples): `variants.metadata`, `categories.handle`, `categories.name`, `categories.parent_category`, `sales_channels`, `shipping_profile`. Expose these with `allowFields` if needed.

`/store/product-categories` allows `products`, `products.title`, `products.variants`, `products.options`, `products.images`, and nested `parent_category` / `category_children` fields up to depth 3.

`http.restrictedFields.store` defaults to `["order", "orders"]`.

### v2.21.1 (2026-09-22)

- **Search Module GA for storefronts:**
  - It is registered by default with the **PostgreSQL provider** (`search-postgres`, using `pg_trgm` and `unaccent`).
  - New `POST /store/search` endpoint, compatible with InstantSearch. It exposes nothing until you add a `configureStoreSearch({ allowed_indexes: { product: true } })` middleware.
  - New projects get a `product` index definition. Upgraded projects must define one in `src/search/product.ts`.
  - Run `npx medusa db:migrate`.
- #16816: the default `http.authMethodsPerActor.user = ["emailpass"]` is now applied, and `/auth/:auth_provider/user` is gated by that config.
- #16607: the caching module resets size accounting on wildcard clear.
- #16648: build runs lint with `failOnError: false`.
- Other fixes: email/password re-registration, Stripe webhook error handling, React dedupe in the admin bundle.
- Finnish and Swedish admin translations were added.
- No Node or Redis config changes.

### Caching module status (2.21.1)

- `@medusajs/medusa/caching` with the `@medusajs/caching-redis` provider is documented as a recommended production module.
- The core caching feature is **still behind the feature flag `MEDUSA_FF_CACHING` (default `false`, described as "[WIP]")** in `packages/medusa/src/feature-flags/caching.ts`.
- The auth module still depends on the **deprecated `Modules.CACHE`** (`cache`) for OAuth state and MFA challenges (`packages/modules/auth/src/services/auth-module.ts`).
  - If `Modules.CACHE` is not configured, it falls back to in-memory storage. That breaks OAuth callbacks across multiple server instances (#16498, closed "not planned").
  - Medusa Cloud's own `defineConfig` still registers `@medusajs/medusa/cache-redis` alongside caching-redis (`packages/core/utils/src/common/define-config.ts`).

### Index module

- The Index Module is still labelled **"Experimental"** in the docs and sits behind the `index-engine` feature flag (default `false`).
- `/store/products` uses it only when the flag is on.

### Security advisories

- The GitHub Security Advisories page for medusajs/medusa shows "There aren't any published security advisories".
- OSV lists `MAL-2025-191457`: malicious code in `@medusajs/medusa` **preview builds** `2.11.4-preview-20251124060135` and `2.11.4-preview-20251124090208` (Nov 2025 npm supply-chain incident). **Never install `preview` dist-tags.**
- OSV reports **0** known vulnerabilities for `@medusajs/medusa@2.21.1`.
- The security fixes that matter shipped as ordinary releases: 2.20.0 (provider-region validation, MFA, order pivots), 2.20.1 (field-filter bypass), 2.21.0 (strict allowlist).

### Known Redis, worker and startup issues (2025–2026)

| Issue | Title | Versions | Status / fix |
|---|---|---|---|
| **#15835** | "`@medusajs/medusa/event-bus-redis` hangs at 'Creating server' since v2.17.0 – introduced by PR #15786" | 2.17.0–2.17.1 | **Fixed in 2.17.2** by #15838 ("fix event-bus-redis onApplicationStart hook"). Verified: 2.21.1 source uses `void this.bullWorker_.run()`. |
| **#16697** | "[workflow-engine-redis] Options type declares top-level redisUrl but loader only reads nested options.redis" | 2.19.0, 2.20.0 | **Open**; PRs #16698 and #16761 referenced. In 2.21.1 the loader **still reads only `options.redis.{redisUrl,url}`** and throws "No `redis.redisUrl` (or deprecated `redis.url`) provided…". Use the nested form. |
| **#16474** | "Caching module invalidation is unbounded and runs on `worker_mode: server` processes, OOMing the API container under bulk writes" | 2.19.0 | Open ("Stale", PR #16483 referenced). #16547 in 2.20.0 added awaiting and backpressure. The dual invalidation path (interceptor on the server plus the worker subscriber) is not confirmed fixed. |
| **#14774** | "@medusajs/caching-redis: KEYS command in clear() blocks Redis…" | ≤2.13.x | Closed. Fixed by #14869 (KEYS replaced with SCAN). |
| **#16498** | "Auth module's OAuth state still requires deprecated Modules.CACHE; migrating to Modules.CACHING silently breaks multi-instance login" | 2.19.0 | Closed "not planned". Workaround: also register `@medusajs/medusa/cache-redis`. |
| **#15987** | "`medusa db:migrate` hangs indefinitely right after creating the mikro_orm_migrations table" | 2.17.2 | Closed; root cause and fix not stated (UNVERIFIED). |
| **#14889** | "Medusa stops executing jobs after some point" (Redis worker, 2.13.3, many `medusa exec` runs) | 2.13.3 | Closed "not planned"; no root cause. |
| **#14357** | "Events aren't getting consumed by subscribers, causing unprocessed events and memory leaks" | 2.11.3 | Closed; fix not identified in the issue. |
| **#14195** | "Events are not emitted after upgrading to v2.12.0" | 2.12.0 | Closed (details not reviewed). |
| **#8422** | "Scheduled Jobs fail when @medusajs/workflow-engine-redis is used" | v2 RC era | Historical. |

## Sources

- https://github.com/medusajs/medusa/releases/tag/v2.18.0 , /v2.19.0 , /v2.20.0 , /v2.20.1 , /v2.21.0 , /v2.21.1
- Cloned medusajs/medusa master at 7b3fe04 (2026-09-24; `packages/medusa/package.json` version 2.21.1). Files read:
  - `packages/medusa/CHANGELOG.md`, `packages/core/framework/CHANGELOG.md`
  - `packages/modules/{event-bus-redis,workflow-engine-redis,caching,providers/caching-redis,providers/locking-redis}/CHANGELOG.md`
  - `packages/medusa/src/api/store/*/query-config.ts`
  - `packages/medusa/src/feature-flags/*.ts`
  - `packages/modules/workflow-engine-redis/src/loaders/redis.ts`
  - `packages/modules/event-bus-redis/src/services/event-bus-redis.ts`
  - `packages/modules/auth/src/services/auth-module.ts`
  - `packages/core/utils/src/common/define-config.ts`
- https://docs.medusajs.com/learn/fundamentals/api-routes/allowed-fields
- https://docs.medusajs.com/learn/configurations/medusa-config (http.restrictedFields, http.storeRelationsLimit)
- https://docs.medusajs.com/resources/infrastructure-modules/search
- Issues: https://github.com/medusajs/medusa/issues/15835 , /16697 , /16474 , /14774 , /16498 , /15987 , /14889 , /14357 , /14195 , /8422
- https://github.com/medusajs/medusa/security/advisories
- https://api.osv.dev/v1/vulns/MAL-2025-191457 ; OSV query for @medusajs/medusa@2.21.1
- `npm view @medusajs/medusa time dist-tags engines`

## Confidence

- **High:** changelog entries, allowlists and feature-flag defaults (read from source).
- **Medium:** release-note summaries (via a summarizing fetcher).
- **Medium:** issue statuses, which may have changed since fetching. Where they matter (#15835 and #16697), I verified against 2.21.1 source.

## Implications for us

1. Pin `@medusajs/*` to exactly `2.21.1`. Run `npx medusa db:migrate`, which creates the search tables and tries to `CREATE EXTENSION pg_trgm, unaccent`. Pre-create those extensions as the Postgres superuser.
2. Audit every storefront `fields=` string against the allowlists above:
   - Anything not listed is silently dropped, for example `variants.metadata` and `categories.handle`.
   - Sorting by a non-allowed field returns 400.
   - Add a **global** `allowFields` middleware in `src/api/middlewares.ts` for any extras.
   - Keep relation depth ≤3 (≤4 on products).
3. Workflow engine Redis config must be `options: { redis: { redisUrl } }` (nested). A top-level `redisUrl` passes type-checking but fails at boot (#16697).
4. Node ≥22.12 is required. Node 22 LTS is fine.
5. Caching: `MEDUSA_FF_CACHING` is off by default and there are open OOM and invalidation issues (#16474). Self-hosted `defineConfig` does **not** register the Caching Module by default, although Cloud does when `CACHE_REDIS_URL` is set. Recommendation: do **not** enable the core caching flag at launch.
   - #16474 reports that cache **invalidation still runs when the module is registered, even with the flag off**. Either leave the Caching Module out at launch or register it and watch memory under bulk imports.
   - Also register `@medusajs/medusa/cache-redis` (the deprecated `Modules.CACHE`) if we use Google/OAuth login or MFA across more than one server process.
6. Never use `preview` or `snapshot` tags (Nov 2025 malware incident).
