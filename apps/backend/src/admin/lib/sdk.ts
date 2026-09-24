import Medusa from "@medusajs/js-sdk"

// Admin customizations talk to the same Medusa server with the admin session.
export const sdk = new Medusa({
  baseUrl: import.meta.env.VITE_BACKEND_URL || "/",
  debug: false,
  auth: { type: "session" },
})
