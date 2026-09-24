# Security

## Network exposure

| Port | Bound to | Public |
|---|---|---|
| 22 SSH | all | yes (restrict to your IP in the OCI Security List if possible) |
| 80 / 443 nginx | all | yes |
| 3000 Next.js | 127.0.0.1 | **no** |
| 9000 Medusa server, 9001 worker health | 127.0.0.1 | **no** |
| 5432 PostgreSQL | localhost | **no** (`listen_addresses='localhost'`, scram-sha-256) |
| 6379 Redis | 127.0.0.1 / ::1 | **no** (password required, `protected-mode`) |

- `final-verification.sh` fails on **any** other listening public port.
- Host firewall: the OCI image's iptables policy with ACCEPT rules inserted for 80 and 443. **UFW is not used on OCI.**

## Secrets

- Never in git. `.gitignore` excludes `.env*` except `*.env.example`. Templates contain placeholders only:
  - `apps/backend/.env.example`
  - `apps/storefront/.env.example`
  - `deploy/answers.example.env`
- On the server:
  - `/etc/sparky/secrets.env` (0600 root) holds installer answers that are secrets.
  - `/etc/sparky/backend.env` and `storefront.env` (0640 root:sparky) hold the runtime environment.
  - The backup encryption key is `BACKUP_ENCRYPTION_KEY` in `secrets.env`. **Keep an offline copy.** Without it, off-machine backups cannot be decrypted.
- Generated secrets (JWT, cookie, revalidate, DB and Redis passwords) come from `openssl rand`, 24–48 bytes.
- In production the backend **refuses to start** (`apps/backend/src/lib/env.ts`) if:
  - a secret is shorter than 32 characters or a known default (`supersecret`, `password`, `123456`, …)
  - the DB password is weak
  - CORS contains `*`
  - Redis is missing
  - a test-only override is set (`RAZORPAY_API_BASE`, `SMTP_INSECURE_NO_TLS`). The Shopify importer separately refuses `SHOPIFY_ADMIN_API_BASE_TEST_ONLY` in production
- Env files are parsed as data (`load_env_file`), never `source`d, so a value can't execute code.
- Nothing logs secrets:
  - Shopify tokens are never logged.
  - Payment secrets are only used for HMAC and HTTP Basic auth.
  - Installer logs (0600) record commands, not values.
  - DB passwords reach psql via stdin, never argv.

## Payments

See docs/PAYMENT.md.

- Webhooks: HMAC-SHA256 over the raw body with the webhook secret, compared in constant time. Replays are deduplicated by event id.
- Orders: never marked paid from the browser. Payment status is fetched server-side from Razorpay.
- Amounts: exact paise conversion, and the amount and currency must match.
- Refunds: idempotent via `receipt`.

## Application

- **Customer auth:** Medusa emailpass (scrypt).
  - The session JWT lives in an **httpOnly, Secure, SameSite=Lax** cookie set by the Next server. The browser never sees the token (`jwtTokenStorageMethod: "nostore"`).
  - Password reset tokens are single-use and valid for 15 minutes. The reset page sends no referrer.
- **Order pages:** Medusa's `/store/orders/:id` is unauthenticated by design. The storefront only shows an order to its logged-in owner, or to the browser that placed it (httpOnly `_sparky_orders` cookie).
- **Personalization:**
  - The server enforces required fields, allowed choice values and text lengths, and strips client-supplied metadata on updates.
  - Uploaded photos are content-sniffed (JPEG/PNG/WebP/HEIC/AVIF), limited to 15 MB, and stored in **private** storage.
  - Only authenticated Admin users can download them (`/admin/sparky/uploads/:id`).
  - Unattached uploads are purged after `UPLOAD_RETENTION_DAYS`.
- **Rich text:** product HTML from Shopify is sanitized (`sanitize-html` allowlist) before rendering. Policies are rendered from Markdown with HTML escaped.
- **Forms** (contact, newsletter, uploads):
  - nginx rate limits (6/min per IP) and body-size limits
  - a honeypot field
  - server-side validation
- **Admin:** served at `https://api.<domain>/app`. Rate limits: `/auth/` 10 requests/min per IP (burst 10), the API 30 r/s. Use a strong, unique admin password. Invite other staff from Admin → Settings → Users.
- **Headers:**
  - HSTS (1 year) on HTTPS
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: SAMEORIGIN`
  - `Permissions-Policy` (camera/mic/geolocation off; payment only for self and Razorpay)
  - `server_tokens off`
  - TLS 1.2/1.3 only
  - No CSP yet: Razorpay checkout.js loads iframes and scripts from several Razorpay domains, and a CSP needs testing against live Razorpay (RISKS.md R-09).

## Host

- **Services** run as the unprivileged `sparky` user with systemd hardening: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, kernel protections, and write access only to `/var/lib/sparky`, the log directory and the Medusa build directory.
- **SSH:** `final-verification.sh` warns if password or root-password login is enabled. Recommended in `/etc/ssh/sshd_config.d/10-sparky.conf`:
  `PasswordAuthentication no`, `PermitRootLogin no`, then `sudo systemctl reload ssh`. Test a
  second key-based session **before** closing the current one.
- **Automatic security updates:** Ubuntu's `unattended-upgrades` covers OS packages. It is usually enabled on Ubuntu cloud images, but the installer does not configure it, so check with `systemctl status unattended-upgrades` (ASSUMED, not verified on OCI). Node, npm dependencies and Medusa are **never** auto-upgraded. They change only via `deploy/upgrade.sh --ref`.

## Dependencies (npm audit, 2026-09-24)

- **Storefront** production dependencies: 0 advisories.
- **Backend** production dependencies:
  - `lodash` ≤4.17.23 (GHSA-r5fr-rjxr-66jc, high), pulled in by Medusa's CLI via `inquirer` and `graphql-codegen`. **Fixed** by `overrides.lodash = 4.18.1` in `apps/backend/package.json`, the same version `knex` already uses. Typecheck, 39 unit tests and a full build pass.
  - `vite` 5.x (GHSA-fx2h-pf6j-xcff, high: `server.fs.deny` bypass **on Windows** in the **Vite dev server**), pulled in by `@medusajs/types` and the admin bundler. **Accepted, not applicable.** Production never runs a Vite dev server: the Admin is prebuilt static files served by `medusa start` on Linux. Re-check on each Medusa upgrade. Do not force a major Vite override under Medusa's admin bundler.
  - Moderate: `esbuild`/`vite` dev-server issues, `ajv` `$data` ReDoS, `uuid` v3/v5/v6 buffer bounds. These are not reachable with untrusted input in our code paths. Review on each upgrade.

## Legal pages

- The privacy policy is copied **verbatim** from Shopify. It is marked `requires-merchant-approval` because it mentions Shopify, which no longer applies after the migration.
- Terms, shipping and refunds **do not exist** on the live store. They are placeholders with status `missing`.
- **No legal wording was written or invented.** The merchant or their counsel must supply and approve it (`apps/storefront/content/policies/*.md`, set `status: approved`).
- `final-verification.sh` treats this as MANUAL in staging and **FAIL in production**.
- Razorpay's live-mode website verification also expects these pages.
