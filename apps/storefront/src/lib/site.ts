/**
 * Site copy and brand facts. Values are taken from the live Shopify site
 * (docs/audit/LIVE-SITE-AUDIT.md, crawled 2026-09-24) — NOT invented.
 * Catalog data never lives here; it always comes from Medusa.
 */
export const site = {
  name: "SPARKY 3D CRAFT CO",
  shortName: "Sparky 3D Craft Co",
  announcement: "SPARKY 3D CRAFT COMPANY",
  homeHeading: "Browse our latest products",
  /** Home page "Featured collection" (live site: Rayara Idols, 4 products). */
  homeFeaturedCategoryHandle: process.env.HOME_FEATURED_CATEGORY || "customized-idols",
  homeFeaturedLimit: 4,
  /** Home page collage order (live site: Personalized Gifts left, Rayara Idols right). */
  homeCollageHandles: (process.env.HOME_COLLAGE_CATEGORIES || "customized-gifts,customized-idols").split(","),
  metaTitle: "Sparky 3D Craft Co | Custom Lithophane Lamps & Gifts",
  metaDescription:
    "Welcome to Sparky 3D Craft Co! We specialize in premium custom 3D printed gifts in India. Shop our unique collection of personalized glowing lithophane photo lamps, crisp shadow projection lamps, and highly detailed divine Hindu god miniatures. Handcrafted in Karnataka with precision tech. Turn your memories into art!",
  newsletterHeading: "Subscribe to our emails",
  newsletterText: "Subscribe to our mailing list for insider news, product launches, and more.",
  /** Published in the live Privacy Policy "Contact" section. */
  contact: {
    phone: "+91 911 306 6579",
    email: "sparky3dcraftco@gmail.com",
    address: "Tirumala Elite Apartment 1297 8th Main Road 2nd Stage Nagapura, Tirumala elite apartment, 560086 Bengaluru KA, India",
  },
  taxNote: "Taxes included.",
  cartNote: "Taxes included. Discounts and shipping calculated at checkout.",
}
