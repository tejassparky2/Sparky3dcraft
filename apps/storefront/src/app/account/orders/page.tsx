import { redirect } from "next/navigation"
import { AccountNav } from "@/components/AccountNav"
import { OrdersTable } from "@/components/OrdersTable"
import { getCustomer, listOrders } from "@/lib/data/customer"
import { pageMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
export const metadata = pageMetadata({ title: "Orders", path: "/account/orders", noindex: true })

export default async function OrdersPage() {
  if (!(await getCustomer())) redirect("/login?next=/account/orders")
  const orders = await listOrders()
  return (
    <div className="page-width section">
      <h1>Order history</h1>
      <AccountNav />
      <OrdersTable orders={orders} />
    </div>
  )
}
