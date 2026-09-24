# Shipping and tax

## What the live store does (audit, 2026-09-24)

- Ships to **India only**.
- There is no shipping policy and no public shipping rate. The cart says "shipping calculated at checkout". Several product descriptions promise delivery in 8–10 days, and one mentions local pickup in Bengaluru.
- Prices are **tax-inclusive** ("Taxes included."). No GST number or breakdown is shown.

Shopify's checkout-time rates could not be observed without placing an order, so **no rate was
copied and none is invented**. The merchant must supply them.

## How it is configured here

`setup-store` (run by the installer from `/etc/sparky/store.config.json`) creates:

| Object | Value |
|---|---|
| Store currency | INR, **prices include tax** |
| Region | "India" (IN), providers: Razorpay (+ COD if enabled) |
| Stock location | "Sparky Warehouse", city/PIN from the installer answers |
| Fulfillment set / service zone | India |
| Shipping option | "Standard Shipping", flat price = `SHIPPING_STANDARD_AMOUNT` (INR) |
| Free shipping | optional: price 0 when the item total ≥ `SHIPPING_FREE_THRESHOLD` (Medusa price rule `item_total gte`) |
| Tax region | `in` with **no default rate** |

The installer **refuses to continue** without a merchant-approved `SHIPPING_STANDARD_AMOUNT`
(0 is allowed and means free). Shipping options are created once. **Later changes are made in
Medusa Admin** (Settings → Locations & Shipping), and re-running the installer does not overwrite them.

## GST / tax: merchant decision required

Prices already include tax, and customers pay exactly the displayed price. What remains open is
reporting:

- Which GST rate applies to each product category (HSN codes for 3D-printed idols, lithophane lamps and similar items).
- Whether invoices must show a GST breakdown and GSTIN.

**No tax percentage has been entered.** Once the merchant or their accountant confirms the rates,
add them in Admin → Settings → Tax Regions → India (default rate and/or per-product-type overrides).
Because prices are tax-inclusive, adding a rate changes the tax *breakdown* on orders, not the price
the customer pays.

## Pickup / other methods

Local pickup (mentioned on one product) is not configured. Add a second shipping option in Admin
(for example "Pickup — Bengaluru", price 0) if the merchant wants it.

## Delivery-time wording

The 8–10 day wording stays in the product descriptions as migrated. The `/shipping` page is a
placeholder that needs the merchant's text (see docs/SECURITY.md §Legal pages).
