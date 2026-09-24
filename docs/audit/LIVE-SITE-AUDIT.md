# Live Site Audit: sparky3dcraft.tech (Shopify, before the Medusa v2 migration)

| | |
|---|---|
| **Site** | https://sparky3dcraft.tech/ |
| **Merchant** | SPARKY 3D CRAFT CO (Shop ID `60736798784`, myshopify domain `qmpy10-un.myshopify.com`) |
| **Crawl date/time** | 2026-09-24, 14:59 to about 15:35 UTC (20:29 to 21:05 IST) |
| **Method** | Read-only GET requests (curl) and headless Chromium (Playwright 1.5x, Chromium 141). Nothing was submitted: no cart adds, no forms, no accounts. |
| **Platform/theme** | Shopify Online Store 2.0. `Shopify.theme = {"name":"Craft","id":130380857408,"schema_name":"Craft","schema_version":"15.5.0","theme_store_id":1368,"role":"main"}`. Craft is a free Shopify theme from the Dawn family. Theme assets are served from `/cdn/shop/t/2/assets/`. |
| **Locale/market** | `Shopify.locale="en"`, `Shopify.country="IN"`, `Shopify.currency={"active":"INR","rate":"1.0"}`, `content-language: en-IN`. Money format `Rs. {{amount}}`. Prices display as `Rs. 999.00 INR`, with the currency code shown. |
| **Shop meta** (`/meta.json`) | city Bengaluru, province Karnataka, country IN, `ships_to_countries: ["IN"]`, `published_products_count: 9`, `published_collections_count: 2`, `offers_shop_pay_installments: false` |

Related files:
- Raw JSON and the crawl log: [`raw/`](raw/README.md)
- Verbatim policies: [`policies/`](policies/)
- Brand assets: [`assets/`](assets/)
- Screenshots: [`screenshots/`](screenshots/)

---

## 1. Route map

The HTTP status is the final status after redirects (curl, `-L`). The first-hop status is noted only where it differs.

### 1.1 Storefront routes

| Route | Status | Notes |
|---|---|---|
| `/` | 200 | Home |
| `/collections` | 200 | Collection list page showing 2 collection cards |
| `/collections/all` | 200 | "Products". Lists all 9 products. Default sort is **Alphabetically, A-Z** (`title-ascending`). |
| `/collections/customized-gifts` | 200 | Title "Personalized Gifts". 2 products. Default sort "Most relevant". |
| `/collections/customized-idols` | 200 | Title "Rayara Idols". 4 products. Default sort "Most relevant". |
| `/collections/frontpage` | 404 | No `frontpage` collection exists |
| `/products/<handle>` × 9 | 200 | All 9 handles in §4 return 200 |
| `/products/does-not-exist-404` | 404 | |
| `/collections/does-not-exist-404` | 404 | |
| `/pages/contact` | 200 | The only page (`/pages.json` lists 1 page: `contact`, `body_html: null`) |
| `/pages/about`, `/pages/about-us`, `/pages/faq`, `/pages/shipping` | 404 | No About, FAQ or Shipping pages exist |
| `/blogs/news` | 200 | Blog "News" with **0 articles** (it only shows the heading "News") |
| `/search` | 200 | Empty search page (heading "Search" and a search box) |
| `/search?q=krishna` | 200 | "Search: 5 results found for "krishna"" |
| `/cart` | 200 | Cart page (empty in this crawl) |
| `/cart.js` | 200 | `{"item_count":0,"currency":"INR","requires_shipping":false,...}` |
| `/account`, `/account/login`, `/account/register` | 302 → `https://shopify.com/60736798784/account?...` → `https://shopify.com/authentication/60736798784/login?...` | Uses the **new Shopify customer accounts** (passwordless email code plus "Continue with Shop"). curl got 406 on shopify.com. Chromium rendered the sign-in page (see screenshots). Header "Log in" links go to `/customer_authentication/redirect?locale=en&region_country=IN`. |
| `/checkout` | 302 → `/checkouts/cn/<token>/en-in` → … → `/` (5 hops) | With an empty cart, Shopify sends the visitor back to the homepage. No checkout was created or submitted beyond this single GET. |
| `/this-page-does-not-exist-audit-404` | 404 | Theme 404 page: "404 / Page not found / Continue shopping". Its canonical tag points to `https://sparky3dcraft.tech/404`. |

### 1.2 Policies

| Route | Status | Saved |
|---|---|---|
| `/policies/privacy-policy` | **200** | [`policies/privacy-policy.md`](policies/privacy-policy.md) (verbatim, "Last updated: July 12, 2026") |
| `/policies/refund-policy` | **404** | No published policy |
| `/policies/shipping-policy` | **404** | No published policy |
| `/policies/terms-of-service` | **404** | No published policy. The privacy policy mentions "our Terms of Service" anyway. |
| `/policies/contact-information` | **404** | No published policy |
| `/policies/legal-notice`, `/policies/subscription-policy` | 404 | |

**Important finding:** the live store publishes only a Privacy Policy. It has no Refund, Shipping or Terms of Service policy and no Contact-information page. The footer links only to "Privacy policy".

### 1.3 Machine and SEO endpoints

| Route | Status | Notes |
|---|---|---|
| `/robots.txt` | 200 | Shopify default (see §9.4). Saved to `raw/robots.txt`. |
| `/sitemap.xml` | 200 | Sitemap index containing 5 child sitemaps (see §9.5) |
| `/agents.md` | 200 | Shopify-generated agent instructions (UCP/Shop skill). This is platform boilerplate, not merchant content. |
| `/.well-known/ucp` | 200 | Shopify Universal Commerce Protocol profile. Lists the payment handlers (see §11). |
| `/products.json`, `/collections.json`, `/collections/<h>/products.json`, `/products/<h>.js`, `/meta.json`, `/pages.json` | 200 | Saved under `raw/` |
| `/collections/all.atom`, `/blogs/news.atom`, `*.oembed` | referenced via `<link rel=alternate>` | not fetched |

