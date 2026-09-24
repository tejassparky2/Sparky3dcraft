# Operations runbook

All commands run on the server from the repository checkout, for example `~/Sparky3dcraft`.

## Daily / automatic

| What | When | Check |
|---|---|---|
| Backup (DB + config + local uploads, encrypted off-machine copy) | 02:30 IST, `sparky-backup.timer` | `ls -lt /var/backups/sparky \| head`, `journalctl -u sparky-backup` |
| Health check | every 5 min, `sparky-healthcheck.timer` (logs to journald, exit ≠ 0 on failure) | `journalctl -u sparky-healthcheck --since today` |
| Upload cleanup (unattached personalization photos) | daily Medusa job | worker log `cleanup-uploads` |
| TLS renewal | certbot's own timer | `sudo certbot renew --dry-run` |

Nothing emails you when the health check fails. Recommended: an external uptime monitor
(for example UptimeRobot, free) on `https://sparky3dcraft.tech/` and `https://api.sparky3dcraft.tech/health`.

## Common tasks

```bash
sudo ./deploy/healthcheck.sh                 # full status, [PASS]/[WARN]/[FAIL]
sudo ./deploy/diagnose.sh                    # everything needed for a bug report (secrets redacted)
systemctl status sparky-medusa-server sparky-medusa-worker sparky-storefront
journalctl -u sparky-medusa-server -n 200 --no-pager
sudo systemctl restart sparky-medusa-server sparky-medusa-worker   # safe: carts/orders are in Postgres
sudo ./deploy/backup.sh --tag manual
sudo ./deploy/restore.sh --verify-latest
```

### Catalog

Products, prices, sale prices, stock and categories are managed in **Medusa Admin**
(`https://api.<domain>/app`). Changes appear on the storefront within seconds (revalidation
webhook), and in any case within `CATALOG_REVALIDATE_SECONDS` (30 s).

- **Sale price:** the product's variant price is the *original* price. Put the sale price in the price list
  "Sale prices (Shopify compare-at)" (Admin → Pricing). The storefront shows the struck-through price and a Sale badge.
- **Personalized product:** set product metadata keys `personalization_*` (see
  `apps/backend/data/personalization.json`), or copy them from an existing personalized product.
- **Collections:** these are **Product Categories** in Admin. The order within a collection comes from the category's
  `metadata.product_order` (comma-separated handles). Products not listed there come after them.

### Orders

- **Razorpay orders:** arrive paid (auto-capture) or authorized. Fulfil in Admin → Orders → Fulfillment.
- **COD orders:** payment *authorized*. After the courier remits the cash: Order → Payment → **Capture**.
- **Personalization photos:** the order page has a "Personalization" panel with download links (Admin login required).
- **Refunds:** Order → Refund (Razorpay refunds are idempotent). COD: refund the cash outside the system and record it.

### Customers

- Password reset works from `/forgot-password` when SMTP is configured.
- Migrated customers: see docs/MIGRATION.md §Customer accounts.

### Contact messages and newsletter

- Admin → **Messages** (custom page) lists contact-form messages. They are also emailed to `MERCHANT_NOTIFICATION_EMAIL`.
- Newsletter sign-ups are stored in `sparky_newsletter_subscriber`, and the Admin **Overview** page shows the count.
  Nothing is sent to a newsletter service. Export with:
  `sudo -u postgres psql medusa_db -c "\copy (select email, created_at from sparky_newsletter_subscriber where deleted_at is null) to stdout csv header"`

## Changing configuration

| Change | How |
|---|---|
| Razorpay keys, SMTP, COD, S3 | Re-run `sudo ./deploy/install.sh --from-stage medusa` with new values: `sudo RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… ./deploy/install.sh --from-stage medusa`. Explicit env values override stored answers. Or edit `/etc/sparky/secrets.env` / `install.conf`, then re-run |
| Shipping price / free threshold | Medusa Admin → Settings → Locations & Shipping (the installer does not overwrite existing options) |
| Tax rates | Medusa Admin → Settings → Tax Regions (docs/SHIPPING.md) |
| Domains | Re-run the installer with new `STORE_DOMAIN`/`API_DOMAIN` from stage `medusa` (URLs are compiled into the Admin and storefront builds), then `--only tls` |
| Policies | Edit `apps/storefront/content/policies/*.md`, set `status: approved`, commit, `upgrade.sh --ref <commit>` |

## Upgrades

```bash
cd ~/Sparky3dcraft && git fetch && git log --oneline HEAD..origin/<branch>
sudo ./deploy/upgrade.sh --ref <tag|commit>
```

- `--ref` is **required**. There is never an implicit "latest".
- A Medusa version change additionally requires `--confirm-medusa-upgrade`, after you read every release note in between (`.claude/skills/medusa-research`).
- The upgrade takes a backup, builds and tests the new release while the old one serves, migrates, switches, and rolls back automatically on failure. See docs/ROLLBACK.md.

Never run `npm update`, `npx medusa upgrade` or `npm audit fix --force` on the server.

## Capacity notes (A1, 2 OCPU / 12 GB)

- An upgrade build takes about 7 minutes (measured on the x86 test container). The site keeps serving throughout. Medusa is stopped only for the migration and restart, typically under a minute, and the storefront keeps rendering cached pages meanwhile.
- OCI Always Free Object Storage includes **50,000 API requests/month**. The storefront serves product images through Next.js image optimization, which caches each size locally (`minimumCacheTTL` 7 days), so bucket GETs are only cache misses. If traffic grows, watch the OCI usage page (RISKS.md R-06).
- OCI reclaims *idle* Always Free instances (below 20 % CPU/network/memory over 7 days). A shop with real traffic plus Medusa's memory use stays above that, but check the OCI console notices.
