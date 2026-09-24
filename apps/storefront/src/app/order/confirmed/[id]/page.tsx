import Link from "next/link"
import { notFound } from "next/navigation"
import { OrderDetails } from "@/components/OrderDetails"
import { getOrderForViewer } from "@/lib/data/customer"
import { pageMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
export const metadata = pageMetadata({ title: "Order confirmed", path: "/order/confirmed", noindex: true })

export default async function OrderConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await getOrderForViewer(id)
  if (!order) notFound()
  return (
    <div className="page-width section" data-testid="order-confirmed">
      <h1>Thank you for your order!</h1>
      <p>
        Order <strong data-testid="order-number">#{order.display_id}</strong> has been placed. A confirmation will be sent to {order.email}.
      </p>
      <OrderDetails order={order} />
      <p style={{ marginTop: 32 }}>
        <Link href="/catalog" className="button">Continue shopping</Link>
      </p>
    </div>
  )
}
