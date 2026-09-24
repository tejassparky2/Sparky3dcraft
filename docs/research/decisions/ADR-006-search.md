# ADR-006: Product search via Medusa `q` (Postgres ILIKE)

- **Status:** accepted (2026-09-24)

## Question
How is `/search` implemented?

## Current evidence
- The catalog has **9 products** (audit).
- `q` on `/store/products` performs an ILIKE substring match over the product's searchable fields (verified in the DAL source).
- The 2.21.1 Search Module (`POST /store/search`, Postgres provider) requires an index definition plus `pg_trgm`/`unaccent`. Its migration soft-fails without superuser rights.
- The Index Module is still experimental and behind a flag.

## Sources
- `docs/research/external/medusa-search-and-files.md`, `medusa-release-notes.md`
- https://docs.medusajs.com/resources/infrastructure-modules/search

## Options
1. `q` filter.
2. The Search Module with the Postgres provider.
3. Meilisearch or Algolia.

## Chosen
Option 1. The storefront `/search?q=` and the header search modal call `/store/products?q=`.

## Reason
- The catalog is tiny, so ILIKE is instant and exact-substring results match what shoppers expect.
- No extra service and no experimental module.

## Tradeoffs
- No typo tolerance or relevance ranking.
- Result counts can differ slightly from Shopify's.
- Revisit above roughly 1,000 products (the Search Module is the upgrade path, and the installer already creates `pg_trgm`/`unaccent`).

## Impact
`apps/storefront/src/app/search`, `src/app/api/search`.

## Verification
- E2E `browse.spec.ts` covers search.
- `final-verification.sh` checks that `/search?q=Rayara` returns results on the server.
