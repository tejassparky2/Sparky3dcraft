# ADR-005: OCI Object Storage via the S3-compatible API for media

- **Status:** accepted (2026-09-24)

## Question
Where do product media, customer personalization photos and off-machine backups live?

## Current evidence
- Medusa's `@medusajs/file-s3` works with any S3-compatible endpoint.
- OCI's S3 compatibility API:
  - Endpoint `https://<ns>.compat.objectstorage.<region>.oraclecloud.com`.
  - Needs **path-style** addressing and a Customer Secret Key.
  - Has **no object ACLs** (file-s3 2.21.1 has `acl: false`).
  - Rejects `x-amz-checksum-crc32` on `DeleteObjects`, so SDK checksums must be `WHEN_REQUIRED`. Bulk deletes may still fail, which leaves orphaned objects.
  - Public objects are served from `https://objectstorage.<region>.oraclecloud.com/n/<ns>/b/<bucket>/o/<key>`.
- Always Free includes 20 GB and **50,000 API requests/month**.

## Sources
- `docs/research/external/oci.md`, `medusa-search-and-files.md`
- https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm
- https://docs.medusajs.com/resources/infrastructure-modules/file/s3

## Options
1. Local disk behind nginx.
2. OCI Object Storage (S3 API).
3. Cloudflare R2 or AWS S3.

## Chosen
OCI Object Storage (option 2), with three buckets:
- `sparky-media`: public read on objects, no listing
- `sparky-private`: customer photos, served only through an Admin-authenticated route
- `sparky-backups`: encrypted backups

`FILE_PROVIDER=local` is allowed only in staging. The installer refuses it in production.

## Reason
- Same cloud and region as the VM, with free-tier capacity.
- Media survives VM loss.
- The S3 API keeps the code portable to R2 or S3 by changing the endpoint only.

## Tradeoffs
- The API-request quota: mitigated by Next.js image optimization caching.
- Orphaned objects after bulk deletes (a known OCI incompatibility).
- Public URLs expose the tenancy namespace, which is not a secret.

## Impact
- `medusa-config.ts` (s3 provider options) and `deploy/scripts/s3-check.mjs`, which checks put/get/delete and anonymous reads during install.
- Storefront `MEDUSA_IMAGE_HOSTS`.

## Verification
- Install, image upload, public read and encrypted backup upload/download were verified against an S3-compatible emulator (moto) with the same client options.
- **Not yet verified against real OCI Object Storage** (no OCI credentials available).
