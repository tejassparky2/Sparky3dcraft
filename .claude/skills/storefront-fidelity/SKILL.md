---
name: storefront-fidelity
description: Keep the Next.js storefront visually and behaviourally faithful to the live Shopify Craft theme (layout, typography, colors, prices, URLs, SEO). Use when changing storefront UI, routes, metadata or copy.
---

# Storefront fidelity

Reference: `docs/audit/LIVE-SITE-AUDIT.md` (§2 header, §3 footer, §5 product page, §6 home, §7 collections/search, §9 SEO, §10 design system) and `docs/audit/screenshots/`.

## Procedure
1. Find the audit section for the page you're changing. Note the exact copy, order of elements, and the `Rs. 1,299.00 INR` price format.
2. Use the design tokens in `apps/storefront/src/app/globals.css`. **No ad-hoc colors or fonts.** Use Trirong for headings and Quattrocento Sans for body.
3. Don't invent content: no testimonials, FAQs, blog posts or policy text that isn't in the audit.
4. Keep URLs:
   - Every Shopify path keeps working or redirects (`next.config.ts`).
   - New pages need canonical metadata via `pageMetadata()`.
5. Check both desktop and mobile (Pixel 7) layouts.

## Validation
```bash
cd apps/storefront && npm run typecheck && npm run lint && npm run build
PW_CHROMIUM_PATH=<chromium> npx playwright test e2e/browse.spec.ts e2e/mobile.spec.ts
```
Then compare screenshots with `docs/audit/screenshots/` side by side, and take new ones with Playwright `page.screenshot`.

## Expected evidence
- Passing browse and mobile specs.
- Before/after screenshots for any visual change.
- Unchanged redirect list, or updated SEO.md.

## Failure handling
- If the audit lacks information for a page, ask the merchant rather than inventing content. Leave a visible placeholder flagged in the release checklist.
- If a change breaks a Shopify URL, add a 308 redirect in the same change.
