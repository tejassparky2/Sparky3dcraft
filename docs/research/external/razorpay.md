# Razorpay payment provider for Medusa v2 (2.21.1)

Researched: 2026-09-24. Target: `@medusajs/medusa@2.21.1`, `razorpay` Node SDK `2.9.8` (npm latest, published 2026-07-15).

## Question

Which Medusa v2-compatible Razorpay payment providers exist? How good are they? Which Razorpay APIs does a custom provider need? Should we use an existing package or build our own provider in the repo?

## Findings

### 1. Candidates on npm (queried 2026-09-24)

Sources: `npm search`, `npm view`, and `https://api.npmjs.org/downloads/point/last-month/<pkg>` (window 2026-08-23 to 2026-09-21).

| Package | Latest | Published | Targets | Declared `@medusajs/*` peers | Downloads (month / week) | Repo, last commit | License |
|---|---|---|---|---|---|---|---|
| `medusa-plugin-razorpay-v2` (SGFGOV) | 0.1.4 | 2025-12-31 | **v2** `AbstractPaymentProvider` | pinned `2.12.3` (framework, medusa, cli, admin-sdk, test-utils), `@medusajs/ui 4.0.3`, `@mikro-orm/* 6.4.3` | 1182 / 366 | github.com/SGFGOV/medusa-payment-plugins (monorepo), last commit 2026-01-16 ("Update README.md") | MIT |
| `@devx-commerce/razorpay` | 6.0.0-beta.0 (latest tag is a **beta**) | 2026-05-19 (metadata modified 2026-09-11) | v2 | pinned `2.14.2` | 685 / 110 | **No repository field**. Source was read from the npm tarball | MIT |
| `medusa-payment-razorpay` (SGFGOV) | 7.3.2 | 2024-11-20 | **v1** (`@medusajs/medusa ^1.12.0`, `medusa-interfaces`) | v1 only | 305 / 64 | github.com/SGFGOV/medusa-payment-razorpay | MIT |
| `@alchemilla/medusa-razorpay` | 0.1.0 | 2026-05-27 | v2 (fork of the SGF code) | `^2.0.0` | 270 / 37 | none listed | MIT |
| `@tsc_tech/medusa-plugin-razorpay-payment` | 0.0.11 | 2025-06-02 | v2 | pinned `2.7.1` | 231 / 21 | the-special-character/-tsc-medusa-plugin-razorpay-payment | MIT |
| `@sgftech/payment-razorpay` | 2.1.11 | 2024-11-05 | v2 (early SGF code) | framework `^2.0.0`, the others `latest` | 198 / 66 | github.com/sgftech/payment-razorpay, last commit 2024-11-05 ("fix: razorpay refunds") | MIT |
| `@arkonesoft/medusa-plugin-razorpay-payment` | 0.0.13 | 2025-10-07 | v2 | pinned `2.7.1` | 28 / 5 | ArkOne-Softwares/medusa-plugin-razorpay-payment | MIT |
| `@minotaurg/medusa-payment-razorpay` | 1.0.0 | 2026-07-03 | v2 | framework/types `^2.0.0` | 15 / 0 | MinotaurG/medusa-payment-razorpay | MIT |
| `medusa-razorpay-webhook` | 1.0.6 | 2024-10-21 | v1 | `@medusajs/medusa ^1.20.9` | 22 / 1 | Rohit3523/medusa-razorpay-webhook | MIT |

Medusa ships no official Razorpay provider. Its docs mention Razorpay only as an example prompt for the MCP "integrate providers" tool (`www/apps/book/app/learn/introduction/build-with-llms-ai/mcp-server/integrate-providers/page.mdx`).

None of the v2 packages declares peers matching 2.21.x. The most-used ones pin exact old versions (2.12.3 and 2.14.2).

Almost every v2 package descends from the same SGF code base: `razorpay-base.ts`, `get-smallest-unit.ts`, and `update-razorpay-customer-metadata`. The devx, alchemilla and sgftech tarballs all contain the same file layout.

### 2. Code review of the top 2 candidates

I cloned SGFGOV/medusa-payment-plugins with `git clone --depth 1` at commit f33a773 (2026-01-16) and read `packages/medusa-plugin-razorpay-v2/src/providers/payment-razorpay/src/core/razorpay-base.ts` (812 lines). I read `@devx-commerce/razorpay@6.0.0-beta.0` from its npm tarball (`.medusa/server/src/providers/payment-razorpay/core/razorpay-base.js`, 657 lines, compiled JS).

**`medusa-plugin-razorpay-v2` 0.1.4: bugs found**

