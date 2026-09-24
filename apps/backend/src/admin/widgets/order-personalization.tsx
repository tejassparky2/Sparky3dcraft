import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Container, Heading, Text } from "@medusajs/ui"

/**
 * Shows customer personalization (uploaded photo, chosen option, custom
 * text) for each line item, so the order can be produced correctly.
 * Photos are served by the authenticated /admin/sparky/uploads/:id route.
 */
const OrderPersonalizationWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const items = (data.items ?? []).filter((i) => {
    const m = (i.metadata ?? {}) as Record<string, unknown>
    return m.photo_upload_id || m.choice_value || m.custom_text
  })
  if (!items.length) return <></>
  const backend = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? ""
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Personalization</Heading>
        <Text size="small" className="text-ui-fg-subtle">Customer inputs required to produce these items</Text>
      </div>
      {items.map((i) => {
        const m = (i.metadata ?? {}) as Record<string, string>
        const url = m.photo_upload_id ? `${backend}/admin/sparky/uploads/${encodeURIComponent(m.photo_upload_id)}` : null
        return (
          <div key={i.id} className="flex gap-4 px-6 py-4">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={`Customer photo for ${i.product_title ?? i.title}`} className="h-28 w-28 rounded-md border object-cover" />
              </a>
            ) : null}
            <div className="flex flex-col gap-1">
              <Text weight="plus">{i.product_title ?? i.title} × {i.quantity}</Text>
              {m.choice_value ? <Text size="small">{m.choice_name ?? "Option"}: <strong>{m.choice_value}</strong></Text> : null}
              {m.custom_text ? <Text size="small">Text: “{m.custom_text}”</Text> : null}
              {url ? (
                <Text size="small">
                  Photo: {m.photo_filename ?? "uploaded image"} · <a className="text-ui-fg-interactive" href={`${url}?download=1`}>Download original</a>
                </Text>
              ) : null}
            </div>
          </div>
        )
      })}
    </Container>
  )
}

export const config = defineWidgetConfig({ zone: "order.details.after" })

export default OrderPersonalizationWidget
