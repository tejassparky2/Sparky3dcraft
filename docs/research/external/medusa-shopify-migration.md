# Medusa's official guidance for migrating from Shopify

Researched: 2026-09-24.

## Question

Does Medusa have current official guidance for migrating from Shopify? What architecture and entity mapping does it recommend, and what does it say about customers, orders and passwords?

## Findings

### 1. Official Shopify page: MCP-tool based (no hand-written recipe)

The page is https://docs.medusajs.com/learn/introduction/build-with-llms-ai/mcp-server/migrate-from-shopify (repo path `www/apps/book/app/learn/introduction/build-with-llms-ai/mcp-server/migrate-from-shopify/page.mdx`).

- The Medusa MCP server exposes a tool named `get_import_data_from_shopify_or_other_platform_guide`. It returns "a complete, step-by-step implementation guide" for Shopify, including Shopify Plus. The guide content itself is only served through the MCP server and is not on the public docs.
- Data types covered: "Products, variants, prices, and images", "Inventory levels", "Collections and categories". The page adds: "The migration can also support other types like orders and customers, but it's mainly catered toward catalog data."
- Two approaches:
  - **Custom (default):** "Builds a custom module and workflows in your Medusa application that pull data from Shopify's API. The import is idempotent, resumable, and re-runnable, and it can be triggered from an admin widget, a scheduled job, a CLI command, or a webhook." Use it to migrate inventory levels, **re-host images in Medusa's file provider**, or keep ongoing sync.
  - **CSV:** transform Shopify's CSV export into Medusa's product-import CSV, then import from the Admin. The page calls this "lossy":
    - "inventory quantities aren't migrated"
    - "images stay as URLs pointing to Shopify's CDN"
    - "collections usually aren't part of the export"
    - "most exports have no ID column, so records can't be keyed back to the source"
- Warnings:
  - "Don't mix the two approaches on the same store… running the API-based importer afterwards treats every record as new and fails on duplicate product handles."
  - Migrate **products first**, because orders and inventory reference products.
  - Problems to guard against: "products that aren't purchasable, images that break when the Shopify store is switched off, and records that can't be matched back to Shopify".
- If you don't use MCP, Medusa suggests contacting them: https://medusajs.com/contact?type=mcp-server-shopify-migration

### 2. Reference implementation pattern: the official Magento migration guide

The page is https://docs.medusajs.com/resources/integrations/guides/magento, with example repo https://github.com/medusajs/examples/tree/main/migrate-from-magento. It is the only full-code migration tutorial in the docs, and the Shopify MCP guide describes the same architecture ("custom module and workflows").

- **Plugin** with a **module** (`src/modules/magento`) whose service wraps the source API (auth plus paginated product retrieval). Options are passed via plugin options.
- **Workflow** `migrateProductsFromMagentoWorkflow`:
  1. `getMagentoProductsStep`
  2. `useQueryGraphStep` (store, for default sales channel and currencies)
  3. `useQueryGraphStep` (shipping profile)
  4. `useQueryGraphStep` (**existing products matched by `external_id`**, so they are updated rather than duplicated)
  5. `useQueryGraphStep` (existing product options)
  6. `createProductOptionsWorkflow`
  7. `createProductsWorkflow` and `updateProductsWorkflow`
- **Scheduled job** `src/jobs/migrate-magento.ts` pages through the source with `currentPage`/`pageSize` 100, calling the workflow per page until `total_count` is reached. The guide also suggests an admin-triggered variant.
- "Next steps": "Migrate other entities, such as orders, customers, and categories… following the same pattern… using workflows and scheduled jobs."
- Implied idempotency key: `external_id` on products/variants, set to the source ID. For Shopify, use the GraphQL GID or its numeric id.

### 3. Shopify side (current APIs)

- "The REST Admin API is a legacy API as of October 1, 2024." "Starting April 1, 2025, all new public apps must be built exclusively with the GraphQL Admin API." The current version is `2026-07`. Source: https://shopify.dev/docs/api/admin-rest
- Bulk export: `bulkOperationRunQuery` writes JSONL, with nested connections flattened via `__parentId`. The result URL expires after one week. Since API 2026-01, up to 5 concurrent bulk queries are allowed per shop. Source: https://shopify.dev/docs/api/usage/bulk-operations/queries

### 4. Entity mapping (Shopify to Medusa 2.21)

My own mapping. Medusa terms come from its commerce modules.