### 1.4 Navigation graph (links found in the rendered HTML)

- **Header menu (main menu):** Home `/` · Catalog `/collections/all` · Contact `/pages/contact`
- **Header icons:** Search (opens a modal), Account (`/customer_authentication/redirect…`), Cart (`/cart`)
- **Home body:** `/collections/customized-gifts`, `/collections/customized-idols`, and 4 product links
- **Footer:** `/` (copyright), `https://www.shopify.com?utm_campaign=poweredby…` ("Powered by Shopify"), `/policies/privacy-policy`
- Nothing in the navigation links to `/collections`, `/blogs/news` or `/search`. Those pages are reachable only by URL, through the sitemap, or through the search modal.

---

## 2. Header, navigation, announcement bar

**Announcement bar** (color scheme 4, dark green-black `#2C332F`, text `#EFECEC`, bottom border). There is one static message, centered, with no link and no rotation:

> SPARKY 3D CRAFT COMPANY

- The font is Trirong 300 at 14.3px with 1px letter-spacing, and the bar is 39px tall.
- The `localization-wrapper` is empty, so there is **no country or currency selector and no language selector** anywhere on the site.

**Header** (color scheme 1, background `#EFECEC`):
- Layout: `header--top-center` on desktop and `header--mobile-center` on mobile.
- **Desktop (≥990px):** search icon at left, **logo centered**, account and cart icons at right. The menu sits on a **second row, centered**: Home · Catalog · Contact. The active item is underlined.
- Padding is 20px top and bottom on desktop and 10px on mobile. The inner container is capped at 1200px.
- The header is **not sticky**. The section uses `position: sticky` only as the Dawn Safari fix; there is no `<sticky-header>` element, and the header scrolls off-screen.
- Logo: `<h1 class="header__heading">` on the home page, rendered at **100×67 px**. The alt text is "SPARKY 3D CRAFT CO".
- Nav links: Quattrocento Sans 14px, color `rgba(37,37,37,.75)`, 12px padding.
- **Mobile/tablet (<990px):** hamburger at left, logo centered, search and cart icons at right. The account icon moves into the drawer.
- **Mobile drawer** (`header-drawer`, a `<details>` element that slides in from the left; see screenshot `mobile-nav-drawer-open-390x844.jpg`):
  - It lists Home, Catalog and Contact as large links. The active item has a tinted background.
  - The bottom utility area holds "Log in" with an account icon.
  - The social list is empty and there is no localization selector.
- **Search:** clicking the icon opens a **search modal** at the top of the page with **predictive search** (`<predictive-search>`). It shows "Suggestions" terms and "Products" (thumbnail, title, compare-at and sale price), plus a "Search for "…"" link. Example: typing `krish` suggested "krishna" and "little bene krishna" and returned 5 products (screenshot `predictive-search-krish-desktop-1440x900.jpg`).
- **Cart icon behavior:** the theme uses **cart notification** (`cart-notification.js`), not a cart drawer. After an add-to-cart, a small popup under the header shows "Item added to your cart" with "View cart" / "Check out" / "Continue shopping" (these strings are in the header markup). Cart editing happens on the `/cart` **page**.

---

## 3. Footer

The footer group has two sections.

1. **Newsletter section** (color scheme 4, `#2C332F`, full-width, centered):
   - Heading (Trirong 300, 44px): **"Subscribe to our emails"**
   - Subtext: **"Subscribe to our mailing list for insider news, product launches, and more."**
   - Form: a single email field (placeholder "Email", rounded 6px, 1px border) with an arrow submit button. It posts to `/contact#contact_form` with `form_type=customer` and `contact[tags]=newsletter`, which is Shopify's customer-marketing signup.
2. **Footer** (color scheme 4):
   - **No link-list blocks, no brand text, no social icons.** Organization JSON-LD `sameAs` contains 9 empty strings, so no social URLs are configured.
   - **Payment icons:** `<ul class="list list-payment">` is present but **empty**, so no icons render.
   - Bottom row (11px, `rgba(239,236,236,.75)`): **"© 2026, SPARKY 3D CRAFT CO"** (linked to `/`) · **"Powered by Shopify"** · **"Privacy policy"**
   - No country or language selector.

---

## 4. Catalog

### 4.1 Summary

- **9 products**, all published and all **available (in stock)**.
- **Every product is a single-variant "Default Title" product.** There are no option-based variants.
- **No SKUs** (`sku: null` on every variant). No barcodes are shown.
- Every product is **on sale**: compare-at price above price, with a "Sale" badge everywhere.
- Every variant has `requires_shipping: true`, `taxable: true`, `inventory_management: "shopify"` and `inventory_policy: "deny"`.
- Vendor is "SPARKY 3D CRAFT CO" on every product. Only one product has a product type (`Gift`).
- **Weight is 0 g on 8 of 9 products.** The exception is `customized-lithophane-lamp` at 300 g. This matters for shipping-rate setup.
- **2 collections** (both manual/custom, and neither has a description):

| Handle | Title | products_count | Image | Published |
|---|---|---|---|---|
| `customized-gifts` | Personalized Gifts | 2 | yes (`rn-image_picker_lib_temp_b4ac2283-….png`, 1402×1122) | 2026-06-10 |
| `customized-idols` | Rayara Idols | 4 | yes (`rn-image_picker_lib_temp_7e57cd07-….png`, 1254×1254) | 2026-06-10 |

