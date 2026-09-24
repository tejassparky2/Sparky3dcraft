# ADR-013: Storefront written for Next.js 16, replicating the Craft theme

- **Status:** accepted (2026-09-24)

## Question
Do we start from Medusa's Next.js starter or write the storefront?

## Current evidence
- The official starter is on Next 15.3.9 and would need porting to Next 16:
  - `proxy.ts`
  - async `params`/`cookies`
  - the new `revalidateTag` signature
  - image defaults
  - no `next lint`
- The store must visually match the live Shopify "Craft" theme (colors, typography Trirong/Quattrocento Sans, layout, 9-product catalog).

## Sources
- `docs/research/external/nextjs16.md`, `docs/audit/LIVE-SITE-AUDIT.md` §10

## Options
1. Port the starter and restyle it.
2. Write a smaller App Router storefront against `@medusajs/js-sdk` 2.21.1, styled from the audit's design tokens.

## Chosen
Option 2.

## Reason
- The starter's regions, multi-country routing and feature set are unnecessary (India only).
- Porting its Next 15 patterns is about as much work as writing only what the store needs.
- A small code base is easier to keep matching the Shopify design.

## Tradeoffs
We maintain our own checkout and account pages. This is mitigated by the E2E suite.

## Impact
`apps/storefront`.

## Verification
- 37 Playwright tests (desktop and Pixel 7) pass.
- Lint and typecheck are clean.
- `next build` runs in production mode, served by `next start` under systemd.
- Visual comparison with the audit screenshots was done manually during development. **There is no automated pixel-diff test.**
