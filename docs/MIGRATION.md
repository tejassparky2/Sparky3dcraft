# Shopify → Medusa migration

Source: the live store `https://sparky3dcraft.tech` (Shopify, theme Craft 15.5.0), audited on
2026-09-24 (`docs/audit/LIVE-SITE-AUDIT.md`):

- 9 published products and 2 collections ("Personalized Gifts", "Rayara Idols")
- 1 page (contact) and 1 policy (privacy)
- INR, tax-inclusive, ships to India only

**Shopify is only ever read.** The importer uses GET requests (public JSON), read-only GraphQL
queries (Admin API), or a local CSV file. Nothing on Shopify is modified or deleted, and the
store stays available as the rollback path until you decide otherwise.

## What is migrated, and how

| Shopify | Medusa | Notes |
|---|---|---|
| Product (handle, title, HTML description, vendor, type, tags, status) | Product with the **same handle** | `/products/<handle>` URLs are preserved. Description HTML is sanitized when rendered |
| Options / variants (SKU, barcode, weight, inventory) | Options / variants, inventory items at the "Sparky Warehouse" location | Inventory counts need the Admin source. The public source only knows `available` |
| Price | Variant price, or a sale price-list price | See below |
| `compare_at_price` > price | Variant **base price = compare-at**, plus the "Sale prices (Shopify compare-at)" price list (type `sale`) at the Shopify price | The storefront shows ~~compare-at~~ price and a "Sale" badge, exactly as Shopify does |
| Images (order, alt) | Re-hosted in our object storage with the alt text kept | No image stays on the Shopify CDN (checked by final-verification) |
| Product videos (MP4) | Re-hosted and stored in product metadata | Public source via `/products/<h>.js` |
| Collections (title, handle, description, image, product order) | **Product categories** with the same handle, `metadata.product_order` | `/collections/<handle>` is preserved. ADR-006 |
| Personalization app fields (lithophane photo, colour choice, text) | Product metadata `personalization_*` from `apps/backend/data/personalization.json` | Applied by `apply-personalization`. The line-item data is validated server-side |
| Customers (Admin/CSV source) | Customers, with addresses and an **email/password identity that has a random, unusable password** | **Passwords are never migrated.** Shopify doesn't export them and this store uses passwordless accounts. Customers get an activation email (below) |
| Orders (Admin source) | Historical orders marked `metadata.historical=true` with the Shopify order number, **no payment records** | Linked to the migrated customer (verified by `tests/integration/shopify-import.sh`). Display in the storefront account history is NOT yet tested. Zero Medusa payment records are created: these orders were never processed by the new providers, and nothing claims they were |
| Pages / policies | Storefront pages `/contact`, `/privacy`, `/terms`, `/shipping`, `/refunds` | Only the privacy policy exists on Shopify, copied verbatim. Terms, shipping and refunds are **placeholders that need merchant-approved text** |
| Shopify URLs `/collections/all`, `/pages/contact`, `/policies/*`, `/account/login` … | 308 redirects in `apps/storefront/next.config.ts` | Keeps inbound links and search results working |

### Idempotency and safety (ADR-010)

- Every imported entity is recorded in the `sparky_source_mapping` table: `(source="shopify", entity_type, source_id)` → `medusa_id`, plus a checksum of the normalized source record.
- Re-runs **update** mapped entities and skip unchanged ones (checksum). They never duplicate.
- Existing products with the same handle but no mapping are *adopted*, not duplicated.
- Switching the source method on a catalog already imported by another method is refused unless `IMPORT_ALLOW_SOURCE_SWITCH=true`. The source-ID mapping is what makes that switch safe (RULE 11).
- After cutover (`SPARKY_CUTOVER_COMPLETED=true`), imports refuse to run unless `IMPORT_ALLOW_AFTER_CUTOVER=true`. From then on, Medusa is the source of truth.
- Each run saves the normalized source snapshot to `/var/lib/sparky/migration-snapshots/` and a row in `sparky_migration_run`.
- `deploy/migrate.sh --apply` always takes a **database backup first**, runs a dry-run, applies, and verifies.

## Sources

