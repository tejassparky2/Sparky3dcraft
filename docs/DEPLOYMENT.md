# Deployment (Oracle Cloud Ampere A1, Ubuntu 24.04)

The installer is `deploy/install.sh`. It runs these stages in order:

`preflight system node database redis existing medusa storage storefront migration systemd nginx tls backups tests`

- Every stage is idempotent. Completed stages are recorded in `/var/lib/sparky/state/*.done` and skipped on re-run.
- A failure prints the stage, the command, the last log lines, the likely cause, and a note that a re-run is safe.
- Nothing is exposed publicly except nginx on 80/443 (plus SSH on 22).

> **Default mode is `staging`.** Staging sets `noindex` and `robots: Disallow`, and allows test
> keys. Switch to production only as the last step of the cutover in `docs/MIGRATION.md`.

## 0. What you need before starting

| Item | Where | Needed for |
|---|---|---|
| OCI VM.Standard.A1.Flex, 2 OCPU / 12 GB, Ubuntu 24.04, ≥ 50 GB boot volume | OCI Console | everything |
| Security List / NSG ingress: TCP 22 (your IP if possible), 80, 443 | OCI Console → VCN | web, certificates |
| DNS A records: storefront domain (and `www`), `api.` domain → VM public IP | DNS provider | TLS, cutover |
| Buckets: `sparky-media` (public read, objects only), `sparky-private` (private), `sparky-backups` (private) | OCI Object Storage | media, uploads, backups |
| Customer Secret Key (S3 access key + secret) for a user with access to those buckets | OCI → Identity → User → Customer secret keys | S3 API |
| Razorpay key id/secret + webhook secret (test first, live at cutover) | Razorpay Dashboard | online payments |
| SMTP credentials (e.g. Zoho, SES, Brevo) with SPF/DKIM for your domain | email provider | order/reset emails |
| **Merchant-approved** shipping price and free-shipping threshold | merchant | checkout |
| Optional: Shopify Admin API token (read-only scopes: products, customers, orders) | Shopify Admin → Apps → Develop apps | customers + order history import |

For staging, use separate DNS names such as `staging.sparky3dcraft.tech` and
`api.staging.sparky3dcraft.tech`, so the live Shopify site is untouched.

## 1. Prepare the VM

```bash
ssh ubuntu@<vm-ip>
sudo apt-get update && sudo apt-get -y upgrade && sudo reboot   # once
git clone https://github.com/tejassparky2/Sparky3dcraft.git ~/Sparky3dcraft
cd ~/Sparky3dcraft && git checkout <release tag or commit>
```

**Do not enable UFW on OCI Ubuntu images.** The installer inserts ACCEPT rules for 80 and 443
before the image's REJECT rule and persists them with `netfilter-persistent`. You still
need to open 80 and 443 in the OCI Security List or NSG.

## 2. Install (staging)

Interactive:

```bash
sudo ./deploy/install.sh              # asks each question once; answers kept in /etc/sparky
```

Non-interactive:

```bash
sudo cp deploy/answers.example.env /root/sparky-answers.env && sudo chmod 600 /root/sparky-answers.env
sudo nano /root/sparky-answers.env
sudo ./deploy/install.sh --answers /root/sparky-answers.env --non-interactive
sudo shred -u /root/sparky-answers.env   # secrets now live in /etc/sparky (root-only)
```

Useful flags: `--from-stage <stage>`, `--only <stage>`, `--reset-state` (re-run every stage), `--mode staging|production`.

Expect about 15–25 minutes on the A1, mostly `npm ci` and the two builds.

The final `tests` stage runs `deploy/healthcheck.sh`. That checks the system, services,
ports, Redis, the database, nginx, HTTPS, the store API, products, a cart, checkout
options, payment providers, backups and restore verification.

## 3. Verify staging

```bash
sudo ./deploy/healthcheck.sh
sudo SPARKY_VERIFY_ADMIN_PASSWORD='<admin password>' ./deploy/final-verification.sh \
     --admin-email <admin email> --test-order
```

`final-verification.sh` is the acceptance gate. Its sections:

- **PLATFORM, HEALTH, REDIS:** no in-memory fallbacks.
- **DNS + TLS.**
- **CATALOG:** counts, prices and compare-at prices against the live Shopify JSON, and handles.
- **IMAGES:** content types, no Shopify CDN, alt text.
- **STOREFRONT/SEO:** redirects, JSON-LD, robots.
- **CHECKOUT/PAYMENT:** no fake provider, webhook rejects forged calls, and a COD order is placed and cancelled.
- **ADMIN CATALOG CYCLE:** create, edit, price, sale, stock, unpublish and delete, each checked on the storefront.
- **SECURITY:** public ports, file modes, secret strength, SSH, merchant policies, npm audit.
- **BACKUP/RESTORE/RECOVERY:** backup, restore into a temporary DB, off-machine copy, worker SIGKILL recovery, reboot test.

It prints `PRODUCTION READY = YES` only in production mode, with zero FAIL and zero MANUAL items outstanding.

Reboot test: `sudo ./deploy/final-verification.sh --prepare-reboot-test && sudo reboot`, then run it again.

Then run the browser test suite against staging from a workstation:

```bash
cd apps/storefront
E2E_BASE_URL=https://staging.sparky3dcraft.tech npx playwright test e2e/browse.spec.ts e2e/mobile.spec.ts
```

These two specs need no backend credentials (not yet run against a deployed staging server). The cart, checkout, account and admin specs need the local test stack (Razorpay fake, SMTP capture, admin login). On staging, pay with Razorpay **test** keys by hand (docs/PAYMENT.md).

## 4. Production cutover

Follow `docs/MIGRATION.md` §Cutover and `docs/release/RELEASE-CHECKLIST.md`. In short:

1. Freeze catalog edits on Shopify.
2. Run the final delta import.
3. `sudo ./deploy/install.sh --mode production --from-stage medusa` (live Razorpay keys, production domains).
4. Run verification.
5. Lower the DNS TTL, then switch DNS.
6. Run `--only tls`.
7. Run verification again, then place one real low-value order and refund it.
8. Keep Shopify running (unpublished storefront password or paused plan) as the rollback path.

## 5. Where things are

See `docs/ARCHITECTURE.md` §Data locations. Services:

```bash
systemctl status sparky-medusa-server sparky-medusa-worker sparky-storefront nginx postgresql redis-server
journalctl -u sparky-medusa-server -f
systemctl list-timers 'sparky-*'
```

## 6. Memory budget (12 GB A1)

| Process | Limit |
|---|---|
| Medusa server | Node heap 2048 MB (`SERVER_HEAP_MB`) |
| Medusa worker | 1536 MB (`WORKER_HEAP_MB`) |
| Next.js | 1024 MB (`STOREFRONT_HEAP_MB`) |
| PostgreSQL | shared_buffers 1 GB |
| Redis | maxmemory set by the installer, `noeviction` |

That leaves more than 5 GB for the page cache, builds and nginx. Builds run while the old release is still serving.

## Tested vs. not tested

- **Tested:**
  - A fresh Ubuntu 24.04 **x86_64** systemd container with an S3-compatible endpoint (moto): full install, re-run idempotency, upgrade, rollback, backup, restore into a temp DB, production restore with DB swap, worker crash recovery and reboot recovery.
  - The final verification passes except for items needing real credentials and approvals.
- **Not tested:** real OCI ARM64 hardware, real OCI Object Storage, Let's Encrypt issuance, real Razorpay and SMTP. Every package used publishes arm64 builds (docs/research/external/oci.md), but the first real install on the A1 is the ARM64 test. Run `final-verification.sh` there.
