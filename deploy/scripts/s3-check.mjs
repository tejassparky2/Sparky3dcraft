// Object-storage round trip used by install.sh (storage stage) and
// final-verification.sh. Run with cwd = apps/backend/.medusa/server so the
// AWS SDK resolves from the backend's node_modules. Prints no secrets.
import { createRequire } from "node:module"
const require = createRequire(process.cwd() + "/")
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3")

const env = (k) => (process.env[k] || "").trim()
const client = new S3Client({
  region: env("S3_REGION"),
  endpoint: env("S3_ENDPOINT"),
  forcePathStyle: env("S3_FORCE_PATH_STYLE") !== "false",
  credentials: { accessKeyId: env("S3_ACCESS_KEY_ID"), secretAccessKey: env("S3_SECRET_ACCESS_KEY") },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})
const body = `sparky storage check ${new Date().toISOString()}`
let failed = false
const step = async (name, fn) => {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failed = true
    console.log(`FAIL ${name}: ${e?.name ?? ""} ${e?.message ?? e}`)
  }
}

const key = `${env("S3_PREFIX") || "media/"}healthcheck/sparky-check-${Date.now()}.txt`
await step(`put public bucket ${env("S3_BUCKET")}`, () =>
  client.send(new PutObjectCommand({ Bucket: env("S3_BUCKET"), Key: key, Body: body, ContentType: "text/plain", CacheControl: "no-store" }))
)
await step("public URL serves the object", async () => {
  const url = `${env("S3_FILE_URL").replace(/\/$/, "")}/${key}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).origin} (bucket must allow public object reads)`)
  if ((await res.text()) !== body) throw new Error("content mismatch")
})
await step("delete test object", () => client.send(new DeleteObjectCommand({ Bucket: env("S3_BUCKET"), Key: key })))

if (env("S3_PRIVATE_BUCKET")) {
  const pkey = `sparky-check-${Date.now()}.txt`
  await step(`put private bucket ${env("S3_PRIVATE_BUCKET")}`, () => client.send(new PutObjectCommand({ Bucket: env("S3_PRIVATE_BUCKET"), Key: pkey, Body: body })))
  await step("get private object with credentials", async () => {
    const r = await client.send(new GetObjectCommand({ Bucket: env("S3_PRIVATE_BUCKET"), Key: pkey }))
    const t = await r.Body.transformToString()
    if (t !== body) throw new Error("content mismatch")
  })
  await step("private object is NOT readable anonymously", async () => {
    // Customer photos must never be public. Try the anonymous URL forms a
    // misconfigured bucket would serve: path-style endpoint, and (OCI) the
    // public-URL pattern with the private bucket name swapped in.
    const pub = env("S3_BUCKET"), priv = env("S3_PRIVATE_BUCKET")
    const urls = [`${env("S3_ENDPOINT").replace(/\/$/, "")}/${priv}/${pkey}`]
    const fileUrl = env("S3_FILE_URL").replace(/\/$/, "")
    if (fileUrl.includes(`/b/${pub}/`)) urls.push(`${fileUrl.replace(`/b/${pub}/`, `/b/${priv}/`)}/${pkey}`)
    else if (fileUrl.endsWith(`/${pub}`)) urls.push(`${fileUrl.slice(0, -pub.length)}${priv}/${pkey}`)
    for (const u of urls) {
      const res = await fetch(u, { signal: AbortSignal.timeout(15000) }).catch(() => undefined)
      if (res?.ok) throw new Error(`private bucket object is publicly readable at ${new URL(u).origin} — make bucket ${priv} private`)
    }
  })
  await step("delete private object", () => client.send(new DeleteObjectCommand({ Bucket: env("S3_PRIVATE_BUCKET"), Key: pkey })))
}
process.exit(failed ? 1 : 0)