- **The webhook can never complete a cart.** `getWebhookActionAndData` returns `session_id: paymentData.notes.session_id`. `initiatePayment` never sets `notes.session_id`: it creates the order without notes and later writes `medusa_payment_session_id`. Medusa 2.21's payment-webhook subscriber returns early when `data.session_id` is missing (`packages/medusa/src/subscribers/payment-webhook.ts`), so every Razorpay webhook is silently ignored. A customer who pays and closes the tab gets no order.
- **Captures are fire-and-forget.** In `capturePayment`, `possibleCaptures.map(async ...)` is never awaited. `if (result)` is always true, so capture errors are unhandled and the code reports success before Razorpay confirms.
- **Amounts are truncated.** `getToPay()` calls `parseInt(amount.toString())` on Medusa's decimal amount, so ₹499.50 becomes 49900 paise and the 50 paise are lost. `refundPayment` uses `refundAmount * 100`, which assumes a 2-decimal currency and uses float math.
- **Order notes are overwritten.** `updateRazorpayOrderMetadata` builds a merged `notes` object, then sends only `metadata` to `orders.edit`, so it drops existing notes.
- There is a typo in the lookup: `data?.razorpayorder` (lowercase) is always falsy, which causes extra `orders.fetch` calls on every operation.
- `validateOptions` makes `razorpay_account` mandatory, although it is only meaningful for partner/sub-merchant setups. It sends an `X-Razorpay-Account` header on every call.
- `getPaymentStatus` maps order status `paid` to `AUTHORIZED` and never reports `CAPTURED`.
- `initiatePayment` sends no `receipt` and no `notes` at order creation. Nothing ties the Razorpay order back to the Medusa session except a later `orders.edit`.
- Webhook signature: it uses `Razorpay.validateWebhookSignature(rawData.toString(), sig, secret)`. That is correct in principle, but it also logs the full webhook body (PII) at `info` level.
- Peer dependencies are pinned to 2.12.3 and `@mikro-orm/* 6.4.3`, and the latest npm release is 9 months old.

**`@devx-commerce/razorpay` 6.0.0-beta.0: bugs found**

- **Capture amount is wrong.** It calls `payments.capture(id, getAmountFromSmallestUnit(amount), currency)`, which sends rupees where Razorpay requires paise. Razorpay rejects this with `400 "Capture amount must be equal to the amount authorized"`. Manual capture would always fail. Auto-capture setups would never reach this code.
- `initiatePayment` requires a phone number and creates or edits a Razorpay Customer on every session. It throws `"no phone number"` when none is available.
- `cancelPayment` and `updatePayment` always throw `NOT_ALLOWED`, which breaks Medusa flows that update sessions when the cart total changes.
- Webhook handling: it verifies the signature with the SDK helper and reads `session_id` from order or payment notes, which it sets at creation (good). It also emits custom `_payment.captured` and `_payment.failed` events.
- Payment-signature check `_validateSignature` uses `===` instead of `crypto.timingSafeEqual`.
- The source repo is not published, the latest npm tag is a beta, and the package contains Magic Checkout-specific code paths.
- Refunds do use `getSmallestUnit` and `speed`, but not `receipt`, so there is no idempotency.

**Other forks**

- `@alchemilla/medusa-razorpay` adds a `/razorpay/callback` route. It compares the HMAC with `!==` and redirects to `STOREFRONT_URL/order/confirmed`. Its webhook reads `payment.notes.medusa_payment_session_id`. Whether Razorpay copies order notes onto the payment entity is UNVERIFIED.

**Overall assessment:** none of the packages is production-grade for 2.21.1. Each has at least one money-path bug: an ignored webhook, a wrong capture amount, lost paise, or unawaited captures.

### 3. How Medusa 2.21 drives a payment provider (from source)

- Medusa calls the provider's `initiatePayment` with `data: { ...input.data, session_id: paymentSession.id }` and `context.idempotency_key = paymentSession.id` (`packages/modules/payment/src/services/payment-module.ts` ~L415).
- For captures it passes `idempotency_key: capture.id`. For refunds it passes `idempotency_key: refund.id`.
- Medusa's Stripe provider stores `session_id` in provider metadata and returns it from the webhook (`payment-stripe/src/core/stripe-base.ts`). A Razorpay provider should mirror this with `notes.session_id`.
- Webhook route: `POST /hooks/payment/{identifier}_{id}`. For identifier `razorpay` and config id `razorpay` that is `/hooks/payment/razorpay_razorpay`.
  - The route returns 200 immediately and emits `payment.webhook_received` with `{ data, rawData, headers }`.
  - The default delay is `webhook_delay` 5000 ms and the default retry count is `webhook_retries` 3 (Payment Module options). Source: `packages/medusa/src/api/hooks/payment/[provider]/route.ts`.
  - The subscriber runs on the **worker**. It rebuilds `rawData` as a Buffer, calls `getWebhookActionAndData`, and ignores events without `session_id` or with a `failed`, `canceled`, `pending` or `requires_more` action.
  - `authorized` and `captured` actions run `processPaymentWorkflow`, which **completes the cart if it is not already completed**. Doc: https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events
