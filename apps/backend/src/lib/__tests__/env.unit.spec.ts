import { isWeakSecret, validateBackendEnv } from "../env"

const strong = "a".repeat(10) + "Zq8#kP2@xL9!mN4$vB7%" + "c".repeat(10)
const base = {
  DATABASE_URL: "postgres://medusa:TEST-ONLY-fixture-not-a-secret@127.0.0.1:5432/medusa_db",
  REDIS_URL: "redis://127.0.0.1:6379/0",
  STORE_CORS: "https://sparky3dcraft.tech",
  ADMIN_CORS: "https://api.sparky3dcraft.tech",
  AUTH_CORS: "https://sparky3dcraft.tech,https://api.sparky3dcraft.tech",
  JWT_SECRET: strong,
  COOKIE_SECRET: strong + "x",
  MEDUSA_BACKEND_URL: "https://api.sparky3dcraft.tech",
  STOREFRONT_URL: "https://sparky3dcraft.tech",
  FILE_PROVIDER: "s3",
  S3_FILE_URL: "https://objectstorage.ap-mumbai-1.oraclecloud.com/n/ns/b/b/o",
  S3_BUCKET: "b",
  S3_REGION: "ap-mumbai-1",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_ENDPOINT: "https://ns.compat.objectstorage.ap-mumbai-1.oraclecloud.com",
}

describe("validateBackendEnv", () => {
  it("accepts a complete production config", () => {
    expect(validateBackendEnv(base, { production: true })).toEqual([])
  })
  it.each(["supersecret", "password", "123456", "short"])("rejects weak secret %s", (s) => {
    expect(isWeakSecret(s)).toBe(true)
    const p = validateBackendEnv({ ...base, JWT_SECRET: s }, { production: true })
    expect(p.map((x) => x.name)).toContain("JWT_SECRET")
  })
  it("requires Redis in production", () => {
    const { REDIS_URL, ...rest } = base
    expect(validateBackendEnv(rest, { production: true }).map((x) => x.name)).toContain("REDIS_URL")
  })
  it("rejects wildcard CORS and default DB passwords", () => {
    const p = validateBackendEnv({ ...base, STORE_CORS: "*", DATABASE_URL: "postgres://medusa:password@x/db" }, { production: true })
    expect(p.map((x) => x.name)).toEqual(expect.arrayContaining(["STORE_CORS", "DATABASE_URL"]))
  })
  it("requires S3 credentials when FILE_PROVIDER=s3", () => {
    const p = validateBackendEnv({ ...base, S3_SECRET_ACCESS_KEY: "" }, { production: true })
    expect(p.map((x) => x.name)).toContain("S3_SECRET_ACCESS_KEY")
  })
  it("forbids the Razorpay test API override in production", () => {
    expect(validateBackendEnv({ ...base, RAZORPAY_API_BASE: "http://x" }, { production: true }).map((x) => x.name)).toContain("RAZORPAY_API_BASE")
  })
  it("never includes secret values in problems", () => {
    const p = validateBackendEnv({ ...base, JWT_SECRET: "supersecret" }, { production: true })
    expect(JSON.stringify(p)).not.toContain("supersecret")
  })
})
