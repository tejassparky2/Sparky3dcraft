# Raw snapshot: sparky3dcraft.tech (Shopify)

- **Crawl timestamp:** 2026-09-24, 14:59 to about 15:35 UTC (20:29 to 21:05 IST). Most JSON endpoints were fetched at about 15:00 UTC.
- **Method:** read-only HTTP GET from a Linux container (curl + headless Chromium via Playwright). No carts, checkouts, forms or account actions were submitted.
- **Store:** SPARKY 3D CRAFT CO. Shop ID 60736798784. myshopify domain `qmpy10-un.myshopify.com`. Currency INR. Theme "Craft" 15.5.0.

| File | Source URL | Notes |
|---|---|---|
| `products.json` | `https://sparky3dcraft.tech/products.json?limit=250` | 9 products. This is the main migration reference. |
| `collections.json` | `https://sparky3dcraft.tech/collections.json?limit=250` | 2 custom collections. |
| `collection-customized-gifts.products.json` | `/collections/customized-gifts/products.json?limit=250` | 2 products |
| `collection-customized-idols.products.json` | `/collections/customized-idols/products.json?limit=250` | 4 products |
| `collection-all.products.json` | `/collections/all/products.json?limit=250` | 9 products (the automatic "all" collection) |
| `products-js/<handle>.js.json` | `/products/<handle>.js` | Per-product AJAX JSON. Includes `media` (with videos), which `products.json` leaves out. |
| `meta.json` | `/meta.json` | Shop meta: city, province, ships_to_countries, money_format |
| `robots.txt` | `/robots.txt` | verbatim |
| `sitemap.xml`, `sitemap_products_1.xml` | `/sitemap.xml` and child | verbatim |
| `routes.tsv` | curl crawl log | status, redirects and final URL per route |
| `theme-root-styles.css` | inline `<style>` in the `<head>` of `/` | theme CSS custom properties (color schemes, radii, fonts) |
| `computed-styles-probe.json` | Playwright `getComputedStyle` at 1440px and 390px | computed design tokens, sort defaults, contact form fields |

The image URLs in the JSON point to `cdn.shopify.com`. Download them before the Shopify store is closed.