The collection counts in `collections.json` match `/collections/<h>/products.json` and the rendered pages.

### 4.2 Products

The order follows `products.json` (newest first). Prices are INR. Every product shows the "Sale" badge.

| # | Handle | Title | Type | Price | Compare-at | Off | Stock | Images / media | g | Collections (besides `all`) | Published | Tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `rayara-ring-special-offer` | Rayara Ring Special Offer | — | ₹999.00 | ₹1,400.00 | 29% | In stock | 2 / 2 | 0 | — | 2026-09-19 | 0 |
| 2 | `rayaru-with-brundavana` | Rayaru With Brundavana | — | ₹2,999.00 | ₹3,999.00 | 25% | In stock | 1 / 1 | 0 | — | 2026-08-24 | 0 |
| 3 | `rayara-mantrakshate-ring` | Rayara Mantrakshate Ring | — | ₹699.00 | ₹999.00 | 30% | In stock | 2 / 2 | 0 | customized-idols | 2026-07-30 | 0 |
| 4 | `krishna-rayaru` | Krishna Rayaru | — | ₹999.00 | ₹1,299.00 | 23% | In stock | 2 / 2 | 0 | customized-idols | 2026-07-29 | 0 |
| 5 | `vene-rayaru` | Vene Rayaru | — | ₹999.00 | ₹1,399.00 | 29% | In stock | 5 / 5 | 0 | customized-idols | 2026-07-22 | 8 |
| 6 | `raghavendra-swamy` | Guru Raghavendra Swamy | — | ₹999.00 | ₹1,200.00 | 17% | In stock | 2 / **4** (2 videos) | 0 | customized-idols | 2026-07-13 | 6 |
| 7 | `shiva-shadow-lamp` | Shiva Shadow Lamp | — | ₹999.00 | ₹1,699.00 | 41% | In stock | 3 / 3 | 0 | — | 2026-07-05 | 7 |
| 8 | `cute-little-bene-krishna` | Cute little bene krishna | — | ₹799.00 | ₹1,200.00 | 33% | In stock | 4 / 4 | 0 | customized-gifts | 2026-07-02 | 7 |
| 9 | `customized-lithophane-lamp` | Customized Lithophane Lamp | Gift | ₹999.00 | ₹1,299.00 | 23% | In stock | 8 / 8 | 300 | customized-gifts | 2026-06-09 | 25 |

- **Options:** every product has a single option `Title` = `Default Title`.
- **Variant IDs** (for redirect and URL mapping):

| Handle | Variant ID |
|---|---|
| `rayara-ring-special-offer` | 41375081529408 |
| `rayaru-with-brundavana` | 41342947131456 |
| `rayara-mantrakshate-ring` | 41322964156480 |
| `krishna-rayaru` | 41321538519104 |
| `vene-rayaru` | 41313928904768 |
| `raghavendra-swamy` | 41304175280192 |
| `shiva-shadow-lamp` | 41295992029248 |
| `cute-little-bene-krishna` | 41292457279552 |
| `customized-lithophane-lamp` | 41252265689152 |

- **Product IDs** are in `raw/products.json`.
- **Not in any custom collection** (reachable only via Catalog, search or direct link): `rayara-ring-special-offer`, `rayaru-with-brundavana`, `shiva-shadow-lamp`.
- **Rendered-order checks:**
  - `/collections/all` renders A-Z: Customized Lithophane Lamp, Cute little bene krishna, Guru Raghavendra Swamy, Krishna Rayaru, Rayara Mantrakshate Ring, Rayara Ring Special Offer, Rayaru With Brundavana, Shiva Shadow Lamp, Vene Rayaru.
  - `customized-idols` renders: raghavendra-swamy, krishna-rayaru, vene-rayaru, rayara-mantrakshate-ring.
  - `customized-gifts` renders: cute-little-bene-krishna, customized-lithophane-lamp.
- **Tags** (verbatim, from `products.json`):
  - vene-rayaru: divine gifts, Hindu spiritual decor, home altar decor, pooja room idols, Raghavendra Swamy car dashboard idol, Sri Raghavendra Swamy idol, Veena Rayaru statue, Vene Rayaru murti
  - raghavendra-swamy: mantralaya, mantralayam, Raghavendra, Raghavendra swamy, Rayaredare, Rayaru
  - shiva-shadow-lamp: lamp, lord shiva, mahadev, mahadev lamp, night lamp, Shiva, shiva lamp
  - cute-little-bene-krishna: 3d print, Bene krishna, Customized gift, God, God idols, Krishna, Little Krishna
  - customized-lithophane-lamp: 25 tags ("3D Photo Lamp", "Anniversary gift", … "Unique Wedding Gift"). The full list is in raw JSON.
- **Descriptions:** the full HTML is in `raw/products.json` (`body_html`). Short descriptions, verbatim:
  - rayara-ring-special-offer: "Limited time special offer normal price 1400 for 2 offer price 999 for 2 grab soon"
  - rayaru-with-brundavana: "Big model 20cm lord rayaru with brundavana and cows / Delivery takes 8-10 days"
  - krishna-rayaru: "Delivery takes 8-10 days due to high demand  whatsapp : 9113066579 for more information"
  - cute-little-bene-krishna: "Delivery Takes 8-10 Days Due To High Demand. / This cute little bene krishna is 3d printed with every details and hand painted with care and passion"
  - rayara-mantrakshate-ring: written in Kannada transliterated into Latin script, about the anti-tarnish coating and a Mantralaya mantrakshate. Ends "Delivery 8-10 days".
  - vene-rayaru, raghavendra-swamy, shiva-shadow-lamp and customized-lithophane-lamp have longer marketing copy with "Key Features" and similar lists.

