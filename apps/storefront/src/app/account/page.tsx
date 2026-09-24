import { redirect } from "next/navigation"
import { AccountNav } from "@/components/AccountNav"
import { OrdersTable } from "@/components/OrdersTable"
import { ProfileForm } from "@/components/AccountForms"
import { getCustomer, listOrders } from "@/lib/data/customer"
import { pageMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
export const metadata = pageMetadata({ title: "Account", path: "/account", noindex: true })

export default async function AccountPage() {
  const customer = await getCustomer()
  if (!customer) redirect("/login?next=/account")
  const orders = (await listOrders()).slice(0, 5)
  return (
    <div className="page-width section">
      <h1>Account</h1>
      <AccountNav />
      <p data-testid="account-email">Signed in as {customer.email}</p>
      <h2>Recent orders</h2>
      <OrdersTable orders={orders} />
      <h2 style={{ marginTop: 40 }}>Profile</h2>
      <ProfileForm first_name={customer.first_name ?? ""} last_name={customer.last_name ?? ""} phone={customer.phone ?? ""} />
    </div>
  )
}
