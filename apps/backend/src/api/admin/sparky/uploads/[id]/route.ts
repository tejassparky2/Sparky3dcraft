import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SPARKY_MODULE } from "../../../../../modules/sparky"
import type SparkyModuleService from "../../../../../modules/sparky/service"
import { getPrivate } from "../../../../../lib/private-storage"

/** GET /admin/sparky/uploads/:id — admin-only download of a customer photo. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sparky = req.scope.resolve<SparkyModuleService>(SPARKY_MODULE)
  const [u] = await sparky.listCustomerUploads({ id: req.params.id })
  if (!u || u.status === "deleted") throw new MedusaError(MedusaError.Types.NOT_FOUND, "Upload not found")
  const body = await getPrivate({ storage: u.storage as "local" | "s3", key: u.key })
  res.setHeader("Content-Type", u.mime)
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Cache-Control", "private, no-store")
  const disposition = req.query.download ? "attachment" : "inline"
  res.setHeader("Content-Disposition", `${disposition}; filename="${u.filename.replace(/"/g, "")}"`)
  if (Buffer.isBuffer(body)) return res.end(body)
  ;(body as any).pipe(res)
}