### 4.3 Discrepancies and data-quality notes

1. **`raghavendra-swamy` has 2 hosted videos** (MP4, about 4.1 s and 3.9 s, positions 2 and 3) that appear in `/products/<h>.js` `media` and on the product page, but **not in `products.json`** (which lists only images). Use `raw/products-js/*.js.json` for media migration.
2. **`vene-rayaru` description says "Price: ₹799.00 (Regularly ₹1,399.00)"**, but the actual price is **₹999.00** (compare-at ₹1,399.00).
3. **`customized-lithophane-lamp` description says "Add Your Custom Text: Type the exact message or name…"**, but the product page has **no text input**. It only has a photo upload and a Color swatch (see §5.2).
4. **`rayara-ring-special-offer` and `rayara-mantrakshate-ring` use identical image files** (`…94e3f770….png`, `…d5a62d12….png`). The special offer is "for 2" according to its description, but it is still a single-quantity variant priced ₹999.
5. **No product image has alt text** (`alt: null` on every image). Image filenames are app-upload temp names (`rn-image_picker_lib_temp_<uuid>`).
6. Only `customized-lithophane-lamp` has a custom SEO title/description ("Personalized 3D Photo Lamp | Custom Lithophane – Sparky 3D Craft Co"). The other products fall back to the title and the first description text.
7. The product sitemap's `lastmod` (2026-09-24T20:29:55+05:30) and `updated_at` are identical across all 9 products, which looks like a bulk touch at about 20:29 IST on the crawl day.
8. Several descriptions promise **"Delivery takes 8-10 days"**. `shiva-shadow-lamp` also says "Bengaluru Locals: Local pickup options are available at checkout!" The product page has a `pickup-availability` block, but it rendered **empty**, so no pickup location was shown.
9. The rendered prices, compare-at prices, badges and availability on the collection, search, home and product pages **all match `products.json`**. No drafts or hidden products were detected: sitemap, `products.json`, `/collections/all` and `meta.json` all say 9.

---

## 5. Product page (template `product`, section `main-product`)

Screenshots:
- `product-rayara-ring-special-offer-*` (the first product in `products.json`)
- `product-customized-lithophane-lamp-*` (the customizable product)

### 5.1 Layout

- **Desktop:** a two-column layout (`product--left`, `product--medium`, `product--stacked`).
  - **Gallery on the left.** The first image is full width, and the remaining images are **stacked in a 2-column grid** below it. There are no thumbnails.
  - Hovering over an image shows a zoom icon. Clicking opens a **full-screen media modal/lightbox** ("Open media N in modal").
  - The info column on the right is sticky (`product__column-sticky`).
- **Mobile:** the gallery becomes a **horizontal swipe slider** that peeks at the next image. Below it are arrow buttons and a counter "1 / 2" (on the lithophane page "1 / 8"). Thumbnails are hidden (`product--mobile-hide`).
- **Info column order:**
  1. Vendor text "SPARKY 3D CRAFT CO" (small caps-style caption)
  2. Title `<h1>` (Trirong 300, 44px desktop)
  3. Price row: compare-at **struck through** (`Rs. 1,400.00 INR`, 13px, 75% opacity), then the sale price (`Rs. 999.00 INR`, 18px), then a **"Sale" badge** (color scheme 5, `#3F5147` background, `#EFECEC` text, 6px radius). A "Sold out" badge (scheme 4) exists but is hidden while the product is available.
  4. **"Taxes included."** (caption, under the price)
  5. **Quantity selector:** label "Quantity", with a − / number input / + stepper (142×47px, 6px radius, min 1)
  6. *(Lithophane only)* YMQ/King Product Options fields (see §5.2)
  7. **"Add to cart"**: full-width **secondary (outlined)** button. Background `#EFECEC`, text `#505655`, 1px border, 7px radius, 47px tall.
  8. **"Buy it now"**: Shopify dynamic checkout button, unbranded. Full-width **primary (filled)** style: `#2C332F` background, white text, 7px radius, weight 500. It is **visible on regular products and not rendered on the lithophane lamp**. The lithophane is the only product with the options app's required fields, so the app is the likely cause; this was not confirmed.
  9. Pickup availability (renders nothing)
  10. Description (rich text)
  11. "Share" button (copy-link fallback)
- **No variant picker** (all products are Default Title).
- **No SKU display, no inventory count, no delivery-date widget, no COD messaging.** "COD" and "Cash on delivery" do not appear anywhere on the site.
- **Below the product:** a "**You may also like**" product-recommendations grid (Shopify recommendations; 4 per row desktop, 2 per row mobile).

### 5.2 Product personalization app

The **"King Product Options" app (YMQ)** is installed as an app embed on every page. It defines 2 option sets, both **manually assigned only to `customized-lithophane-lamp`** (product id 7258829520960):

| Option set | Field | Type | Required | Values |
|---|---|---|---|---|
| tem238466 | **"Upload Your Custom Photo"** | file upload (type 12), button text "Upload", 1 file | yes | Rendered as "Choose file / or drop file to upload" |
| tem238493 | **"Color"** | color swatch (type 5) | yes | BLACK `#000000`, GOLD `#d4af37`, BROWN `#8b4513`, WHITE `#f5f5f5` (no price add-ons) |

- These fields become **line-item properties** in the Shopify cart.
- For Medusa, this needs a plan: custom line-item metadata plus a file upload. Alternatively, make Color a real product option and handle the photo upload as metadata.
- The lithophane images 5 to 8 are per-color illustrations. They show "COLOR OPTION: BLACK / GOLD / BROWN / WHITE", "Rear Control: On/Off Switch", "DC Power Input (12V)" and "Integrated Feet for Stand".

---

