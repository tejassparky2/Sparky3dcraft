import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SPARKY_MODULE } from "../modules/sparky"
import type SparkyModuleService from "../modules/sparky/service"

/** Marks personalization photos as belonging to the placed order (so cleanup never deletes them). */
export default async function attachUploads({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const sparky = container.resolve<SparkyModuleService>(SPARKY_MODULE)
  const { data: orders } = await query.graph({ entity: "order", fields: ["id", "items.metadata"], filters: { id: data.id } })
  const ids = ((orders[0] as any)?.items ?? []).map((i: any) => i.metadata?.photo_upload_id).filter(Boolean)
  for (const id of ids) {
    await sparky.updateCustomerUploads({ id, status: "attached", order_id: data.id })
  }
}

export const config: SubscriberConfig = { event: "order.placed", context: { subscriberId: "sparky-attach-uploads" } }
