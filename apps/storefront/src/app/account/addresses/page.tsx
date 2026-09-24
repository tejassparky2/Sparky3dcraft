import { redirect } from "next/navigation"
import { AccountNav } from "@/components/AccountNav"
import { AddressBook } from "@/components/AccountForms"
import { getCustomer } from "@/lib/data/customer"
import { pageMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
export const metadata = pageMetadata({ title: "Addresses", path: "/account/addresses", noindex: true })

export default async function AddressesPage() {
  const customer = await getCustomer()
  if (!customer) redirect("/login?next=/account/addresses")
  return (
    <div className="page-width section">
      <h1>Addresses</h1>
      <AccountNav />
      <AddressBook
        addresses={(customer.addresses ?? []).map((a) => ({
          id: a.id,
          line: [`${a.first_name ?? ""} ${a.last_name ?? ""}`.trim(), a.address_1, a.address_2, a.city, a.province, a.postal_code, a.phone].filter(Boolean).join(", "),
        }))}
      />
    </div>
  )
}