## 6. Home page, section by section (template `index`)

Screenshots: `home-desktop-1440x900.jpg`, `home-tablet-820x1180.jpg`, `home-mobile-390x844.jpg`

1. **Announcement bar:** "SPARKY 3D CRAFT COMPANY"
2. **Header:** see §2
3. **Rich text** (`rich_text`, color scheme 1, centered, full-width). There is only a heading, with no body or button:
   > **Browse our latest products**

   The heading is an h1-size h2, Trirong 300 at 44px, with a slide-in animation.
4. **Collage** (`collage-0`). It holds 2 collection cards and **no heading**:
   - Left (narrower, about 1/3 width on desktop): **"Personalized Gifts →"** linking to `/collections/customized-gifts`. Its image shows the "CUSTOMIZED GIFTS" artwork (lithophane, wallet and photo frame).
   - Right (wider, about 2/3 width): **"Rayara Idols →"** linking to `/collections/customized-idols` (image of a Raghavendra Swamy idol on white).
   - On mobile the two cards sit side by side in a 2-column layout.
   - Cards use the collection style: 6px radius, 1px border at 10% opacity, title below the image, arrow icon.
5. **Featured collection** (`featured-collection`), sourced from **Rayara Idols** (`customized-idols`):
   - **No heading, no description and no "View all" button.**
   - 4 product cards in a 4-column grid on desktop and a 2-column grid on tablet and mobile: Guru Raghavendra Swamy, Krishna Rayaru, Vene Rayaru, Rayara Mantrakshate Ring.
   - Cards: square image (ratio 1:1), "Sale" badge at bottom-left over the image, title (Trirong 300, about 14px), struck compare-at price, then sale price.
   - Bottom padding is 51px on mobile and 68px on desktop, with 0 top padding.
6. **Footer group:** the newsletter and footer described in §3.

The home page has **no hero, slideshow, image-with-text, testimonials, or video section.**

---

## 7. Collection, catalog and search pages

- **Collection banner:** "Collection: " (visually hidden) and the title as a large heading ("Products", "Personalized Gifts", "Rayara Idols"). There is no description and no banner image.
- **Grid:**
  - 4 columns on desktop and 2 on tablet and mobile.
  - Product cards on collection pages use a **portrait 4:5 image ratio** (`--ratio-percent:125%`). The home featured collection and search results use **square 1:1** images.
  - Card style: 6px radius, 1px border at 10% opacity, no shadow, text left-aligned below the image, image hover effect (`media--hover-effect`).
  - All 9 products fit on one page, so no pagination is needed.
- **Filters** (Shopify Search & Discovery, horizontal on desktop and a "Filter and sort" drawer on mobile):
  - **Availability:** In stock (9) / Out of stock (0)
  - **Price:** range with ₹ From/To inputs, "The highest price is Rs. 2,999.00"
  - "Remove all" and "Reset" links
- **Sort by** options: Featured (`manual`), Most relevant, Best selling, Alphabetically A-Z, Alphabetically Z-A, Price low to high, Price high to low, Date old to new, Date new to old.
  - Default is **A-Z** on `/collections/all` and **Most relevant** on the two custom collections.
- **Product count** is shown ("9 products").
- **`/collections` list page:** heading "Collections" and 2 collection cards (Personalized Gifts, Rayara Idols).
- **Search** (`/search?q=krishna`):
  - Heading "Search results", a search box, the same Availability and Price filters, and Sort by Relevance / Price low to high / Price high to low.
  - Reports "5 results". The results are cute-little-bene-krishna, krishna-rayaru, vene-rayaru, raghavendra-swamy and rayaru-with-brundavana. Some matches come from description and body text.
  - Only products appear in results. There are no pages or articles to match.
- **Predictive search** in the header modal: see §2.

---

## 8. Cart and contact

### 8.1 Cart

- **Type:** a notification popup after adding an item, plus the full **`/cart` page**. There is no cart drawer.
- **Empty cart page, verbatim:**

  > Your cart is empty / Continue shopping / Have an account? Log in to check out faster.

- **Cart footer:**

  > Estimated total Rs. 0.00 INR / Taxes included. Discounts and shipping calculated at checkout. / [Check out]

- The **Check out** button uses the primary style: `#2C332F` background, white text, 7px radius.
- There is **no cart note field**, and no discount-code field on the cart page (discounts are applied at checkout).
- `/cart.js` returns an empty cart with currency INR.

### 8.2 Contact page (`/pages/contact`)

- Heading **"Contact"**. The page has **no body text** (`body_html: null`).
- **The contact page shows no business email, phone or address.**
- **Contact form** (`form_type=contact`, 2-column on desktop):

| Field | Name attribute | Type | Required |
|---|---|---|---|
| Name | `contact[Name]` | text | no |
| Email * | `contact[email]` | email | **yes** |
| Phone number | `contact[Phone number]` | tel | no |
| Comment | `contact[Comment]` | textarea | no |

  The submit button **"Send"** uses the primary style: `#2C332F`, white text, 7px radius.

### 8.3 Business contact info (all the site shows publicly)

- **In the Privacy Policy "Contact" section**, verbatim:

  > please call +91 911 306 6579 or email us at sparky3dcraftco@gmail.com or contact us at Tirumala Elite Apartment 1297 8th Main Road 2nd Stage Nagapura, Tirumala elite apartment, 560086 Bengaluru KA, India

- **In the `krishna-rayaru` product description:** "whatsapp : 9113066579" (the same number).
- `meta.json`: city Bengaluru, province Karnataka, country IN.
- There is **no WhatsApp chat widget** or other chat app.

---

## 9. SEO

### 9.1 Global

