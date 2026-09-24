# SEO

The goal is **no loss of search visibility at cutover**. Every public Shopify URL either keeps
working at the same path or permanently redirects to its equivalent.

## URL preservation

| Shopify URL | New site |
|---|---|
| `/` | same |
| `/products/<handle>` (all 9) | same path, same handle |
| `/collections/customized-gifts`, `/collections/customized-idols` | same path (Medusa categories with the same handle) |
| `/collections` | same (collection list) |
| `/collections/all` | 308 → `/catalog` |
| `/collections/<c>/products/<h>` | 308 → `/products/<h>` |
| `/pages/contact` | 308 → `/contact` |
| `/policies/privacy-policy` / `terms-of-service` / `shipping-policy` / `refund-policy` | 308 → `/privacy` / `/terms` / `/shipping` / `/refunds` |
| `/account/login`, `/account/register` | 308 → `/login`, `/register` |
| `/blogs/news` (0 articles) | 307 → `/` (temporary, in case a blog is added later) |
| `/search?q=` | same |
| unknown paths | real **404** status (not a soft 404) with the theme's "Page not found" page |

The redirects live in `apps/storefront/next.config.ts`. `final-verification.sh` checks three of them on the server.

## On-page

- `<title>` and meta descriptions follow the Shopify pattern (`<Product> – SPARKY 3D CRAFT CO`). Canonical URLs use the production domain (`NEXT_PUBLIC_SITE_URL`).
- Open Graph and Twitter cards on every page, with the product image or `og-default.jpg`.
- JSON-LD:
  - `Organization` (with a ContactPoint) and `WebSite` (with a `SearchAction`) site-wide
  - `Product` + `Offer` (price, INR, availability, brand) and `BreadcrumbList` on product pages
  - `BreadcrumbList` on collection pages
- Image `alt` text is migrated from Shopify. `final-verification.sh` fails if a product image has no alt text.
- `sitemap.xml` lists the home page, catalog, contact, every category and every product (with images). It is generated from live data, so it stays current after Admin edits.
- `robots.txt` (production) mirrors Shopify's private and crawl-trap rules: `/cart`, `/checkout`, `/account`, `/search`, sort/filter parameters. It references the sitemap.

## Staging must never be indexed

With `SITE_NOINDEX=true` (set automatically in staging mode), the robots file serves `Disallow: /` and every page carries `<meta name="robots" content="noindex">`.

In **production** mode, `final-verification.sh` **fails** if `robots.txt` blocks the site or the home page has `noindex`.

## After cutover (manual)

1. Google Search Console: verify the domain property (DNS TXT) if it isn't already. Submit
   `https://sparky3dcraft.tech/sitemap.xml`. Watch Coverage/Pages for 404s over 2–4 weeks.
2. Spot-check old URLs from Search Console's "Top pages" with `curl -sI`.
3. Keep the domain and HTTPS the same (they are unchanged), so no change-of-address is needed.
