// Off-machine backup transport (S3-compatible, e.g. a PRIVATE OCI bucket).
// usage (cwd = apps/backend/.medusa/server):
//   node s3-backup.mjs put <localFile> <key>
//   node s3-backup.mjs get <key> <localFile>
//   node s3-backup.mjs list <prefix>
//   node s3-backup.mjs prune <prefix> <keepDays>
// Env: BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY
// (each falls back to the matching S3_* media storage value).
import fs from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(process.cwd() + "/")
const s3 = require("@aws-sdk/client-s3")
const e = (k) => (process.env[`BACKUP_${k}`] || process.env[k] || "").trim()
const client = new s3.S3Client({
  region: e("S3_REGION"),
  endpoint: e("S3_ENDPOINT"),
  forcePathStyle: true,
  credentials: { accessKeyId: e("S3_ACCESS_KEY_ID"), secretAccessKey: e("S3_SECRET_ACCESS_KEY") },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})
const Bucket = (process.env.BACKUP_S3_BUCKET || "").trim()
if (!Bucket) {
  console.error("BACKUP_S3_BUCKET not set")
  process.exit(2)
}
const [cmd, a, b] = process.argv.slice(2)
if (cmd === "put") {
  await client.send(new s3.PutObjectCommand({ Bucket, Key: b, Body: fs.readFileSync(a) }))
  const head = await client.send(new s3.HeadObjectCommand({ Bucket, Key: b }))
  if (head.ContentLength !== fs.statSync(a).size) throw new Error("size mismatch after upload")
  console.log(`uploaded ${b} (${head.ContentLength} bytes)`)
} else if (cmd === "get") {
  const r = await client.send(new s3.GetObjectCommand({ Bucket, Key: a }))
  fs.writeFileSync(b, Buffer.from(await r.Body.transformToByteArray()), { mode: 0o600 })
  console.log(`downloaded ${a}`)
} else if (cmd === "list" || cmd === "prune") {
  let token
  const items = []
  do {
    const r = await client.send(new s3.ListObjectsV2Command({ Bucket, Prefix: a, ContinuationToken: token }))
    items.push(...(r.Contents ?? []))
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  if (cmd === "list") for (const i of items) console.log(`${i.LastModified.toISOString()}\t${i.Size}\t${i.Key}`)
  else {
    const cutoff = Date.now() - Number(b) * 86400_000
    for (const i of items) if (i.LastModified.getTime() < cutoff) {
      await client.send(new s3.DeleteObjectCommand({ Bucket, Key: i.Key }))
      console.log(`pruned ${i.Key}`)
    }
  }
} else {
  console.error("unknown command")
  process.exit(2)
}