- `<html lang="en">`. There are no `hreflang` alternates and no `meta robots` tags.
- The `<title>` pattern is `{page title} – SPARKY 3D CRAFT CO`. Shopify appends the shop name.
- `og:image` is served with an **`http://`** URL, and `og:image:secure_url` carries the https URL.
- **Default share image:** `assets/og-share-image.png` (1536×1024).
- **Twitter:** `twitter:card=summary_large_image`, with no `twitter:site`.

### 9.2 Per page

| Page | `<title>` | Meta description | Canonical | OG type |
|---|---|---|---|---|
| Home | "Sparky 3D Craft Co \| Custom Lithophane Lamps & Gifts – SPARKY 3D CRAFT CO" | "Welcome to Sparky 3D Craft Co! We specialize in premium custom 3D printed gifts in India. Shop our unique collection of personalized glowing lithophane photo lamps, crisp shadow projection lamps, and highly detailed divine Hindu god miniatures. Handcrafted in Karnataka with precision tech. Turn your memories into art!" | `https://sparky3dcraft.tech/` | website |
| `/collections/all` | "Products – SPARKY 3D CRAFT CO" | **none** (og:description falls back to the shop description) | `/collections/all` | website |
| `/collections/customized-idols` | "Rayara Idols – SPARKY 3D CRAFT CO" | **none** (og falls back to the shop description; og:image is the collection image, 1254×1254) | `/collections/customized-idols` | website |
| `/products/rayara-ring-special-offer` | "Rayara Ring Special Offer – SPARKY 3D CRAFT CO" | "Limited time special offer normal price 1400 for 2 offer price 999 for 2 grab soon" | `/products/rayara-ring-special-offer` | product (`og:price:amount=999.00`, `og:price:currency=INR`) |
| `/products/customized-lithophane-lamp` | "Personalized 3D Photo Lamp \| Custom Lithophane – Sparky 3D Craft Co – SPARKY 3D CRAFT CO" | "Transform your favorite photos into a stunning 3D carved lithophane lamp. Perfect personalized gift for birthdays & anniversaries. 12V DC power unit included." | `/products/customized-lithophane-lamp` | product |
| `/pages/contact` | "Contact – SPARKY 3D CRAFT CO" | none | `/pages/contact` | website |
| `/cart` | "Your Shopping Cart – SPARKY 3D CRAFT CO" | none | `/cart` | website |

The other product pages use the product title and the first 160 characters of the description (see `raw/`).

### 9.3 JSON-LD

- **Every page** has **Organization** JSON-LD:

  ```json
  {"@type":"Organization","name":"SPARKY 3D CRAFT CO","logo":"https://sparky3dcraft.tech/cdn/shop/files/file_000000005c8071f8b369145ba477d45a.png?v=1780423780&width=500","sameAs":["","","","","","","","",""],"url":"https://sparky3dcraft.tech"}
  ```

- **Home only:** a **WebSite** block with a `SearchAction` whose target is `https://sparky3dcraft.tech/search?q={search_term_string}`.
- **Product pages:** a **Product** block with these fields:
  - `@id` `/products/<h>#product`, `name`, `description` (plain text), `image` (a single URL, width 1920), `url`
  - `brand` {Brand "SPARKY 3D CRAFT CO"}, `category` (empty, or "Gift Giving" for the lithophane)
  - `offers`: {Offer, `@id` `…?variant=<id>#offer`, `availability` InStock, `price` "999.00", `priceCurrency` INR, `url` `…?variant=<id>`}
  - **No** `sku`, `gtin`, `aggregateRating`, `review` or `priceValidUntil`.
- **Collection pages:** Organization only. There is **no BreadcrumbList or ItemList** on any page.

### 9.4 robots.txt

This is Shopify's standard 2026 file, saved verbatim to `raw/robots.txt`. Key rules for `User-agent: *`:

- Allow `/`.
- Disallow `/admin`, `/cart/`, `/checkout`, `/checkouts/`, `/orders`, `/account` (but allow `/account/login`), `/60736798784`, `/services`, `/sf_*`, `/cart.js`, `/recommendations/products`.
- Disallow sort and filter crawl traps (`/collections/*sort_by*`, `*+*`, `*filter*&*filter*`), plus `preview_theme_id` and `oseid` parameters.
- There is a separate `adsbot-google` block.
- `Sitemap: https://sparky3dcraft.tech/sitemap.xml`.
- The header comments point agents to `/agents.md` and the UCP/MCP endpoints.

### 9.5 Sitemap

`/sitemap.xml` is a sitemap index with these children, all returning 200:

| Child sitemap | Contents |
|---|---|
| `sitemap_agentic_discovery.xml` | `/agents.md` |
| `sitemap_products_1.xml?from=7258829520960&to=7291769716800` | `/` plus the 9 product URLs, each with its image:loc and image:title |
| `sitemap_pages_1.xml?from=95702646848&to=95702646848` | `/pages/contact` |
| `sitemap_collections_1.xml?from=284857729088&to=284857991232` | `/collections/customized-gifts`, `/collections/customized-idols` |
| `sitemap_blogs_1.xml` | `/blogs/news` |

`/collections/all` and the policy pages are not in the sitemap. That is standard Shopify behavior.

**URL preservation for the migration:** the URLs to keep (or 301-redirect) are the 9 `/products/<handle>` URLs, the 2 `/collections/<handle>` URLs, `/collections/all`, `/pages/contact` and `/policies/privacy-policy`.

---

## 10. Design system

### 10.1 Color schemes

These are the theme settings, taken verbatim from `:root` in `raw/theme-root-styles.css`. The values are shown as hex.

