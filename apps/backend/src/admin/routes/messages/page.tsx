import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Table, Text } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"
import { sdk } from "../../lib/sdk"

type Msg = { id: string; name: string | null; email: string; phone: string | null; message: string; status: string; created_at: string }
type Sub = { id: string; email: string; status: string; created_at: string }

const MessagesPage = () => {
  const [data, setData] = useState<{ messages: Msg[]; subscribers: Sub[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    sdk.client.fetch<{ messages: Msg[]; subscribers: Sub[] }>("/admin/sparky/messages").then(setData).catch((e) => setError(e?.message ?? "Failed"))
  }, [])
  useEffect(load, [load])
  const setStatus = async (id: string, status: string) => {
    await sdk.client.fetch("/admin/sparky/messages", { method: "POST", body: { id, status } })
    load()
  }
  const exportCsv = () => {
    if (!data) return
    const rows = [["email", "status", "subscribed_at"], ...data.subscribers.map((s) => [s.email, s.status, s.created_at])]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    a.download = "newsletter-subscribers.csv"
    a.click()
  }
  if (error) return <Container><Text className="text-ui-fg-error">{error}</Text></Container>
  if (!data) return <Container><Text>Loading…</Text></Container>
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0">
        <div className="px-6 py-4"><Heading>Contact messages</Heading></div>
        {data.messages.length ? (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Received</Table.HeaderCell>
                <Table.HeaderCell>From</Table.HeaderCell>
                <Table.HeaderCell>Message</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.messages.map((m) => (
                <Table.Row key={m.id}>
                  <Table.Cell>{new Date(m.created_at).toLocaleString()}</Table.Cell>
                  <Table.Cell>
                    <div>{m.name ?? "—"}</div>
                    <a className="text-ui-fg-interactive" href={`mailto:${m.email}`}>{m.email}</a>
                    {m.phone ? <div>{m.phone}</div> : null}
                  </Table.Cell>
                  <Table.Cell className="max-w-md whitespace-pre-wrap">{m.message}</Table.Cell>
                  <Table.Cell><Badge size="2xsmall">{m.status}</Badge></Table.Cell>
                  <Table.Cell>
                    {m.status === "new" ? <Button size="small" variant="secondary" onClick={() => setStatus(m.id, "read")}>Mark read</Button> : null}
                    {m.status !== "archived" ? <Button size="small" variant="transparent" onClick={() => setStatus(m.id, "archived")}>Archive</Button> : null}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        ) : (
          <div className="px-6 pb-4"><Text>No messages yet.</Text></div>
        )}
      </Container>
      <Container className="p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Newsletter subscribers ({data.subscribers.filter((s) => s.status === "subscribed").length})</Heading>
          <Button size="small" variant="secondary" onClick={exportCsv} disabled={!data.subscribers.length}>Export CSV</Button>
        </div>
        {data.subscribers.length ? (
          <Table>
            <Table.Body>
              {data.subscribers.map((s) => (
                <Table.Row key={s.id}>
                  <Table.Cell>{s.email}</Table.Cell>
                  <Table.Cell>{s.status}</Table.Cell>
                  <Table.Cell>{new Date(s.created_at).toLocaleDateString()}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        ) : (
          <div className="px-6 pb-4"><Text>No subscribers yet.</Text></div>
        )}
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Messages", icon: ChatBubbleLeftRight })

export default MessagesPage
