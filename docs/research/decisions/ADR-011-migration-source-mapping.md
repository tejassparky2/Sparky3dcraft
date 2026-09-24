# ADR-011: Shopify migration with a source-ID mapping table

- **Status:** accepted (2026-09-24)

## Question
How do we import from Shopify repeatedly (staging, rehearsal, final delta) without duplicates, and without mixing CSV and API methods unsafely (RULE 11)?

## Current evidence
- Medusa's official Shopify guidance is an MCP-assisted flow plus the Magento reference pattern: fetch, transform, then run workflows.
- Neither provides idempotent re-runs.
- Public JSON exposes products and collections without credentials. The Admin GraphQL API adds inventory, customers and orders. CSV exports lack stable IDs for some fields.

## Sources
- `docs/research/external/medusa-shopify-migration.md`
- https://docs.medusajs.com/resources/integrations/guides/magento

## Options
1. A one-shot import, wiping the database between runs.
2. Matching by handle only.
3. A mapping table keyed by source ID with a checksum per entity.

## Chosen
Option 3, using `sparky_source_mapping`:
- Rows are `(source, entity_type, source_id)`, unique, and map to `medusa_id` plus a checksum.
- Unmapped products with the same handle are adopted, not duplicated.
- A source-method switch is refused unless explicitly allowed.
- After cutover, imports are refused unless explicitly allowed.
- Every run stores its snapshot and a run record.

## Reason
It makes re-runs safe and incremental, detects changes by checksum, supports the final delta at cutover, and gives an audit trail.

## Tradeoffs
- More code than a one-shot script.
- The checksums include an importer mapping version, so a logic change re-applies all entities once.

## Impact
`apps/backend/src/lib/shopify`, `deploy/migrate.sh`.

## Verification
`tests/integration/shopify-import.sh` (15 checks) covers:
- two consecutive runs → no duplicates
- CSV-after-API adoption by handle
- historical orders flagged with no payment records
- customers linked

Import from the **live** public store: 9 products, 27 images, 9 sale prices, 2 categories, 2 videos. Re-runs are unchanged.
