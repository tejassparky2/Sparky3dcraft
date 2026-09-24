# Risk register

Updated 2026-09-24. Likelihood (L) and impact (I) are rated H/M/L.

| ID | Risk | L | I | Mitigation / status |
|---|---|---|---|---|
| R-01 | **Razorpay provider untested against real Razorpay.** The fake API double may differ from production behaviour, for example in payment status timing or error shapes | M | H | Written from the documented API. Unit tests plus 37 E2E tests against the double. **Mandatory live ₹-small order + refund before go-live** (PAYMENT.md). Webhooks complete carts even if the browser flow breaks |
| R-02 | **ARM64 not exercised on real Ampere hardware.** All tests ran on x86_64 | L | M | Every package has arm64 builds (Node, sharp prebuilds, apt). The installer detects the architecture. The first A1 install must run `final-verification.sh` |
| R-03 | **Legal pages missing.** Terms, shipping and refunds don't exist on Shopify, and privacy mentions Shopify | H | H | Placeholders only, never invented. The production verification gate FAILs until the merchant approves. Razorpay live activation also needs them |
| R-04 | **Shipping rate and GST unknown.** Shopify's checkout rates are not public | H | M | The installer requires a merchant-approved flat rate. No tax rate is set. Prices are tax-inclusive, so customer totals are right. GST reporting needs an accountant (SHIPPING.md) |
| R-05 | OCI rejects CRC32 on bulk `DeleteObjects`, so deleting media in Admin may leave orphaned objects | M | L | Checksums set to `WHEN_REQUIRED`. Orphans only cost storage. Clean up periodically in the OCI console |
| R-06 | OCI Always Free Object Storage allows **50k API requests/month**. Direct image hotlinking or cache misses could exceed it | M | M | Next.js image optimization caches each size for 7 days, so the bucket sees only misses. Watch OCI usage. Paid usage is cheap, or a CDN can be put in front |
| R-07 | OCI reclaims idle Always Free instances (below 20% over 7 days) | L | H | Real traffic plus Medusa's baseline RAM use normally keeps it above the threshold. Off-machine encrypted backups and a documented DR procedure. Converting to Pay-As-You-Go (still $0 within the free allowances) is reported to exempt instances from reclamation (UNVERIFIED, see external/oci.md) |
| R-08 | Single VM, a single point of failure | M | H | systemd auto-restart (verified), reboot recovery (verified), daily plus pre-change backups, restore tested, DR runbook. Keep Shopify as the fallback during the cutover window |
| R-09 | No Content-Security-Policy header | M | M | Other headers are set. A CSP must allow Razorpay's checkout domains. Add it in report-only mode after live Razorpay testing |
| R-10 | Customer migration: customers must set a password (Shopify passwords can't be exported). The activation link expires in 15 min | H | L | Activation emails, plus "Forgot password" works for every migrated email (MIGRATION.md). Guest checkout always works |
| R-11 | Admin API import untested against real Shopify (no token was available) | M | M | Tested against a schema-faithful fixture double. `migrate.sh --probe` validates token, scopes and schema before any apply. The public source was tested live |
| R-12 | Medusa 2.21 is recent. Open upstream issues: Redis "jobs stop executing" #14889 and "events not consumed" #14357 were closed stale without a fix | L | H | Health check every 5 min, worker `/health`, auto-restart. Webhooks retry for 24 h. Watch the release notes (medusa-research skill) |
| R-13 | `vite` dev-server advisory in the backend dependency tree | L | L | Not reachable in production (no dev server). Re-check on upgrade (SECURITY.md) |
| R-14 | SMTP deliverability. Without SPF/DKIM, order and reset emails land in spam | M | M | Use a transactional provider and set SPF/DKIM/DMARC for the domain before cutover |
| R-15 | Historical orders from Shopify appear without payment records | L | L | By design: they were not processed by Medusa. They are flagged `metadata.historical=true`. Display in the account page is not yet tested |
| R-16 | Visual fidelity is compared only manually against the audit screenshots | M | L | E2E tests cover structure and function. The merchant reviews staging before cutover |
