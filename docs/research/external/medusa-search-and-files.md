# Medusa 2.21.1: search options and the S3 File Module Provider

Researched: 2026-09-24.

## Question

1. What are the current product-search options in Medusa 2.21.1? This covers the Index Module, Postgres-backed search, and the `q` parameter on `/store/products`.
2. What options does the S3 File Module Provider take, and what notes exist for S3-compatible providers?

## Findings

### A. Search

**1. `q` on `GET /store/products`**

The validator accepts `q: z.string().optional()` (`packages/medusa/src/api/store/products/validators.ts`).

Searchable fields are marked `.searchable()` in the data models:

- Product: `title`, `subtitle`, `description`, and the `variants` relation
- ProductVariant: `title`, `sku`, `barcode`, `ean`, `upc`

The DAL free-text filter (`packages/core/utils/src/dal/mikro-orm/mikro-orm-free-text-search-filter.ts`) applies `$ilike: %q%` across those fields. That is a case-insensitive substring match, not full-text search: there is no ranking and no typo tolerance.

**2. Search Module (new; GA for the storefront in 2.21.1)**

Docs: https://docs.medusajs.com/resources/infrastructure-modules/search

- "As of v2.21.1, the Search Module is registered by default in your Medusa application with the PostgreSQL Search Module Provider, so you only declare the indexes to search."
- Search Module options: `providers`, `default_provider`, `index_prefix`, `reindex.batch_size` (default 100).
- The **PostgreSQL provider** (`@medusajs/medusa/search-postgres`, id `search-postgres`) "can be used for development and in production".
  - Options: `language` (default `english`) and `engine` (`native`).
  - Its migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and `unaccent` and creates the `medusa_search_english` text search config.
  - If those statements fail for lack of privileges, the migration logs a NOTICE and continues ("soft-fail"), but the provider "assumes these extensions … exist at runtime" (`Migration20260807120000.ts`).
- Features: relevance ranking, filters, facets, highlighting, typo tolerance via trigrams, and zero-downtime versioned reindex.
- Index definitions live in `src/search/<name>.ts`: name, entity, fields, seed, events. New 2.21.1 projects get a `product` index; upgraded projects must add one.
- The storefront endpoint is **`POST /store/search`** (InstantSearch-compatible). It exposes nothing until you add:

  ```ts
  // src/api/middlewares.ts
  import { configureStoreSearch, defineMiddlewares } from "@medusajs/framework/http"
  export default defineMiddlewares({
    routes: [{ matcher: "/store/search", middlewares: [configureStoreSearch({ allowed_indexes: { product: true, product_category: true } })] }],
  })
  ```

  Example request: `curl -X POST .../store/search -H "x-publishable-api-key: pk_..." -d '{"entity":"product","filters":{"q":"shirt"}}'`
- For `product` indexes, Medusa automatically filters to `status = published` and to the publishable key's sales channels, provided the index declares `status` and `sales_channel_ids` as `filterable`.
- Migration guides from Algolia and MeiliSearch exist (per the 2.21.1 release notes).
- The in-memory (Orama) provider was **removed in 2.20.0**.
- Open issue #16956 (2026-09-24): "a cold `ActiveIndexVersionCache` refresh can overwrite `set()` and leave 'has no active version yet' for up to 30 s after an index is activated".

**3. Index Module**

- Still documented as **"Experimental … subject to change … increasingly stable for production use."**
- It is behind the `index-engine` feature flag (`MEDUSA_FF_INDEX_ENGINE`; `default_val: false`). `/store/products` switches to it only when the flag is enabled.
- Used for cross-module filtering, for example filtering products by linked-module fields. It is not full-text search.

**4. Third-party:** `@rokmohar/medusa-plugin-meilisearch@2.2.0` (published 2026-09-11) is active on npm. Not evaluated in depth.

### B. S3 File Module Provider (`@medusajs/medusa/file-s3`, id `s3`)