| Token | Scheme 1 (default: body, header, cards) | Scheme 2 | Scheme 3 | Scheme 4 (announcement, newsletter, footer, sold-out badge) | Scheme 5 (Sale badge) |
|---|---|---|---|---|---|
| background | **#EFECEC** | #FFFFFF | #716A56 | **#2C332F** | **#3F5147** |
| foreground (text) | **#252525** | #252525 | #EFECEC | **#EFECEC** | #EFECEC |
| button (primary bg) | **#2C332F** | #252525 | #EFECEC | #EFECEC | #EFECEC |
| button text | **#FFFFFF** | #FFFFFF | #716A56 | #2C332F | #3F5147 |
| secondary button bg | **#EFECEC** | #FFFFFF | #716A56 | #2C332F | #3F5147 |
| secondary button text | **#505655** | #252525 | #EFECEC | #EFECEC | #EFECEC |
| link | #505655 | #252525 | #EFECEC | #EFECEC | #EFECEC |
| badge fg / bg / border | #252525 / #EFECEC / #252525 | #252525 / #FFFFFF / #252525 | #EFECEC / #716A56 / #EFECEC | #EFECEC / #2C332F / #EFECEC | #EFECEC / #3F5147 / #EFECEC |
| background-contrast | #B5A7A7 | #BFBFBF | #29261F | #38413C | #070908 |
| shadow | #252525 | #252525 | #252525 | #252525 | #252525 |

How the theme applies these colors:

