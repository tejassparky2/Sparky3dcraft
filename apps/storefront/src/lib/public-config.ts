/** Values that are safe in the browser (NEXT_PUBLIC_*). Never put secrets here. */
export const publicConfig = {
  medusaUrl: (process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000").replace(/\/$/, ""),
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || "",
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, ""),
  razorpayCheckoutUrl: process.env.NEXT_PUBLIC_RAZORPAY_CHECKOUT_URL || "https://checkout.razorpay.com/v1/checkout.js",
}
