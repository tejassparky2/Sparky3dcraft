# ADR-009: Personalization as product metadata + validated line-item metadata

- **Status:** accepted (2026-09-24)

## Question
The live store uses a Shopify personalization app. The lithophane lamp takes a photo upload and a colour choice, and other products take text. How do we reproduce it?

## Current evidence
- The audit (§5.2) documents the app's fields per product. There is no Medusa-native product customization feature.
- Medusa line items accept `metadata`.
- In Medusa 2.21 the Store API lets a client write arbitrary line-item metadata, so a client could forge or omit fields.

## Sources
- `docs/audit/LIVE-SITE-AUDIT.md` §5.2, `apps/backend/data/personalization.json`

## Options
1. A custom module with its own tables and Admin UI.
2. Flat product metadata keys describing the fields, with server-side validation of line-item metadata in middleware.

## Chosen
Option 2:
- Product keys: `personalization_photo`, `_photo_label`, `_choice_name`, `_choice_values` (`NAME:#hex,…`), `_choice_required`, `_text_*`.
- Middleware on `POST /store/carts/:id/line-items` enforces required fields and allowed values, and strips unknown keys.
- Middleware on line-item updates strips client metadata.
- Photos upload to `/store/sparky/uploads` (content-sniffed, 15 MB max) into **private** storage. They are attached to the order by the `order-attach-uploads` subscriber and downloadable only in Admin.

## Reason
- Editable in Admin as plain metadata, with no extra tables for product configuration.
- The server remains the authority on what a valid personalization is.

## Tradeoffs
- Metadata editing is less friendly than a dedicated UI.
- The uploads table (`sparky_customer_upload`) is the only extra storage.

## Impact
Backend middleware, uploads route, Admin order widget; storefront `ProductForm` and cart display.

## Verification
- API tests: a missing photo is rejected, an invalid colour is rejected, and forged metadata is stripped.
- The E2E cart spec uploads a photo, adds to cart and checks out.
- The Admin order widget (download link) is **not covered by an automated test**.
