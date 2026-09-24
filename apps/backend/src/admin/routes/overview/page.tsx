import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { sdk } from "../../lib/sdk"

type Dashboard = {
  window_days: number
  orders: { count: number; canceled: number; historical_migrated_in_window: number }
  revenue_by_currency: Record<string, number>
  recent_orders: {
    id: string
    display_id: number
    status: string
    payment_status: string | null
    email: string
    currency_code: string
    total: number
    created_at: string
    historical: boolean
  }[]
  products: { total: number; by_status: Record<string, number> }
  low_stock: {
    threshold: number
    items: { inventory_item_id: string; product_id: string | null; product_title: string | null; variant_title: string | null; sku: string | null; available: number }[]
  }
  generated_at: string
}

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency.toUpperCase() }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`
  }
}

const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <Container className="flex flex-col gap-y-1 p-4">
    <Text size="small" className="text-ui-fg-subtle">{label}</Text>
    <Heading level="h2">{value}</Heading>
    {hint ? <Text size="xsmall" className="text-ui-fg-muted">{hint}</Text> : null}
  </Container>
)

const OverviewPage = () => {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    sdk.client
      .fetch<Dashboard>("/admin/sparky/dashboard", { query: { days: 30 } })
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed to load"))
  }, [])

  if (error) {
    return (
      <Container>
        <Heading>Store overview</Heading>
        <Text className="text-ui-fg-error">{error}</Text>
      </Container>
    )
  }
  if (!data) {
    return (
      <Container>
        <Text>Loading…</Text>
      </Container>
    )
  }
  const revenue = Object.entries(data.revenue_by_currency)
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex items-center justify-between">
        <Heading>Store overview</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Last {data.window_days} days · generated {new Date(data.generated_at).toLocaleString()}
        </Text>
      </Container>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Stat label="Orders" value={data.orders.count} hint={`${data.orders.canceled} canceled`} />
        <Stat
          label="Revenue (non-canceled orders)"
          value={revenue.length ? revenue.map(([c, a]) => money(a, c)).join(" · ") : "—"}
          hint="Order totals incl. COD orders not yet collected"
        />
        <Stat label="Products" value={data.products.total} hint={Object.entries(data.products.by_status).map(([s, n]) => `${n} ${s}`).join(", ")} />
        <Stat label="Low stock" value={data.low_stock.items.length} hint={`available ≤ ${data.low_stock.threshold} (tracked items only)`} />
      </div>
      <Container className="p-0">
        <div className="px-6 py-4"><Heading level="h2">Recent orders</Heading></div>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Customer</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Payment</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Total</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.recent_orders.map((o) => (
              <Table.Row key={o.id}>
                <Table.Cell><Link to={`/orders/${o.id}`}>#{o.display_id}</Link>{o.historical ? <Badge size="2xsmall" className="ml-2">Shopify</Badge> : null}</Table.Cell>
                <Table.Cell>{new Date(o.created_at).toLocaleString()}</Table.Cell>
                <Table.Cell>{o.email}</Table.Cell>
                <Table.Cell>{o.status}</Table.Cell>
                <Table.Cell>{o.payment_status ?? "—"}</Table.Cell>
                <Table.Cell className="text-right">{money(o.total, o.currency_code)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {!data.recent_orders.length ? <div className="px-6 py-4"><Text>No orders yet.</Text></div> : null}
      </Container>
      <Container className="p-0">
        <div className="px-6 py-4"><Heading level="h2">Low stock</Heading></div>
        {data.low_stock.items.length ? (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Product</Table.HeaderCell>
                <Table.HeaderCell>Variant</Table.HeaderCell>
                <Table.HeaderCell>SKU</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Available</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.low_stock.items.map((i) => (
                <Table.Row key={i.inventory_item_id}>
                  <Table.Cell>{i.product_id ? <Link to={`/products/${i.product_id}`}>{i.product_title}</Link> : i.product_title}</Table.Cell>
                  <Table.Cell>{i.variant_title ?? "—"}</Table.Cell>
                  <Table.Cell>{i.sku ?? "—"}</Table.Cell>
                  <Table.Cell className="text-right">{i.available}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        ) : (
          <div className="px-6 pb-4"><Text>No tracked inventory at or below the threshold.</Text></div>
        )}
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Store overview",
  icon: ChartBar,
})

export default OverviewPage
