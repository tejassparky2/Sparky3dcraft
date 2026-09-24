---
name: shopify-migration
description: Run, extend or debug the Shopify → Medusa importer (public JSON / Admin GraphQL / CSV) safely and idempotently. Use for any catalog, customer or order migration work or cutover delta import.
---

# Shopify migration

Shopify is **read-only**. All imports go through `sparky_source_mapping`. Never mix source methods without the mapping (RULE 11).

## Procedure (local)
1. Probe:
   ```bash
   cd apps/backend
   IMPORT_MODE=probe SHOPIFY_SOURCE=<public|admin> ... npm run import:shopify
   ```
2. Dry-run:
   ```bash
   IMPORT_MODE=dry-run SHOPIFY_SOURCE=public SHOPIFY_STORE_URL=https://sparky3dcraft.tech npm run import:shopify
   ```
   Read the create/update/adopt/unchanged counts.
3. Apply: same command with `IMPORT_MODE=apply`, after `pg_dump -Fc` of the database.
4. Re-run apply. **Every count must be `unchanged`**. That is the idempotency proof.
5. Personalization: `npm run apply:personalization` (from `data/personalization.json`).

## Procedure (server)
```bash
sudo ./deploy/migrate.sh --probe
sudo ./deploy/migrate.sh
sudo ./deploy/migrate.sh --apply
```
`--apply` takes a backup first.

## When changing importer logic
- Bump `IMPORTER_MAPPING_VERSION` in `src/lib/shopify/importer.ts`. Checksums include it, so changed logic re-applies once.
- Merge into existing metadata. Never overwrite merchant-edited fields without reason.
- Images: re-uploads happen only with `IMPORT_FORCE_IMAGES=true`, and old objects are orphaned.

## Validation
```bash
cd apps/backend && npm run test:unit        # normalize tests
bash tests/integration/shopify-import.sh     # 15 checks: idempotency, adoption, historical orders, links
```

## Expected evidence
- Dry-run and apply logs. Second-run counts are all `unchanged`.
- Product and category counts equal Shopify's (`/meta.json`).
- `final-verification.sh` CATALOG section PASS: prices, compare-at, handles, and no Shopify CDN images.

## Failure handling
- Partial apply: re-run. The mapping makes it resume without duplicates.
- Wrong data: restore the pre-apply backup (`restore.sh --from … --yes-restore-production`), fix, and re-run.
- Never delete Medusa products in bulk to "start over" in production.
- Never migrate passwords. Never create payments for historical orders.
- After cutover, imports are refused (`SPARKY_CUTOVER_COMPLETED`). Override only with the merchant's agreement.
