# ADR-012: Cash on Delivery authorizes, merchant captures on collection

- **Status:** accepted (2026-09-24)

## Question
How is COD represented without pretending money was received?

## Current evidence
- The live store does not offer COD (audit §11). COD is common in India, so it is optional here and off by default.
- Medusa orders require an authorized payment session to complete a cart.

## Options
1. Medusa's system provider: it marks sessions authorized and nothing distinguishes COD.
2. A dedicated COD provider that authorizes with `collected: false` and captures when the merchant confirms the cash.

## Chosen
Option 2 (`apps/backend/src/modules/cod`):
- optional `COD_MAX_ORDER_AMOUNT`
- `pp_system_default` removed from the region in production

## Reason
The order shows "authorized" until the cash is collected, which is truthful. The payment method appears clearly in Admin and emails.

## Tradeoffs
The merchant must remember to capture COD orders. This is documented in OPERATIONS.md.

## Impact
Region providers, checkout UI, `final-verification.sh` (a COD test order is placed and then cancelled).

## Verification
- The E2E COD spec passes.
- `deploy/tests/cod-order-cycle.mjs` on staging: the order is visible in Admin as *authorized*, then cancelled.
