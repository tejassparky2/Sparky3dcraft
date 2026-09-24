import { notFound, redirect } from "next/navigation"
import { AccountNav } from "@/components/AccountNav"
import { OrderDetails } from "@/components/OrderDetails"
import { getCustomer, getOrderForViewer } from "@/lib/data/customer"
import { pageMetadata } from "@/lib/seo"
import { meta, ms } from "@/lib/meta"

export const dynamic = "force-dynamic"
export const metadata = pageMetadata({ title: "Order", path: "/account/orders", noindex: true })

export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await getCustomer())) redirect(`/login?next=/account/orders/${encodeURIComponent(id)}`)
  const order = await getOrderForViewer(id)
  if (!order) notFound()
  return (
    <div className="page-width section">
      <h1>Order #{order.display_id}</h1>
      <AccountNav />
      <p className="caption">
        Placed on {new Date(String(order.created_at)).toLocaleString("en-IN")} · Status: {order.status}
        {meta(order).historical === true ? ` · Previous store order ${ms(order, "shopify_order_name") ?? ""}` : ""}
      </p>
      <OrderDetails order={order} />
    </div>
  )
}