Docs (https://docs.medusajs.com/resources/infrastructure-modules/file/s3), verbatim config:

```ts
{
  resolve: "@medusajs/medusa/file",
  options: {
    providers: [
      {
        resolve: "@medusajs/medusa/file-s3",
        id: "s3",
        options: {
          file_url: process.env.S3_FILE_URL,
          access_key_id: process.env.S3_ACCESS_KEY_ID,
          secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
          region: process.env.S3_REGION,
          bucket: process.env.S3_BUCKET,
          endpoint: process.env.S3_ENDPOINT,
          // other options...
        },
      },
    ],
  },
},
```

The docs say "The File Module accepts one provider only."

"If you're using MinIO or Supabase, set `forcePathStyle` to `true` in the `additional_client_config` object":

```ts
options: { /* ... */ additional_client_config: { forcePathStyle: true } }
```

Documented options:

| Option | Meaning | Default |
|---|---|---|
| `file_url` | Base URL for returned file URLs | none |
| `access_key_id` | Access key ID | none |
| `secret_access_key` | Secret access key | none |
| `region` | Region code; `us-east-1` for MinIO, `auto` for R2 | none |
| `bucket` | Bucket name | none |
| `endpoint` | S3 endpoint URL | none |
| `prefix` | Key prefix | none |
| `cache_control` | Cache-Control header | `public, max-age=31536000` |
| `download_file_duration` | Presigned GET expiry in seconds | 3600 |
| `additional_client_config` | Spread into `new S3Client({...})` | none |

Additional options found in source (`@medusajs/file-s3@2.21.1` dist, `packages/modules/providers/file-s3/src/services/s3-file.ts`) but not in the docs table:

- `authentication_method` (`"access-key"` default, or `"s3-iam-role"`)
- `session_token`
- **`acl`**: an `ObjectCannedACL` or **`false`**. With `acl: false`, **no `ACL` header is sent** on server-side uploads, which is needed for buckets without ACL support. Otherwise uploads send `ACL: "public-read"` or `"private"` depending on file access.

Behaviour from source:

- Upload key: `${prefix}${dir/}${name}-${ulid}${ext}`.
- Returned URL: `${file_url}/${encodeURIComponent-per-segment(key)}`.
- Metadata `original-filename` is set.
- Multipart streaming uploads use `@aws-sdk/lib-storage` `Upload`.
- `delete([...])` uses **`DeleteObjectsCommand`** (bulk delete). `delete(file)` uses `DeleteObjectCommand`. **Errors are swallowed** (empty catch with a TODO).
- Presigned upload uses `getSignedUrl(PutObjectCommand)` and adds ACL only when `access` is provided.
- Dependencies: `@aws-sdk/client-s3 ^3.980.0`. The npm latest is 3.1139.0, so installs get recent SDKs with default flexible checksums.

Troubleshooting notes in the docs:

- Cloudflare: `Header 'x-amz-checksum-crc32' … not implemented` comes from the SDK setting a checksum algorithm by default since 3.729.0. The docs' workaround is to pin `"@aws-sdk/client-s3": "3.726.1"` via resolutions ("must be less than 3.729.0").
- AWS: the bucket must allow ACLs. The steps enable "ACLs enabled" and public read.

## Sources

- https://docs.medusajs.com/resources/infrastructure-modules/search ; `/search/providers/postgres` ; `/search/store-search`
- https://docs.medusajs.com/learn/fundamentals/query/index-module
- https://docs.medusajs.com/resources/infrastructure-modules/file/s3 ; https://docs.medusajs.com/resources/troubleshooting/s3
- Source at 7b3fe04 (2.21.1):
  - `packages/medusa/src/api/store/search/route.ts`, `packages/medusa/src/api/store/products/{validators,route}.ts`
  - `packages/modules/product/src/models/{product,product-variant}.ts`
  - `packages/modules/providers/search-postgres/src/migrations/Migration20260807120000.ts`
  - `packages/medusa/src/feature-flags/index-engine.ts`
  - `packages/modules/providers/file-s3/src/services/s3-file.ts`
- npm tarball `@medusajs/file-s3@2.21.1` (`dist/services/s3-file.js`)
- https://github.com/medusajs/medusa/issues/16956

## Confidence

- **High:** facts read from source and docs.
- **High:** the `q` semantics (ILIKE substring, verified in the DAL source).

## Implications for us

1. For launch, `q` on `/store/products` covers simple search. For a better experience, use the **built-in Postgres Search Module**: define a `product` index, add `configureStoreSearch` for `product`, and pre-create `pg_trgm` and `unaccent` as the superuser before `db:migrate`. This needs no Meilisearch or Algolia infrastructure on the small VM.
2. Leave the Index Module flag off.
3. For OCI Object Storage (see oci.md), configure the provider like this:

   ```ts
   options: {
     file_url: "https://objectstorage.<region>.oraclecloud.com/n/<ns>/b/<bucket>/o",   // public read URL base (see oci.md)
     access_key_id, secret_access_key,               // OCI Customer Secret Key
     region: "<oci-region-id>",                       // e.g. ap-mumbai-1
     bucket: "<bucket>",
     endpoint: "https://<ns>.compat.objectstorage.<region>.oraclecloud.com",
     acl: false,                                     // OCI has no object ACLs
     additional_client_config: {
       forcePathStyle: true,
       requestChecksumCalculation: "WHEN_REQUIRED",
       responseChecksumValidation: "WHEN_REQUIRED",
     },
   }
   ```

   Test uploads, bulk delete and presigned URLs against the real bucket. Bulk-delete failures are swallowed silently, so check for orphaned objects.
