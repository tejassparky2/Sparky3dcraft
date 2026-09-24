# Payments

Two providers are registered on the India region:

| Provider id (region) | What it is | Status |
|---|---|---|
| `pp_razorpay_razorpay` | Razorpay Standard Checkout: UPI, cards, netbanking, wallets | Built in this repo (ADR-003). Tested against a local Razorpay API double. **Not yet tested with real Razorpay test or live keys** |
| `pp_cod_cod` | Cash on Delivery (optional, `COD_ENABLED=true`) | Tested end to end locally and on the staging container |

Medusa's no-money `pp_system_default` provider is **removed from the region** in production
(`SPARKY_DISABLE_SYSTEM_PAYMENT=true`). `final-verification.sh` fails if it is offered.

Note: the current Shopify store publicly offers card/Google Pay through Shopify Payments and
**no COD** (audit §11). Whether to add COD is a merchant decision, so it is off by default.

## Razorpay: how an order becomes paid

1. At checkout the storefront creates a payment session. The provider creates a Razorpay **order**
   for the cart total in **paise**, computed with exact decimal-string arithmetic (no float
   rounding). It sets `receipt` and `notes.session_id` to the Medusa payment-session id.
2. The browser opens Razorpay `checkout.js` with that `order_id`. When it finishes, the storefront
   asks Medusa to complete the cart.
3. On completion Medusa calls `authorizePayment`. The provider **fetches the order's payments from
   the Razorpay API** and accepts only a `captured` or `authorized` payment whose amount and
   currency match exactly and whose order `notes.session_id` matches the session. **A client-side
   redirect or handler callback alone never marks anything paid.**
4. Independently, Razorpay sends webhooks to **`https://api.<domain>/hooks/razorpay`**:
   - The route verifies `X-Razorpay-Signature`, an HMAC-SHA256 over the **raw body** with the
     webhook secret, using a timing-safe comparison. It rejects a bad signature with 400.
   - It records `x-razorpay-event-id` in the `sparky_webhook_event` ledger (unique). Duplicates
     get `200 {duplicate:true}` and are not processed again.
   - It hands the event to Medusa's payment webhook processing on the worker. On
     `payment.authorized`, `payment.captured` or `order.paid`, Medusa completes the cart **if the
     browser never did**, for example when the tab was closed right after paying.
5. There is **one order per cart**. Cart completion is idempotent and runs under a Redis lock:
   - 5 concurrent completion calls produced exactly one order.
   - A webhook arriving after the browser completion is a no-op.
   - The checkout button is guarded against double clicks.

Capture: if Razorpay auto-capture is enabled (Dashboard → Account & Settings → Payment
capture, the recommended setting), payments arrive already `captured`. If manual capture is
used, capture from Medusa Admin → Order → Payment → Capture. `capturePayment` is idempotent:
capturing twice returns the existing capture.

Refunds: create them in Medusa Admin (Order → Refund). The provider sends Razorpay the refund
with `receipt = <Medusa refund id>`, so a retried refund is recognised as a duplicate and never
refunds twice. Razorpay refuses refunds on payments older than 6 months.

Cancel: Razorpay has no "void". Cancelling an uncaptured payment records the intent, and Razorpay
auto-refunds uncaptured authorizations after its capture window.

## Razorpay setup (per environment)

1. Razorpay Dashboard → Account & Settings → **API Keys**: generate a key. Staging uses **Test
   Mode** keys (`rzp_test_…`). Production uses **Live Mode** keys (`rzp_live_…`), which require
   Razorpay's website verification (the storefront must show policies, contact details and prices).
2. Dashboard → **Webhooks** → Add:
   - URL: `https://api.<domain>/hooks/razorpay`
   - Secret: a new random string (`openssl rand -hex 24`), **different from the key secret**
   - Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`
   - Webhooks must reach port 443. Razorpay disables a webhook after 24 h of failures.
3. Enter the key id, key secret and webhook secret when `install.sh` asks, or in the answers file.
   They are stored only in `/etc/sparky/secrets.env` and `/etc/sparky/backend.env`.
4. `sudo ./deploy/final-verification.sh`. The webhook check must show **400 for a forged request**.

## Required live test before go-live (MANUAL gate)

This cannot be automated without real money. On production with live keys:

1. Order the cheapest product with Razorpay (UPI or card). Confirm that:
   - the order appears in Admin with payment *captured* (or *authorized* under manual capture)
   - the confirmation email arrives
   - the Razorpay Dashboard shows the payment with `notes.session_id`
   - the webhook delivery shows **200**
2. Refund it in Medusa Admin. Confirm the refund in the Razorpay Dashboard.
3. `sudo ./deploy/final-verification.sh --mode production --payment-verified …`

## Testing locally

`tests/fakes/razorpay-fake.mjs` is a local Razorpay API and checkout.js double (port 9911).
Point the backend at it with `RAZORPAY_API_BASE=http://127.0.0.1:9911` (development only; production
refuses this variable). The E2E suite (`apps/storefront/e2e/checkout.spec.ts`) covers:

- success, cancel, failure then retry
- webhook-only completion (browser closed)
- duplicate and forged webhooks
- 5 concurrent completions → 1 order
- COD

Unit tests: `apps/backend/src/modules/razorpay/__tests__`.

## Cash on Delivery

- The customer chooses COD. The session authorizes with `collected: false`, and the order is
  created with payment status **authorized**, not captured or paid.
- When the courier remits the cash, the merchant clicks **Capture** in Admin. Only then is the
  payment captured.
- Optional `COD_MAX_ORDER_AMOUNT` (INR) rejects COD above that total.
- Cancelling an order before capture leaves nothing to refund.
