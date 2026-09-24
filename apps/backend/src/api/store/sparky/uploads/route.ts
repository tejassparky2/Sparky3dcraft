import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import crypto from "node:crypto"
import { z } from "@medusajs/framework/zod"
import { SPARKY_MODULE } from "../../../../modules/sparky"
import type SparkyModuleService from "../../../../modules/sparky/service"
import { MAX_UPLOAD_BYTES, sniffUpload } from "../../../../lib/personalization"
import { putPrivate } from "../../../../lib/private-storage"

export const UploadBody = z.object({
  filename: z.string().max(200),
  content_base64: z.string().min(16).max(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 16),
})

/**
 * POST /store/sparky/uploads — customer photo for a personalized product.
 * Type is sniffed from bytes; the client-declared type is ignored. The file
 * goes to PRIVATE storage and is only retrievable by admins.
 */
export async function POST(req: MedusaRequest<z.infer<typeof UploadBody>>, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = UploadBody.parse(req.body)
  const buf = Buffer.from(body.content_base64, "base64")
  if (!buf.length || buf.length > MAX_UPLOAD_BYTES) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Photo must be smaller than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)
  }
  const kind = sniffUpload(buf)
  if (!kind) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Please upload a JPG, PNG, WEBP or HEIC photo")
  }
  const filename =
    body.filename
      .split(/[\\/]/)
      .pop()!
      .replace(/[^\w.\- ()]/g, "_")
      .slice(0, 100) || `photo.${kind.ext}`
  const now = new Date()
  const key = `personalization/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${kind.ext}`
  const stored = await putPrivate(key, buf, kind.mime)
  const sparky = req.scope.resolve<SparkyModuleService>(SPARKY_MODULE)
  const rec = await sparky.createCustomerUploads({
    storage: stored.storage,
    key: stored.key,
    filename,
    mime: kind.mime,
    size: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    status: "pending",
  })
  logger.info(`[uploads] stored personalization upload ${rec.id} (${kind.mime}, ${buf.length} bytes)`)
  res.status(201).json({ upload: { id: rec.id, filename, size: buf.length, mime: kind.mime } })
}