- **Body text** is foreground at **75% opacity**, which is `rgba(37,37,37,.75)` on scheme 1.
- **Headings** use the full foreground color (`#252525`).
- **Price:** the sale price is `#252525`. The compare-at price is struck through at 75% opacity.
- **Sale badge:** `#3F5147` background, `#EFECEC` text, 1px border at 10% opacity, 6px radius, 12px text, padding 5px 13px 6px.
- **Borders:** inputs use 1px foreground borders at 55% opacity. Cards use 1px borders at 10% opacity.
- **Brand logo colors** (sampled from the pixels of `logo-original.png`): orange **`#FF4300`** (the most common opaque orange pixel; the range runs from #FF4100 to #FF4500) for the bolt and the "3D" outline, and **`#000000`** for the wordmark. The background is transparent (most pixels have alpha 0). These colors are **not** used in the theme UI.

### 10.2 Typography

Fonts are self-hosted by Shopify under `/cdn/fonts/…` as woff2 and woff, and are also available on Google Fonts.

- **Body:** **Quattrocento Sans**, sans-serif. Weight 400 (bold 700; italic 400 and 700 are declared).
  - Base size 15px on mobile and 16px at ≥750px, via `html{font-size:62.5%}` with body at 1.5rem/1.6rem.
  - Line-height `calc(1 + .8/1)` = 1.8, letter-spacing 0.06rem (0.6px).
  - `--font-body-scale: 1.0`.
- **Headings:** **Trirong**, serif, **weight 300** only. `--font-heading-scale: 1.1`, letter-spacing 0.066rem.
  - h1 / `.h1` = 44px on desktop and 33px on mobile (measured at 390px), line-height about 1.27.
  - Card title h5 = 14.3px. Collage card heading = 19.8px.
- **Fonts loaded at runtime:** "Quattrocento Sans 400 normal" and "Trirong 300 normal". Both are preloaded.
- **Buttons, nav and prices:** Quattrocento Sans. Buttons are 15px with 1px letter-spacing and are **not uppercase** (`text-transform: none`).

### 10.3 Shape, spacing and components

| Token | Value |
|---|---|
| Page max width (`--page-width`) | **120rem = 1200px**, with 50px side padding at 1440px (measured). At 390px the collection hero `.page-width` measured 30px side padding, and product grids and cards start about 15px from the edge (from the screenshots). |
| Section spacing (`--spacing-sections-*`) | 0px on desktop and mobile. Sections set their own padding. |
| Grid gaps | 20px horizontal and vertical on desktop, 10px on mobile |
| Buttons | radius **6px** (outset 7px), 1px border at 100% opacity, no shadow, min-height 47px (4.7rem), padding 0 30px, 15px text. Primary is filled with the scheme button color. Secondary is outlined. |
| Inputs | radius 6px, 1px border at 55% opacity, no shadow, padding 15px, height 45px |
| Variant pills | radius 40px, 1px border at 55% opacity (not used, since there are no variants) |
| Product cards | style "card": radius **6px**, border **1px at 10% opacity**, no shadow, 0 image padding, left-aligned text. Image ratio: **square** on the home page and in search, **portrait 4:5** on collection pages. |
| Collection cards | style "card": radius 6px, 1px border at 10% opacity, left text |
| Media | radius 6px, border 0, no shadow |
| Badges | radius 6px, bottom-left position on cards |
| Popups / drawers | popup radius 6px, 1px border at 50% opacity. Drawer 1px border at 10% opacity. No shadows. |
| Text boxes | radius 6px, no border |
| Animations | "slide-in" reveal on scroll (`scroll-trigger animate--slide-in`) and image hover effect on cards |
| Icons | Dawn outline SVG icons (search, account, cart, hamburger, arrow) |

### 10.4 Brand assets (downloaded to `assets/`)

| File | Source | Dimensions |
|---|---|---|
| `logo-original.png` | `https://sparky3dcraft.tech/cdn/shop/files/file_000000005c8071f8b369145ba477d45a.png?v=1780423780` | **1536×1024** RGBA PNG, 2.0 MB. The header renders it at 100px wide (67px tall). |
| `logo-200w.png` | the same file with `&width=200` | 200×133 |
| `favicon-original.png` | `https://sparky3dcraft.tech/cdn/shop/files/file_000000009ce4720b8be09e8b309ea831.png?v=1780423514` | 1536×1024 RGBA PNG |
| `favicon-32.png` | the same file with `crop=center&height=32&width=32` (the URL used in `<link rel="icon">`) | 32×32 |
| `og-share-image.png` | `…/files/file_00000000a5b8720ba38a01c7c647e7f4_917cbbae-….png?v=1780424092` (the default `og:image`) | 1536×1024 |

- **Logo:** an orange lightning bolt with a 3D-printer nozzle, next to the stacked wordmark "SPARKY / 3D / CRAFT CO". "3D" is in orange outline type.
- **Favicon:** the bolt-and-nozzle mark on its own.
- **Both source PNGs are 1536×1024 with a lot of padding.** The new site should use cropped, optimized versions.

---

## 11. Checkout, payments, shipping and tax

- **Checkout:** hosted by Shopify at `/checkouts/cn/<token>/en-in`, which is disallowed in robots. It is reachable from the cart and from "Buy it now". Checkout was not tested further, following instructions and the robots policy.
- **Public payment hints:**
  - The footer payment-icon list is **empty**.
  - Product pages carry the Shopify accelerated-checkout element (`buyer-country="IN"`, `buyer-currency="INR"`), which renders an **unbranded "Buy it now"** button. No Shop Pay, GPay or Apple Pay wallet button rendered.
  - `/.well-known/ucp` lists `com.google.pay` (CARD: Visa, Mastercard, Amex, Discover; gateway "shopify") and `dev.shopify.card` (visa, master, american_express, discover, diners_club).
  - `meta.json`: `shopify_pay_enabled_card_brands: []`, `offers_shop_pay_installments: false`.
  - **There is no public mention of UPI, COD, Razorpay or similar.**
- **Shipping:**
  - Ships to **India only** (`ships_to_countries: ["IN"]`).
  - There is no shipping policy page and the cart shows no shipping rates ("shipping calculated at checkout").
  - Several product descriptions state an 8 to 10 day delivery.
  - `shiva-shadow-lamp` mentions local pickup in Bengaluru.
  - The UCP fulfillment config lists only the `shipping` method.
- **Tax:**
  - Prices are **tax-inclusive**. "Taxes included." appears under every product price, and the cart says "Taxes included. Discounts and shipping calculated at checkout."
  - Every variant is `taxable: true`.
  - No GST number or GST breakdown is shown publicly.
- **Currency/locale:** INR only, English only, IN market only. There is no selector.

---

## 12. Installed apps and third-party scripts

| Item | Details |
|---|---|
| **King Product Options (YMQ)** | Loaded as an app embed on every page. It supplies the lithophane photo-upload and Color options. |
| Shopify built-ins | Web Pixels Manager (analytics), perf-kit, portable-wallets (accelerated checkout), shop-js (`init-shop-cart-sync`), predictive search, product recommendations, Search & Discovery filters |
| Theme JS | Standard Dawn/Craft files: `global.js`, `cart-notification.js`, `predictive-search.js`, `details-modal.js`, `animations.js`, `pubsub.js`, and similar |
| Not present | No reviews app, chat or WhatsApp widget, or pop-ups. A grep for `googletagmanager`, `gtag(`, `fbq(` and `connect.facebook` in the home and product HTML found nothing. Pixels may still run inside the Web Pixels sandbox, where they would not be visible. |

---

## 13. Screenshots index (`screenshots/`)

- Full-page JPEGs at quality 60, captured at **mobile 390×844**, **tablet 820×1180** and **desktop 1440×900**.
- Scroll-reveal animations were forced visible so that below-the-fold content renders.

| Page | Files |
|---|---|
| Home | `home-{mobile-390x844,tablet-820x1180,desktop-1440x900}.jpg` |
| Catalog `/collections/all` | `catalog-all-*.jpg` |
| Collection Personalized Gifts | `collection-customized-gifts-*.jpg` |
| Collection Rayara Idols | `collection-customized-idols-*.jpg` |
| Collections list | `collections-list-*.jpg` |
| Product (first in products.json) | `product-rayara-ring-special-offer-*.jpg` |
| Product with custom options | `product-customized-lithophane-lamp-*.jpg` |
| Search results `q=krishna` | `search-krishna-*.jpg` |
| Contact | `contact-*.jpg` |
| Cart (empty) | `cart-empty-*.jpg` |
| Login (Shopify new customer accounts, on shopify.com) | `login-*.jpg` |
| 404 | `404-*.jpg` |
| Privacy policy | `privacy-policy-*.jpg` |
| Mobile nav drawer open | `mobile-nav-drawer-open-390x844.jpg` (viewport only) |
| Predictive search open | `predictive-search-krish-desktop-1440x900.jpg` (viewport only) |

---

## 14. Migration-relevant takeaways (factual)

1. The catalog is small and simple: 9 single-variant products, no SKUs, INR, all on sale, and 2 manual collections plus "all". The Medusa seed can be generated directly from `raw/products.json`, with media taken from `raw/products-js/`.
2. **Customization is required** for the lithophane lamp: a required photo upload and a required Color choice from BLACK, GOLD, BROWN or WHITE. On Shopify these run through a third-party options app.
3. **Missing legal pages.** Only the Privacy Policy exists. Refund, Shipping and Terms pages will need new merchant-approved text; nothing can be copied for them.
4. The design is a very simple Craft theme: an off-white `#EFECEC` background, dark green-black `#2C332F` for the primary color and footer, `#3F5147` for sale badges, Trirong 300 headings with Quattrocento Sans body text, 6px radii, and 1px borders at 10% opacity.
5. SEO URLs to preserve: `/products/<9 handles>`, `/collections/customized-gifts`, `/collections/customized-idols`, `/collections/all`, `/pages/contact` and `/policies/privacy-policy`.
