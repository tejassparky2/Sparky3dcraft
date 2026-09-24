# Research summary

Research done 2026-09-24. Details and sources are in `external/` (see `external/INDEX.md`). Decisions are in `decisions/`.

| Topic | Finding | Consequence |
|---|---|---|
| Medusa version | 2.21.1 is the current stable. 2.21.0 introduced a **strict Store API field allowlist**: non-allowed fields are silently dropped, and non-allowed sort gives a 400. 2.20.1 fixed a field-filter bypass | Pin 2.21.1. The storefront requests only allowed fields, and categories come via `/store/product-categories` (ADR-002, ADR-007) |
| Redis modules | Exact 2.21.1 configuration. `workflow-engine-redis` needs a nested `redis.redisUrl` (#16697). Core caching is a WIP flag with an open OOM bug. `cache-redis` is still needed for auth (#16498) | ADR-004 |
| Worker mode | Server and worker from one build. Webhooks, subscribers and jobs run on the worker | Two systemd units |
| Razorpay | All v2 community packages are defective: webhooks ignored, rupees instead of paise, unawaited captures | Custom provider (ADR-003) |
| Shopify migration | Official path = MCP-assisted or a Magento-style custom script. No password export | Custom idempotent importer with source mapping, plus activation emails (ADR-011) |
| Search | `q` = ILIKE. The Search Module is new, and the Index Module is experimental | `q` (ADR-006) |
| OCI Object Storage | Path-style, Customer Secret Key, no ACLs, `WHEN_REQUIRED` checksums, CRC32 on bulk delete rejected. Always Free: 20 GB and 50k requests/month | ADR-005, RISKS R-05/R-06 |
| OCI networking | Never enable UFW on OCI Ubuntu. Insert iptables ACCEPT rules before the REJECT rule and persist. Also open ports in the Security List | Installer `open_firewall_ports` |
| OCI Always Free A1 | 2 OCPU / 12 GB. Idle instances are reclaimed below 20% utilisation over 7 days | RISKS R-07 |
| Next.js 16 | `proxy.ts`, async request APIs, two-argument `revalidateTag`, `next lint` removed, local-IP images blocked by default | Storefront written for 16 (ADR-013) |
| Live site | 9 products, 2 collections, only a privacy policy, INR tax-inclusive, India only, no COD, Craft theme 15.5.0 | `docs/audit/LIVE-SITE-AUDIT.md` |

## Confidence and open items

- **High:** versions, Store API behaviour, Redis config (docs and source), Razorpay API contract (official docs), `q` semantics (source).
- **Medium:** OCI S3 edge cases. They come from Oracle docs plus a third-party test. Our tests used an S3 emulator, not OCI.
- **Unverified:**
  - real Razorpay behaviour with our provider
  - OCI anonymous-listing semantics of the public bucket setting (the installer's `s3-check` tests reads, not listing)
  - Shopify Admin API behaviour with a real token (tested only against a schema-faithful fixture)