- Consequence: signature verification happens asynchronously in the worker. An invalid signature still gets HTTP 200, so Razorpay will not retry it. That is fine.

### 4. Razorpay APIs needed for a custom provider

| Need | Official facts | Source |
|---|---|---|
| Create order | `POST https://api.razorpay.com/v1/orders`, Basic auth `key_id:key_secret`. Body: `amount` (integer, smallest unit: **paise**, minimum 100 = ₹1), `currency` ("INR"), `receipt` (optional, **max 40 chars, must be unique**), `notes` (max 15 key-value pairs, 256 chars each), `partial_payment`. Order statuses: `created`, `attempted`, `paid`. | https://razorpay.com/docs/api/orders/create/ |
| Per-order capture mode | The Orders API `payment.capture` parameter ("automatic" / "manual", with `capture_options`) overrides the Dashboard setting. | https://razorpay.com/docs/payments/payments/capture-settings/ |
| Standard Checkout JS | `<script src="https://checkout.razorpay.com/v1/checkout.js">`. Options: `key`, `amount`, `currency`, `name`, `order_id` (required), plus `prefill`, `handler`, `callback_url`, `notes`, `theme`, `modal`. The handler receives `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`. Failures arrive via `rzp1.on('payment.failed', ...)`. | https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/ |
| Payment signature | `generated_signature = hmac_sha256(order_id + "|" + razorpay_payment_id, key_secret)`, compared with `razorpay_signature` on the **server**. | same page |
| Webhook signature | Header `X-Razorpay-Signature`. HMAC-SHA256 over the **raw request body** ("Do not parse or cast the webhook request body") with the **webhook secret** (not the key secret). Node helper: `Razorpay.validateWebhookSignature(body, signature, secret)`. Test-mode OTP for webhook setup is `754081`. | https://razorpay.com/docs/webhooks/validate-test/ |
| Webhook delivery | At-least-once delivery. Dedupe by the `x-razorpay-event-id` header. A response within **5 s** is required, and any non-2xx counts as a failure. Retries use exponential backoff for 24 h, after which the webhook is **disabled**. Only ports 80 and 443 are allowed, and Razorpay recommends whitelisting its webhook IPs. | https://razorpay.com/docs/webhooks/faqs/ , https://razorpay.com/docs/webhooks/ |
| Webhook events | `payment.authorized`, `payment.captured`, `payment.failed` (`payload.payment.entity`); `order.paid` (contains both order and payment entities); `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`. Payloads are a snapshot of the entity at event time. | https://razorpay.com/docs/webhooks/payments/ , https://razorpay.com/docs/webhooks/refunds/ |
| Capture | `POST /v1/payments/{id}/capture` with `{amount, currency}`. The amount **must equal the authorized amount**, in paise. Errors include "Payment is not in authorized state" and "order is already paid". | https://razorpay.com/docs/api/payments/capture/ |
| Auto-capture | Default: payments authorized within 3 days of creation are auto-captured. Uncaptured authorizations are auto-refunded after the timeout (min 12 min, max 3 days). "You must ensure that all payments in the authorized state are moved to the captured state within 3 days of creation." | capture-settings page |
| Refund | `POST /v1/payments/{payment_id}/refund` with optional `amount` (paise; omit for a full refund), `speed` (`normal` 5–7 working days or `optimum`), `notes`, and `receipt`. **A reused `receipt` gives "Duplicate receipt found"**, so `receipt` works as the idempotency key. No refunds for payments older than 6 months. Statuses: `pending`, `processed`, `failed`. | https://razorpay.com/docs/api/refunds/create-normal/ |
| Test mode | Test keys "only process simulated transactions — no real money moves". The key secret is shown only once. Live keys need website verification (about 3 working days). Key prefixes `rzp_test_` / `rzp_live_` are well known, but I did not find them in the fetched page (UNVERIFIED there). | https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/ |

The Node SDK is `razorpay@2.9.8` (MIT, maintained by Razorpay, published 2026-07-15). It exposes `orders.create/fetch/fetchPayments`, `payments.capture/refund/fetch` and `validateWebhookSignature`.

### 5. Recommended design for our own provider (about 300–400 LOC)

- Create `src/modules/razorpay/` with `ModuleProvider(Modules.PAYMENT, { services: [RazorpayProviderService] })`, `static identifier = "razorpay"`, config id `razorpay`. The webhook URL is then `/hooks/payment/razorpay_razorpay`.
- `initiatePayment`: call `orders.create`. Convert the amount to paise with **decimal-safe** math (`MathBN`/BigNumber × 100, round half-up). Set `receipt = data.session_id` (a `payses_` id is 33 chars, under the 40 limit), `notes = { session_id, cart_id? }` and `payment.capture = "automatic"`. Return `{ id: order.id, data: { razorpay_order_id, amount, currency } }`.
- `authorizePayment`: the storefront posts `{razorpay_payment_id, razorpay_order_id, razorpay_signature}` into the session data, for example via `updatePaymentSession` or the `authorizePaymentSession` context.
  - Verify the signature with `crypto.timingSafeEqual`.
  - Then call `payments.fetch` or `orders.fetchPayments` and return `captured` when the payment status is `captured`, or `authorized` when it is `authorized`.
