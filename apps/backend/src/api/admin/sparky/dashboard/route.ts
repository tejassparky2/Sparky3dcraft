import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * GET /admin/sparky/dashboard — merchant overview computed from live data.
 * /admin/* routes require an authenticated admin user (Medusa default).
 * Nothing is estimated: figures are sums/counts of stored records.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const inventory = req.scope.resolve(Modules.INVENTORY)
  const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365)
  const lowStockThreshold = Math.max(Number(process.env.LOW_STOCK_THRESHOLD ?? 3) || 3, 0)
  const since = new Date(Date.now() - days * 86400_000)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "status", "email", "currency_code", "total", "created_at", "metadata", "payment_status", "fulfillment_status"],
    filters: { created_at: { $gte: since } },
    pagination: { take: 1000, order: { created_at: "DESC" } },
  })
  const live = (orders as any[]).filter((o) => !o.metadata?.historical)
  const revenue: Record<string, number> = {}
  let canceled = 0
  for (const o of live) {
    if (o.status === "canceled") {
      canceled++
      continue
    }
    revenue[o.currency_code] = (revenue[o.currency_code] ?? 0) + Number(o.total ?? 0)
  }

  const { data: recent } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "status", "email", "currency_code", "total", "created_at", "metadata", "payment_status", "fulfillment_status"],
    pagination: { take: 10, order: { created_at: "DESC" } },
  })

  const { data: products } = await query.graph({ entity: "product", fields: ["id", "status"], pagination: { take: 5000 } })
  const productCounts: Record<string, number> = {}
  for (const p of products as any[]) productCounts[p.status] = (productCounts[p.status] ?? 0) + 1

  const levels = await inventory.listInventoryLevels({}, { take: 5000 } as any)
  const low = (levels as any[]).filter((l) => Number(l.stocked_quantity) - Number(l.reserved_quantity) <= lowStockThreshold)
  let lowStock: any[] = []
  if (low.length) {
    const { data: items } = await query.graph({
      entity: "inventory_item",
      fields: ["id", "sku", "title", "variants.id", "variants.title", "variants.product.title", "variants.product.id"],
      filters: { id: low.map((l) => l.inventory_item_id) },
    })
    const byId = new Map((items as any[]).map((i) => [i.id, i]))
    lowStock = low.map((l) => {
      const it = byId.get(l.inventory_item_id)
      const v = it?.variants?.[0]
      return {
        inventory_item_id: l.inventory_item_id,
        product_id: v?.product?.id ?? null,
        product_title: v?.product?.title ?? it?.title ?? null,
        variant_title: v?.title ?? null,
        sku: it?.sku ?? null,
        available: Number(l.stocked_quantity) - Number(l.reserved_quantity),
        stocked: Number(l.stocked_quantity),
        reserved: Number(l.reserved_quantity),
      }
    })
  }

  res.json({
    window_days: days,
    orders: { count: live.length, canceled, historical_migrated_in_window: (orders as any[]).length - live.length },
    revenue_by_currency: revenue,
    recent_orders: (recent as any[]).map((o) => ({
      id: o.id,
      display_id: o.display_id,
      status: o.status,
      payment_status: o.payment_status ?? null,
      fulfillment_status: o.fulfillment_status ?? null,
      email: o.email,
      currency_code: o.currency_code,
      total: Number(o.total ?? 0),
      created_at: o.created_at,
      historical: !!o.metadata?.historical,
    })),
    products: { total: (products as any[]).length, by_status: productCounts },
    low_stock: { threshold: lowStockThreshold, items: lowStock },
    generated_at: new Date().toISOString(),
  })
}
