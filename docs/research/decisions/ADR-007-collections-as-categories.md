# ADR-007: Shopify collections → Medusa product categories

- **Status:** accepted (2026-09-24)

## Question
How do the two Shopify collections (`customized-gifts`, `customized-idols`), their images, descriptions and manual order map to Medusa?

## Current evidence
- Medusa has both *collections* (one per product, no image and no description by default) and *categories* (many per product, handle, description, metadata, tree).
- In 2.21 the Store API strict allowlist silently drops `categories.*` on `/store/products`. `/store/product-categories?fields=…,products.id` works.
- Shopify products can belong to several collections.

## Sources
- `docs/research/external/medusa-release-notes.md` (Store API allowlist, #16702)
- `docs/audit/LIVE-SITE-AUDIT.md` §4

## Options
1. Medusa collections.
2. Medusa categories.
3. A custom module.

## Chosen
Categories:
- same handle, title and description
- image stored in `metadata.image_url` (alt in `metadata.image_alt`)
- manual order stored in `metadata.product_order` (comma-separated handles)

## Reason
Categories allow many-to-many membership, like Shopify, and carry the metadata we need. The URL `/collections/<handle>` is served by the storefront from the category.

## Tradeoffs
- In Admin, merchants edit "Categories", not "Collections". Documented in OPERATIONS.md.
- Manual order is a metadata string, not a drag-and-drop UI.

## Impact
Importer, storefront `collections/[handle]`, sitemap, SEO breadcrumbs.

## Verification
- The import integration test checks 2 categories and their membership.
- E2E browse covers collection pages.
- `final-verification.sh` checks that every Shopify handle exists.
