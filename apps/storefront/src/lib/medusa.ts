import "server-only"
import Medusa from "@medusajs/js-sdk"
import { config } from "./config"

let sdk: Medusa | null = null

/** Server-side Medusa JS SDK (Store API with the publishable key). */
export function medusa(): Medusa {
  if (!sdk) {
    sdk = new Medusa({
      baseUrl: config.medusaInternalUrl(),
      publishableKey: config.publishableKey(),
      debug: false,
      // NEVER store tokens on this shared server-side instance: it serves all
      // visitors. Customer JWTs are read from the httpOnly cookie and passed
      // per request (see lib/data/cookies.ts).
      auth: { type: "jwt", jwtTokenStorageMethod: "nostore" },
    })
  }
  return sdk
}

export const CATALOG_TAG = "catalog"
