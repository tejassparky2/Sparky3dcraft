/**
 * Private storage for customer-uploaded personalization photos.
 *
 * These are personal data and must NOT live in the public product-media
 * bucket. Two backends:
 *  - s3:    S3_PRIVATE_BUCKET (private bucket, same credentials/endpoint as S3_*)
 *  - local: PRIVATE_UPLOADS_DIR (default /var/lib/sparky/private-uploads),
 *           mode 0700, included in deploy/backup.sh archives.
 * Files are only served through the authenticated admin route.
 */
import fs from "node:fs"
import path from "node:path"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import type { Readable } from "node:stream"

export type StoredObject = { storage: "local" | "s3"; key: string }

const env = (n: string) => (process.env[n] ?? "").trim() || undefined

export function privateStorageKind(): "local" | "s3" {
  return env("S3_PRIVATE_BUCKET") ? "s3" : "local"
}

function localDir(): string {
  const dir = env("PRIVATE_UPLOADS_DIR") ?? (process.env.NODE_ENV === "production" ? "/var/lib/sparky/private-uploads" : path.resolve("private-uploads"))
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

let client: S3Client | null = null
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env("S3_REGION"),
      endpoint: env("S3_ENDPOINT"),
      forcePathStyle: env("S3_FORCE_PATH_STYLE") !== "false",
      credentials: { accessKeyId: env("S3_ACCESS_KEY_ID")!, secretAccessKey: env("S3_SECRET_ACCESS_KEY")! },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    })
  }
  return client
}

/** Keys are server-generated (never from user input) → no path traversal. */
export function safeKey(key: string): string {
  if (!/^[a-z0-9][a-z0-9/_.-]{0,200}$/i.test(key) || key.includes("..")) throw new Error("invalid storage key")
  return key
}

export async function putPrivate(key: string, body: Buffer, mime: string): Promise<StoredObject> {
  safeKey(key)
  if (privateStorageKind() === "s3") {
    await s3().send(new PutObjectCommand({ Bucket: env("S3_PRIVATE_BUCKET"), Key: key, Body: body, ContentType: mime }))
    return { storage: "s3", key }
  }
  const file = path.join(localDir(), key)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, body, { mode: 0o600 })
  return { storage: "local", key }
}

export async function getPrivate(obj: StoredObject): Promise<Readable | Buffer> {
  safeKey(obj.key)
  if (obj.storage === "s3") {
    const res = await s3().send(new GetObjectCommand({ Bucket: env("S3_PRIVATE_BUCKET"), Key: obj.key }))
    return res.Body as Readable
  }
  return fs.readFileSync(path.join(localDir(), obj.key))
}

export async function deletePrivate(obj: StoredObject): Promise<void> {
  safeKey(obj.key)
  if (obj.storage === "s3") {
    await s3().send(new DeleteObjectCommand({ Bucket: env("S3_PRIVATE_BUCKET"), Key: obj.key }))
    return
  }
  fs.rmSync(path.join(localDir(), obj.key), { force: true })
}
