import { redirect } from "next/navigation"
import { CheckoutClient } from "@/components/CheckoutClient"
import { OrderSummary } from "@/components/OrderSummary"
import { listPaymentProviders, listShippingOptions, retrieveCart } from "@/lib/data/cart"
import { getCustomer } from "@/lib/data/customer"
import { pageMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
export const metadata = pageMetadata({ title: "Checkout", path: "/checkout", noindex: true })

export default async function CheckoutPage() {
  const cart = await retrieveCart()
  if (!cart?.items?.length) redirect("/cart")
  const [customer, providers] = await Promise.all([getCustomer(), listPaymentProviders()])
  const hasAddress = !!cart.shipping_address?.address_1 && !!cart.email
  const shippingOptions = hasAddress ? await listShippingOptions() : []
  const a = cart.shipping_address
  const defaultAddr = customer?.addresses?.find((x) => x.is_default_shipping) ?? customer?.addresses?.[0]
  const src = a?.address_1 ? a : defaultAddr
  return (
    <div className="page-width section">
      <h1>Checkout</h1>
      <div className="checkout">
        <CheckoutClient
          email={cart.email ?? customer?.email ?? ""}
          address={{
            first_name: src?.first_name ?? customer?.first_name ?? "",
            last_name: src?.last_name ?? customer?.last_name ?? "",
            address_1: src?.address_1 ?? "",
            address_2: src?.address_2 ?? "",
            city: src?.city ?? "",
            province: src?.province ?? "",
            postal_code: src?.postal_code ?? "",
            phone: src?.phone ?? customer?.phone ?? "",
            company: src?.company ?? "",
          }}
          addressSaved={hasAddress}
          shippingOptions={shippingOptions}
          selectedShippingOptionId={cart.shipping_methods?.[0]?.shipping_option_id ?? null}
          providers={providers}
          loggedIn={!!customer}
          currency={cart.currency_code}
        />
        <OrderSummary cart={cart} />
      </div>
    </div>
  )
}
