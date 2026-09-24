# ADR-008: Compare-at prices as base price + "sale" price list

- **Status:** accepted (2026-09-24)

## Question
All 9 Shopify products show a struck-through `compare_at_price` (for example ~~Rs. 1,400.00~~ Rs. 999.00). How do we reproduce that in Medusa?

## Current evidence
- Medusa's calculated price returns `original_amount` (base price) and `calculated_amount` (after price lists).
- A price list of type `sale` sets `calculated_price_type: "sale"`.
- There is no native compare-at field.

## Sources
- Medusa pricing concepts (price lists, calculated price); `docs/audit/LIVE-SITE-AUDIT.md` §4.2

## Options
1. Store compare-at in variant metadata and render it.
2. Base price = compare-at, plus a sale price list at the Shopify price.

## Chosen
Option 2, using the price list "Sale prices (Shopify compare-at)".

## Reason
- The price that is charged comes from Medusa's pricing engine, not from display metadata, so the displayed and charged prices can't diverge.
- Merchants manage sales in Admin → Pricing, and ending the sale is a price-list edit.

## Tradeoffs
- A variant's "price" field in Admin shows the original (higher) price, which can confuse merchants. Documented in OPERATIONS.md.

## Impact
Importer, storefront `Price` component (`calculated_amount` vs `original_amount`, "Sale" badge).

## Verification
- `final-verification.sh` compares calculated and original prices against the live Shopify JSON for every product. This passed on staging.
- The catalog-cycle test sets a sale in Admin and sees the struck-through price and badge on the storefront.
