# Release checklist (production cutover)

Tick every box and record the evidence (command output, screenshot or link). "Owner" is who can do it.

## A. Merchant inputs (blockers)

| # | Item | Owner | Evidence |
|---|---|---|---|
| A1 | Privacy policy revised for the new platform, `status: approved` | merchant | commit hash |
| A2 | Terms of service written, `status: approved` | merchant/counsel | commit hash |
| A3 | Shipping policy written, `status: approved` | merchant | commit hash |
| A4 | Refund/return policy written, `status: approved` | merchant | commit hash |
| A5 | Standard shipping price (and free-shipping threshold, if any) approved | merchant | installer answer |
| A6 | GST treatment confirmed (rates entered in Admin, or "prices incl. tax, no breakdown" confirmed) | merchant/accountant | note |
| A7 | COD offered? Yes/No, with max amount | merchant | installer answer |
| A8 | Visual review of staging vs the live store signed off | merchant | date |

## B. Credentials and accounts

| # | Item | Evidence |
|---|---|---|
| B1 | Razorpay **live** keys and webhook (secret, 4 events) at `https://api.<domain>/hooks/razorpay` | Dashboard screenshot |
| B2 | Razorpay website verification passed | Dashboard |
| B3 | SMTP provider with SPF, DKIM and DMARC for the domain. A test email from staging lands in the inbox, not spam | mail-tester score |
| B4 | OCI buckets (media public-read objects, private, backups) and Customer Secret Key | `s3-check` PASS in install log |
| B5 | `BACKUP_ENCRYPTION_KEY` stored offline | password manager entry |
| B6 | Shopify Admin API token (read-only), if customers/orders are migrated | `migrate.sh --probe` PASS |
| B7 | Admin user password is strong and unique. Extra staff invited | — |

## C. Staging verification

| # | Check | Command |
|---|---|---|
| C1 | Health: 0 FAIL | `sudo ./deploy/healthcheck.sh` |
| C2 | Acceptance: 0 FAIL, only A/B MANUAL items open | `sudo ./deploy/final-verification.sh --admin-email … --test-order` |
| C3 | Reboot test | `--prepare-reboot-test`, reboot, re-run |
| C4 | Razorpay **test-mode** order paid with a test card/UPI, webhook 200, refund works | PAYMENT.md |
| C5 | Password reset email received and works | `/forgot-password` |
| C6 | Upgrade + rollback rehearsal on staging | `upgrade.sh --ref`, `rollback.sh --previous` |
| C7 | Restore rehearsal | `restore.sh --verify-latest`, and `--fetch-remote` of one remote backup |
| C8 | ARM64: C1–C3 performed on the real A1 VM | `uname -m` = aarch64 in the report |

## D. Cutover (docs/MIGRATION.md §Cutover)

- [ ] D1 Record the current DNS records (`dig +noall +answer sparky3dcraft.tech www.sparky3dcraft.tech`) for rollback
- [ ] D2 Lower the TTL to 300 s at least 24 h before
- [ ] D3 Freeze Shopify catalog edits
- [ ] D4 `sudo ./deploy/migrate.sh --apply` (final delta)
- [ ] D5 `sudo ./deploy/install.sh --mode production --from-stage medusa` with live keys
- [ ] D6 Switch DNS. Wait for propagation. `sudo ./deploy/install.sh --only tls`
- [ ] D7 `sudo ./deploy/final-verification.sh --mode production --admin-email … --test-order` → 0 FAIL
- [ ] D8 Live Razorpay order (smallest product) and refund, then re-run with `--payment-verified` → **PRODUCTION READY = YES**
- [ ] D9 `sudo SPARKY_CUTOVER_COMPLETED=true ./deploy/install.sh --from-stage medusa`
- [ ] D10 Customer activation emails (dry-run, then send)
- [ ] D11 Search Console: submit the sitemap
- [ ] D12 External uptime monitor on the storefront and `/health`

## E. After cutover

- [ ] E1 Watch orders, webhooks (Razorpay Dashboard) and `journalctl` for 48 h
- [ ] E2 Keep Shopify intact (password-protected) for ≥ 30 days as the rollback path (ROLLBACK.md §3)
- [ ] E3 Review Search Console coverage after 2 and 4 weeks
