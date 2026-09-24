---
name: e2e-commerce-qa
description: Run and extend end-to-end commerce tests (browse, cart, personalization, Razorpay/COD checkout, webhooks, accounts, Admin catalog cycle) against the local stack or a staging server. Use after any change touching checkout, cart, pricing, auth or catalog display.
---

# E2E commerce QA

## Local stack (all on 127.0.0.1)
| Service | Command |
|---|---|
| Postgres 16 / Redis 7 | system services |
| Medusa | `cd apps/backend && npm run build && cd .medusa/server && npm ci --omit=dev && NODE_ENV=production … npx medusa start` (or `npm run dev` for quick loops) |
| Storefront | `cd apps/storefront && npm run build && npm start` (use a production build for release checks) |
| Razorpay double | `node tests/fakes/razorpay-fake.mjs` (port 9911; backend `RAZORPAY_API_BASE=http://127.0.0.1:9911`, storefront loads checkout.js from it) |
| SMTP capture | `python3 tests/fakes/smtp-capture.py` (port 2525, writes `.eml` files; `E2E_MAIL_DIR`) |
| Shopify Admin double | `node tests/fakes/shopify-admin-fake.mjs` (port 9922) for importer tests |

Env for Playwright:
- `E2E_BASE_URL` (default http://127.0.0.1:3000)
- `E2E_MEDUSA_URL`
- `E2E_RZP_FAKE_URL`
- `E2E_MAIL_DIR`
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `PW_CHROMIUM_PATH`

## Procedure
1. Start the stack. Seed it with `setup:store` (test config `integration-tests/fixtures/store.config.test.json`) and a public import.
2. Run the suite: `cd apps/storefront && npx playwright test` (desktop and mobile projects).
3. Server-side cycles:
   ```bash
   ADMIN_EMAIL=… ADMIN_PASSWORD=… STORE_URL=… API_URL=… PK=… node deploy/tests/catalog-cycle.mjs
   node deploy/tests/cod-order-cycle.mjs
   ```
4. On staging: `sudo ./deploy/final-verification.sh --admin-email … --test-order`.

## Must-cover scenarios (keep them green)
- **Browse:** browse, search, collection sort, 404 status.
- **Cart:** add, update, remove, personalization photo and colour (with a required-field rejection). Promo codes have no test yet: add one when promotions are used.
- **Razorpay:** success, cancel, failure → retry, webhook-only completion, duplicate webhook, forged signature → 400, 5 concurrent completes → 1 order.
- **COD:** COD order is *authorized*, not captured.
- **Accounts:** register, login, order history, addresses, password reset via captured email.
- **Forms:** contact and newsletter (honeypot).
- **Admin catalog cycle:** create, edit, price, sale, stock 0 (Sold out), unpublish (404), delete.

## Expected evidence
- `npx playwright test` summary (currently 37 passed).
- The HTML report at `playwright-report/`.
- For a failure: the trace (`test-results/**/trace.zip`).

## Failure handling
- **Reproduce with `--headed --debug` or the trace.** Fix the product code, not the test, unless the test asserted something wrong.
- **Never mark flaky tests skipped.** Find the race: most past failures were real (CORS origin, soft-404, double submit).
- **Never point tests at live Razorpay keys.** Live verification is the manual step in docs/PAYMENT.md.
