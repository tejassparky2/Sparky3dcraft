import { loadEnv, defineConfig } from "@medusajs/framework/utils"
import { validateBackendEnv, isProduction, readEnv } from "./src/lib/env"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// ---------------------------------------------------------------------------
// Fail fast on insecure / incomplete production configuration.
// Only variable NAMES are printed, never values.
// ---------------------------------------------------------------------------
const problems = validateBackendEnv(process.env, { production: isProduction })
if (problems.length) {
  const msg = problems.map((p) => `  - ${p.name}: ${p.problem}`).join("\n")
  if (isProduction) {
    throw new Error(`[sparky] Refusing to start: invalid production environment:\n${msg}`)
  }
  // eslint-disable-next-line no-console
  console.warn(`[sparky] Environment warnings (non-production):\n${msg}`)
}

const REDIS_URL = readEnv("REDIS_URL")
// Separate logical Redis databases per concern (see docs/research/decisions/ADR-004-redis.md).
// Each defaults to REDIS_URL so a single URL still works.
const EVENTS_REDIS_URL = readEnv("EVENTS_REDIS_URL") ?? REDIS_URL
const WE_REDIS_URL = readEnv("WE_REDIS_URL") ?? REDIS_URL
const LOCKING_REDIS_URL = readEnv("LOCKING_REDIS_URL") ?? REDIS_URL
const CACHE_REDIS_URL = readEnv("CACHE_REDIS_URL") ?? REDIS_URL

const FILE_PROVIDER = readEnv("FILE_PROVIDER") ?? (readEnv("S3_BUCKET") ? "s3" : "local")
const workerMode = (readEnv("MEDUSA_WORKER_MODE") ?? "shared") as "shared" | "worker" | "server"

const modules: Record<string, unknown>[] = []

// --- Redis infrastructure modules (production). In development without
// REDIS_URL Medusa falls back to its in-memory/local defaults; production
// refuses to start without REDIS_URL (validateBackendEnv).
if (REDIS_URL) {
  modules.push(
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/caching-redis",
            id: "caching-redis",
            is_default: true,
            options: { redisUrl: CACHE_REDIS_URL, prefix: "sparky:cache:" },
          },
        ],
      },
    },
    {
      // Deprecated Cache Module — still used by the Auth Module for OAuth
      // state / MFA challenges (medusajs/medusa#16498). Medusa Cloud registers
      // it too. Without it those fall back to per-process memory.
      resolve: "@medusajs/medusa/cache-redis",
      options: { redisUrl: CACHE_REDIS_URL, namespace: "sparky:legacy-cache:" },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: EVENTS_REDIS_URL,
        queueName: "sparky-events",
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: { redisUrl: WE_REDIS_URL },
      },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: { redisUrl: LOCKING_REDIS_URL, namespace: "sparky_lock:" },
          },
        ],
      },
    }
  )
}

// --- File storage -----------------------------------------------------------
if (FILE_PROVIDER === "s3") {
  modules.push({
    resolve: "@medusajs/medusa/file",
    options: {
      providers: [
        {
          resolve: "@medusajs/medusa/file-s3",
          id: "s3",
          options: {
            file_url: readEnv("S3_FILE_URL"),
            access_key_id: readEnv("S3_ACCESS_KEY_ID"),
            secret_access_key: readEnv("S3_SECRET_ACCESS_KEY"),
            region: readEnv("S3_REGION"),
            bucket: readEnv("S3_BUCKET"),
            endpoint: readEnv("S3_ENDPOINT"),
            prefix: readEnv("S3_PREFIX") ?? "media/",
            // OCI Object Storage grants public read at the bucket level and
            // does not need per-object ACL headers; S3_DISABLE_ACL=true omits them.
            ...(readEnv("S3_DISABLE_ACL") === "true" ? { acl: false } : {}),
            additional_client_config: {
              // OCI / R2 / MinIO need path-style addressing.
              forcePathStyle: readEnv("S3_FORCE_PATH_STYLE") !== "false",
              // AWS SDK v3 >= 3.729 sends CRC32 checksums by default, which
              // several S3-compatible providers (incl. OCI) reject.
              requestChecksumCalculation: "WHEN_REQUIRED",
              responseChecksumValidation: "WHEN_REQUIRED",
            },
          },
        },
      ],
    },
  })
}

// --- Payments ---------------------------------------------------------------
const paymentProviders: Record<string, unknown>[] = []
if (readEnv("RAZORPAY_KEY_ID") && readEnv("RAZORPAY_KEY_SECRET")) {
  paymentProviders.push({
    resolve: "./src/modules/razorpay",
    id: "razorpay",
    options: {
      key_id: readEnv("RAZORPAY_KEY_ID"),
      key_secret: readEnv("RAZORPAY_KEY_SECRET"),
      webhook_secret: readEnv("RAZORPAY_WEBHOOK_SECRET"),
      // Test-only override (validateBackendEnv rejects it in production).
      api_base: readEnv("RAZORPAY_API_BASE"),
      merchant_name: readEnv("STORE_NAME") ?? "Sparky 3D Craft Co",
    },
  })
}
if (readEnv("COD_ENABLED") === "true") {
  paymentProviders.push({
    resolve: "./src/modules/cod",
    id: "cod",
    options: {},
  })
}
if (paymentProviders.length) {
  modules.push({
    resolve: "@medusajs/medusa/payment",
    options: { providers: paymentProviders },
  })
}

// --- Notifications (transactional email) ------------------------------------
if (readEnv("SMTP_HOST")) {
  modules.push({
    resolve: "@medusajs/medusa/notification",
    options: {
      providers: [
        {
          resolve: "./src/modules/smtp-notification",
          id: "smtp",
          options: {
            channels: ["email"],
            host: readEnv("SMTP_HOST"),
            port: Number(readEnv("SMTP_PORT") ?? 587),
            secure: readEnv("SMTP_SECURE") === "true",
            user: readEnv("SMTP_USER"),
            pass: readEnv("SMTP_PASS"),
            from: readEnv("SMTP_FROM"),
            require_tls: readEnv("SMTP_INSECURE_NO_TLS") !== "true",
          },
        },
      ],
    },
  })
}

// --- Project custom module: Shopify source-ID mapping + webhook ledger -------
modules.push({ resolve: "./src/modules/sparky" })

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: {
      pool: {
        // Server and worker each hold their own pool; PostgreSQL is tuned
        // for max_connections=100 (deploy/postgres/). 2 procs x 10 = 20.
        min: 2,
        max: Number(readEnv("DB_POOL_MAX") ?? 10),
        idleTimeoutMillis: 30000,
      },
    },
    redisUrl: REDIS_URL,
    workerMode,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      // In production these are validated as present and strong above.
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    disable: readEnv("DISABLE_MEDUSA_ADMIN") === "true" || workerMode === "worker",
    backendUrl: readEnv("MEDUSA_BACKEND_URL"),
    storefrontUrl: readEnv("STOREFRONT_URL"),
    // Product photos from the merchant are typically 1–8 MB.
    maxUploadFileSize: 10 * 1024 * 1024,
  },
  modules,
})