| `MIGRATION_SOURCE` | Needs | Imports |
|---|---|---|
| `public` (default) | nothing | Products, variants, prices, images, videos, collections. **Tested** against the live store |
| `admin` | Shopify Admin API token, read-only scopes `read_products`, `read_customers`, `read_orders`, plus `read_all_orders` for orders older than 60 days | Everything above, plus inventory counts, customers and orders. Tested only against a local fixture double (`tests/fakes/shopify-admin-fake.mjs`), **not** against the real Admin API, because no token was available |
| `csv` | products_export.csv from Shopify Admin | Products and variants (a fallback) |

Create the Admin token in Shopify Admin → Settings → Apps → Develop apps → create an app →
Admin API scopes (read-only) → install → copy the token once. Store it only in `/etc/sparky/secrets.env`.

## Commands

On the server:

```bash
sudo ./deploy/migrate.sh --probe          # admin source: token, scopes and API version check
sudo ./deploy/migrate.sh                  # dry-run: prints create/update/skip counts, changes nothing
sudo ./deploy/migrate.sh --apply          # backup → dry-run → apply → verify
sudo ./deploy/medusa-exec.sh apply-personalization
```

Locally (development):

```bash
cd apps/backend
IMPORT_MODE=dry-run SHOPIFY_SOURCE=public SHOPIFY_STORE_URL=https://sparky3dcraft.tech npm run import:shopify
IMPORT_MODE=apply   SHOPIFY_SOURCE=public SHOPIFY_STORE_URL=https://sparky3dcraft.tech npm run import:shopify
```

## Customer accounts

Shopify passwords cannot be exported, and this store's customers sign in with Shopify's
passwordless email codes anyway. Each migrated customer therefore gets a login identity with a
random unusable password. After cutover, send the activation emails:

```bash
sudo ./deploy/medusa-exec.sh send-customer-activation ACTIVATION_MODE=dry-run
sudo ./deploy/medusa-exec.sh send-customer-activation ACTIVATION_MODE=send ACTIVATION_LIMIT=100
```

The email links to `/reset-password`. The link is single-use and **valid for 15 minutes**
(Medusa's reset-token lifetime). A customer who opens it later uses "Forgot password" on
`/login`, which works for every migrated email. Re-runs skip customers already emailed
unless `ACTIVATION_RESEND=true`. SMTP must be configured.

## Cutover procedure

1. **T-7 days:** staging fully verified (`final-verification.sh` with only credential/merchant
   MANUAL items left). Lower the DNS TTL of the apex, `www` and `api` records to 300 s.
2. **T-1 day:** the merchant approves the policies (privacy/terms/shipping/refunds), shipping rates and GST
   setup (docs/SHIPPING.md). Enter the live Razorpay keys and webhook.
3. **T-0 (low-traffic hour, IST night):**
   1. Freeze catalog edits on Shopify and note the time.
   2. `sudo ./deploy/migrate.sh --apply` (final delta, including customers and orders if the Admin source is used).
   3. `sudo ./deploy/install.sh --mode production --from-stage medusa` (production URLs, `SITE_NOINDEX=false`, live keys).
   4. Switch the DNS A records to the VM. Wait for propagation (`dig +short sparky3dcraft.tech`).
   5. `sudo ./deploy/install.sh --only tls`, then `sudo ./deploy/final-verification.sh --mode production --admin-email … --test-order`.
   6. Place one real low-value Razorpay order and refund it (docs/PAYMENT.md). Then re-run with `--payment-verified`.
   7. `sudo SPARKY_CUTOVER_COMPLETED=true ./deploy/install.sh --from-stage medusa` (the answer is kept; Shopify re-imports are now refused).
   8. Send the customer activation emails.
4. **After cutover:** keep Shopify intact (for example, password-protect its storefront) for at least 30 days.
   Rollback means pointing DNS back (docs/ROLLBACK.md §DNS). Orders placed on Medusa in the
   meantime must then be fulfilled from Medusa Admin.

## Data-quality notes from the audit

- Handles are kept exactly as on Shopify (e.g. `rayaru-with-brundavana` next to `rayara-*`), even where spellings differ, so no URL breaks.
- The live search counts matches in descriptions. Ours uses Medusa's `q` filter (Postgres ILIKE over the product's
  searchable fields), so result counts can differ slightly.
- No blog articles, FAQ or About page exist on Shopify, and none were invented.
