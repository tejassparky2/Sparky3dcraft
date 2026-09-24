import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { parsePersonalization, validatePersonalization } from "./personalization"
import { SPARKY_MODULE } from "../modules/sparky"
import type SparkyModuleService from "../modules/sparky/service"

function setMetadata(req: MedusaRequest, metadata: Record<string, string> | undefined) {
  for (const target of [req.body as any, (req as any).validatedBody]) {
    if (!target || typeof target !== "object") continue
    if (metadata && Object.keys(metadata).length) target.metadata = metadata
    else delete target.metadata
  }
}

/**
 * POST /store/carts/:id/line-items — server-side enforcement of product
 * personalization (required photo / choice). Only validated keys are stored
 * on the line item; anything else the client sent in metadata is dropped.
 */
export async function enforcePersonalizationOnAdd(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  try {
    const body = ((req as any).validatedBody ?? req.body) as any
    const variantId = body?.variant_id
    if (!variantId || typeof variantId !== "string") return next()
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "product.id", "product.metadata"],
      filters: { id: variantId },
    })
    const cfg = parsePersonalization((data[0] as any)?.product?.metadata)
    const result = validatePersonalization(cfg, body.metadata)
    if (!result.ok) {
      return res.status(400).json({ type: "invalid_data", message: result.errors.join(". ") })
    }
    const meta = { ...result.metadata }
    if (meta.photo_upload_id) {
      const sparky = req.scope.resolve<SparkyModuleService>(SPARKY_MODULE)
      const [upload] = await sparky.listCustomerUploads({ id: meta.photo_upload_id })
      if (!upload || upload.status === "deleted") {
        return res.status(400).json({ type: "invalid_data", message: "The uploaded photo was not found. Please upload it again." })
      }
      meta.photo_filename = upload.filename
      if (!upload.cart_id) await sparky.updateCustomerUploads({ id: upload.id, cart_id: req.params.id })
    }
    setMetadata(req, meta)
    next()
  } catch (e) {
    next(e)
  }
}

/** Line-item updates may change quantity only; personalization is immutable once added. */
export function stripLineItemMetadataOnUpdate(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  setMetadata(req, undefined)
  next()
}