- `capturePayment`: skip when the payment is already captured (auto-capture). Otherwise capture with the exact authorized paise amount.
- `refundPayment`: call `payments.refund(payment_id, { amount: paise, receipt: context.idempotency_key /* refund.id */, speed: "normal" })`.
- `getWebhookActionAndData`:
  - Validate `X-Razorpay-Signature` over `rawData` with the **webhook secret**.
  - Map `payment.captured` and `order.paid` to `captured`, `payment.authorized` to `authorized`, and `payment.failed` to `failed`.
  - Return `session_id` from `order.notes.session_id`, falling back to a fetch of the order by `payment.order_id`, and the amount in major units.
  - Medusa's `processPaymentWorkflow` is idempotent per session. Deduping additionally by `x-razorpay-event-id` in Redis is optional.
- `getPaymentStatus`, `retrievePayment`, `cancelPayment` (no-op, or rely on auto-refund of an uncaptured authorization) and `deletePayment` (no-op; Razorpay orders cannot be deleted): implement straightforwardly.
- Webhook events to enable in the Razorpay dashboard: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.

## Sources

- npm registry: `npm view <pkg>`; downloads API `https://api.npmjs.org/downloads/point/last-month/<pkg>` and `.../last-week/<pkg>`
- https://github.com/SGFGOV/medusa-payment-plugins (clone at f33a773, 2026-01-16)
- https://github.com/sgftech/payment-razorpay (clone at e176a8b, 2024-11-05)
- npm tarballs: `@devx-commerce/razorpay@6.0.0-beta.0`, `@alchemilla/medusa-razorpay@0.1.0`, `medusa-plugin-razorpay-v2@0.1.4`, `@sgftech/payment-razorpay@2.1.11`
- Medusa source (clone of medusajs/medusa master at 7b3fe04, 2026-09-24; `packages/medusa/package.json` = 2.21.1): `packages/modules/payment/src/services/payment-module.ts`, `packages/medusa/src/api/hooks/payment/[provider]/route.ts`, `packages/medusa/src/subscribers/payment-webhook.ts`, `packages/modules/providers/payment-stripe/src/core/stripe-base.ts`
- https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events
- https://docs.medusajs.com/resources/references/payment/provider (payment provider reference)
- Razorpay: https://razorpay.com/docs/api/orders/create/ , https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/ , https://razorpay.com/docs/webhooks/validate-test/ , https://razorpay.com/docs/webhooks/ , https://razorpay.com/docs/webhooks/faqs/ , https://razorpay.com/docs/webhooks/payments/ , https://razorpay.com/docs/webhooks/refunds/ , https://razorpay.com/docs/payments/payments/capture-settings/ , https://razorpay.com/docs/api/payments/capture/ , https://razorpay.com/docs/api/refunds/create-normal/ , https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/

## Confidence

- **High:** the package inventory, versions, peer dependencies and downloads (all from registry data).
- **High:** the bugs in the SGF and devx code (read directly from source).
- **High:** the Medusa webhook mechanics (read from 2.21.1 source).
- **Medium-high:** the Razorpay API facts. They were read through a summarizing fetcher, so exact wording may differ slightly.
- **UNVERIFIED:** whether Razorpay copies order `notes` onto the payment entity, and the key prefixes.

## Implications for us

1. **Build a custom provider in the repo** (recommended). Use the official `razorpay` SDK and the SGF plugin only as a reference.
   - It is small: 8 required methods and one webhook mapper.
   - It lets us fix the money-path bugs: paise math, `notes.session_id`, `receipt` idempotency, and awaited captures.
   - It avoids peer pins against 2.12 and 2.14.
2. Use **auto-capture** (per-order `payment.capture: "automatic"`) so that "authorized" and "captured" happen together. Make `capturePayment` a verified no-op when the payment is already captured.
3. Webhooks are essential. Only they complete carts when the browser flow is interrupted. Configure `https://<api-domain>/hooks/payment/razorpay_razorpay` on port 443, and keep the Medusa **worker** running with the Redis event bus, because webhook processing happens there.
4. Store the **webhook secret** separately from `key_secret`. Test with `rzp_test_` keys and a test-mode webhook.
5. Keep the 5 s response budget in mind. Medusa's route answers immediately, which is fine, and nginx must not buffer or time out that route.