| Shopify | Medusa |
|---|---|
| Product (handle, title, descriptionHtml, status, vendor, productType, tags, SEO) | Product (`handle`, `title`, `description`, `status` published/draft, `type`, `tags`, `metadata`, `external_id`) |
| Options / optionValues | Product options and values. Global options are allowed in imports since 2.18. |
| Variant (sku, barcode, price, compareAtPrice, weight, inventoryItem) | Variant (`sku`, `barcode`, `prices[]` per currency/region, `weight`, `manage_inventory`) plus an Inventory Item linked to the variant. Handle compare-at price via a price list (sale) or metadata. |
| Media / images | Product `images[]` and `thumbnail`. Re-upload to our file provider (S3/OCI) instead of hot-linking the Shopify CDN. |
| Collections (custom/smart) | Product Collections (one per product) or **Product Categories** (many-to-many, nested). Smart-collection rules do not map, so materialize their members. |
| Inventory levels per location | Stock Location plus inventory levels (`stocked_quantity`) |
| Customers (email, name, phone, addresses, tags, marketing consent) | Customer (`email`, `first_name`, `last_name`, `phone`, `addresses`, `metadata`), Customer Groups for tags |
| Orders | Order module. The docs claim support only loosely ("can also support… orders and customers"). No official order-import workflow exists, so historical orders need a custom workflow or should be kept read-only in metadata/archive. |
| Discounts | Promotions (rules differ; recreate by hand) |
| Gift cards | Loyalty plugin gift cards (`@medusajs/loyalty-plugin`), migrated by hand |
| URL redirects | Handled in the storefront (Next.js redirects/proxy), not Medusa |

### 5. Customers and passwords

- The Medusa docs say nothing about migrating passwords.
- Medusa `emailpass` hashes with **scrypt** (`scrypt-kdf`, default `{ logN: 15, r: 8, p: 1 }`; `packages/modules/providers/auth-emailpass/src/services/emailpass.ts`). Shopify hashes cannot be verified by it.
- Third-party migration vendors report that Shopify does not export passwords or hashes, and advise sending account invite or password-reset emails (Praella, Flux, Cart2Cart). Not verified against Shopify official docs (UNVERIFIED).
- Medusa behaviour (verified in source, `packages/core/core-flows/src/customer/steps/validate-customer-account-creation.ts` and the customer model):
  - The customer email is unique per `(email, has_account)` where `deleted_at IS NULL`.
  - When a registered-account customer is created for an email that exists only as a **guest** (`has_account=false`), account creation is allowed. It creates a **second** customer row with `has_account=true`.
  - So importing Shopify customers as guests means that when they later register, their account customer is a separate row from the imported guest (and its linked orders).
- Options (my inference; UNVERIFIED end-to-end):
  - **(a)** Import customers with `has_account=true` and create an `emailpass` auth identity with a random password, linked via `app_metadata.customer_id`. Then send a "set your password" email using Medusa's reset-password flow (`/auth/customer/emailpass/reset-password` then the `auth.password_reset` event). References: https://docs.medusajs.com/resources/commerce-modules/auth/reset-password and https://docs.medusajs.com/resources/storefront-development/customers/reset-password
  - **(b)** Import as guests and merge on registration with a custom subscriber.

## Sources

- https://docs.medusajs.com/learn/introduction/build-with-llms-ai/mcp-server/migrate-from-shopify
- https://docs.medusajs.com/resources/integrations/guides/magento ; https://github.com/medusajs/examples/tree/main/migrate-from-magento
- https://docs.medusajs.com/llms.txt (it contains no Shopify recipe entry)
- Medusa source at 7b3fe04 (2.21.1): `packages/modules/providers/auth-emailpass/src/services/emailpass.ts`, `packages/core/core-flows/src/customer/steps/validate-customer-account-creation.ts`, `packages/modules/customer/src/models/customer.ts`
- https://shopify.dev/docs/api/admin-rest ; https://shopify.dev/docs/api/usage/bulk-operations/queries
- Third-party, for passwords: https://praella.com/blogs/shopify-insights/shopify-migration-handling-customer-passwords-during-transition , https://flux.agency/insights/customer-account-migration-why-passwords-dont-carry-over

## Confidence

- **High:** what the official docs say, and the Medusa customer and auth behaviour (from source).
- **Medium:** the entity mapping (my own synthesis).
- **Low / UNVERIFIED:** whether Shopify can export passwords (third-party claims only), and the exact auth-identity import procedure.

## Implications for us

1. Follow the official pattern: a `shopify` module wrapping the GraphQL Admin API (bulk operations), idempotent workflows keyed on `external_id`, and triggers from a CLI (`medusa exec`), a scheduled job and optionally an admin widget.
   - Run **products → categories/collections → inventory → customers → orders** in that order.
2. Re-host all images to our S3-compatible bucket during import. Do not keep Shopify CDN URLs.
3. Customers: create them as account holders with an `emailpass` identity and send a one-time password-reset email at cutover. We cannot migrate passwords.
4. Orders: decide whether to import historical orders into the Order module (a custom workflow; there is no official importer) or keep a read-only archive linked by email. The Medusa docs only loosely claim order support.
5. Do not mix the CSV importer with the API importer on the same database.
