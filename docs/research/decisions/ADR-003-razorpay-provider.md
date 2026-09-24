# ADR-003: Custom Razorpay payment provider

- **Status:** accepted (2026-09-24)

## Question
How do we accept Razorpay (UPI, cards, netbanking) in Medusa v2 safely?

## Current evidence
- Every Medusa v2 Razorpay package on npm descends from one community code base.
- `medusa-plugin-razorpay-v2@0.1.4` (most used, pinned to Medusa 2.12.3) returns `notes.session_id` for webhooks but never sets it, so **every webhook is ignored**. It also has unawaited captures and truncates paise.
- `@devx-commerce/razorpay@6.0.0-beta.0` captures in rupees instead of paise and has no public repository.
- Razorpay APIs:
  - orders in paise, `receipt` ≤ 40 chars
  - webhook HMAC-SHA256 over the raw body with the webhook secret
  - at-least-once delivery with the `x-razorpay-event-id` header
  - refund `receipt` makes refunds idempotent

## Sources
- `docs/research/external/razorpay.md`, which reviews both packages and links the Razorpay docs:
  - https://razorpay.com/docs/api/orders/create/
  - https://razorpay.com/docs/webhooks/validate-test/
  - https://razorpay.com/docs/api/refunds/create-normal/
- https://docs.medusajs.com/resources/references/payment/provider

## Options
1. Use `medusa-plugin-razorpay-v2`.
2. Fork it and fix it.
3. Write a provider in-repo (about 400 LOC) against the documented Medusa provider interface and Razorpay REST API.

## Chosen
Option 3. The provider (`apps/backend/src/modules/razorpay`) works as follows:
- The HTTP client uses `fetch` (no SDK dependency).
- Amounts use decimal-string paise conversion.
- `authorizePayment` verifies server-side by fetching the order's payments and requires the exact amount and currency.
- Capture is idempotent.
- Refund `receipt` = the Medusa refund id.
- Webhook handling lives in `/hooks/razorpay`: signature check, an event-id dedupe ledger, then Medusa's payment webhook processing.

## Reason
Both candidates had defects that break core payment guarantees, and neither is maintained against 2.21. A small provider we test ourselves is lower risk than an unmaintained dependency.

## Tradeoffs
We own the maintenance. Razorpay API changes need to be tracked (`.claude/skills/medusa-research`).

## Impact
- Region payment providers.
- Storefront checkout (`CheckoutClient` loads checkout.js).
- Razorpay Dashboard webhook URL `https://api.<domain>/hooks/razorpay`.

## Verification
- Unit tests (utils and service) pass.
- Against a local Razorpay API double, the E2E suite passes: success, cancel, failure → retry, webhook-only completion, duplicate and forged webhooks, 5 concurrent completions → 1 order.
- **Not yet verified with real Razorpay test or live keys.** This is the MANUAL gate in docs/PAYMENT.md.
