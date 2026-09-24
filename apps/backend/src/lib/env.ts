/**
 * Environment validation for the Sparky Medusa backend.
 *
 * Imported by medusa-config.ts. In production (NODE_ENV=production) any
 * missing or insecure value is a hard failure: we would rather refuse to boot
 * than run a store with forgeable sessions or an in-memory event bus.
 *
 * Never log values from this module — only variable NAMES.
 */

const WEAK_SECRETS = new Set([
  "supersecret",
  "secret",
  "password",
  "changeme",
  "change-me",
  "123456",
  "12345678",
  "test",
  "medusa",
])

export const isProduction = process.env.NODE_ENV === "production"

export function readEnv(name: string): string | undefined {
  const v = process.env[name]
  if (v === undefined) return undefined
  const trimmed = v.trim()
  return trimmed.length ? trimmed : undefined
}

export function isWeakSecret(value: string | undefined): boolean {
  if (!value) return true
  if (WEAK_SECRETS.has(value.toLowerCase())) return true
  // 32 bytes of entropy encoded as hex/base64 is >= 43 chars; demand >= 32.
  if (value.length < 32) return true
  if (/^(.)\1+$/.test(value)) return true
  return false
}

export type EnvProblem = { name: string; problem: string }

/**
 * Returns a list of problems; empty means OK. Pure so it can be unit tested
 * and reused by deploy/scripts/validate-env.
 */
export function validateBackendEnv(
  env: NodeJS.ProcessEnv,
  opts: { production: boolean }
): EnvProblem[] {
  const problems: EnvProblem[] = []
  const get = (n: string) => {
    const v = env[n]
    return v && v.trim().length ? v.trim() : undefined
  }
  const required = [
    "DATABASE_URL",
    "STORE_CORS",
    "ADMIN_CORS",
    "AUTH_CORS",
    "JWT_SECRET",
    "COOKIE_SECRET",
  ]
  if (opts.production) {
    required.push("REDIS_URL", "MEDUSA_BACKEND_URL", "STOREFRONT_URL")
  }
  for (const n of required) {
    if (!get(n)) problems.push({ name: n, problem: "missing" })
  }
  if (opts.production) {
    for (const n of ["JWT_SECRET", "COOKIE_SECRET"]) {
      const v = get(n)
      if (v && isWeakSecret(v)) {
        problems.push({ name: n, problem: "insecure (weak/default/too short, need >= 32 chars)" })
      }
    }
    const dbUrl = get("DATABASE_URL")
    if (dbUrl && /:(password|postgres|medusa|secret)@/i.test(dbUrl)) {
      problems.push({ name: "DATABASE_URL", problem: "uses a default/weak password" })
    }
    for (const n of ["STORE_CORS", "ADMIN_CORS", "AUTH_CORS"]) {
      const v = get(n)
      if (v && /(^|,)\s*\*\s*(,|$)/.test(v)) {
        problems.push({ name: n, problem: "wildcard CORS is not allowed in production" })
      }
    }
    const fileProvider = get("FILE_PROVIDER") ?? "s3"
    if (fileProvider === "s3") {
      for (const n of ["S3_FILE_URL", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"]) {
        if (!get(n)) problems.push({ name: n, problem: "missing (FILE_PROVIDER=s3)" })
      }
    } else if (fileProvider !== "local") {
      problems.push({ name: "FILE_PROVIDER", problem: "must be 's3' or 'local'" })
    }
    if (get("SMTP_INSECURE_NO_TLS") === "true") {
      problems.push({ name: "SMTP_INSECURE_NO_TLS", problem: "plaintext SMTP is only allowed for local tests" })
    }
    if (get("RAZORPAY_API_BASE")) {
      problems.push({
        name: "RAZORPAY_API_BASE",
        problem: "test-only override must not be set in production",
      })
    }
  }
  return problems
}
