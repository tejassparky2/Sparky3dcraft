import Link from "next/link"
import type { HttpTypes } from "@medusajs/types"
import { formatMoney } from "@/lib/money"
import { meta, ms } from "@/lib/meta"

const human = (s?: string | null) => (s ? s.replace(/_/g, " ") : "—")

export function OrdersTable({ orders }: { orders: HttpTypes.StoreOrder[] }) {
  if (!orders.length) return <p>You haven&apos;t placed any orders yet.</p>
  return (
    <table className="table" data-testid="orders-table">
      <thead>
        <tr>
          <th>Order</th>
          <th>Date</th>
          <th>Payment</th>
          <th>Fulfillment</th>
          <th style={{ textAlign: "right" }}>Total</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td>
              <Link className="link" href={`/account/orders/${o.id}`}>
                #{o.display_id}
              </Link>
              {meta(o).historical === true ? <div className="caption">{ms(o, "shopify_order_name") ?? ""} (previous store)</div> : null}
            </td>
            <td>{new Date(String(o.created_at)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
            <td>{meta(o).historical === true ? human(ms(o, "shopify_financial_status")?.toLowerCase()) : human(o.payment_status)}</td>
            <td>{meta(o).historical === true ? human(ms(o, "shopify_fulfillment_status")?.toLowerCase()) : human(o.fulfillment_status)}</td>
            <td style={{ textAlign: "right" }}>{formatMoney(o.total, o.currency_code)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
