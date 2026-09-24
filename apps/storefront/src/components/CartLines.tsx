"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { updateLineItem } from "@/lib/data/cart"
import { formatMoney } from "@/lib/money"
import { MinusIcon, PlusIcon } from "./icons"

type Line = {
  id: string
  title: string
  handle: string | null
  variantTitle: string | null
  thumbnail: string | null
  unitPrice: number
  compareAt: number | null
  quantity: number
  total: number
  metadata: Record<string, string>
}

export function CartLines({ items, currency }: { items: Line[]; currency: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const change = (id: string, qty: number) => {
    setBusy(id)
    setError(null)
    start(async () => {
      const res = await updateLineItem(id, qty)
      if (!res.ok) setError(res.error)
      window.dispatchEvent(new CustomEvent("cart:updated"))
      router.refresh()
      setBusy(null)
    })
  }

  return (
    <>
      <div aria-live="polite">{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
      <table className="cart-table" aria-busy={pending}>
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th style={{ textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} data-testid="cart-line">
              <td>
                <div className="cart-item">
                  {i.thumbnail ? <Image src={i.thumbnail} alt="" width={100} height={100} /> : null}
                  <div>
                    {i.handle ? (
                      <Link href={`/products/${i.handle}`} style={{ fontFamily: "var(--font-heading)", color: "rgb(var(--fg))", textDecoration: "none" }}>
                        {i.title}
                      </Link>
                    ) : (
                      <span>{i.title}</span>
                    )}
                    <div className="caption">{formatMoney(i.unitPrice, currency)}</div>
                    {i.variantTitle ? <div className="caption">{i.variantTitle}</div> : null}
                    {i.metadata.choice_value ? (
                      <div className="caption">
                        {i.metadata.choice_name ?? "Option"}: {i.metadata.choice_value}
                      </div>
                    ) : null}
                    {i.metadata.photo_filename ? <div className="caption">Photo: {i.metadata.photo_filename}</div> : null}
                    {i.metadata.custom_text ? <div className="caption">Text: {i.metadata.custom_text}</div> : null}
                  </div>
                </div>
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="quantity">
                    <button type="button" aria-label={`Decrease quantity for ${i.title}`} disabled={busy === i.id || i.quantity <= 1} onClick={() => change(i.id, i.quantity - 1)}>
                      <MinusIcon />
                    </button>
                    <input aria-label={`Quantity for ${i.title}`} type="number" value={i.quantity} readOnly />
                    <button type="button" aria-label={`Increase quantity for ${i.title}`} disabled={busy === i.id} onClick={() => change(i.id, i.quantity + 1)}>
                      <PlusIcon />
                    </button>
                  </div>
                  <button type="button" className="link" disabled={busy === i.id} onClick={() => change(i.id, 0)} aria-label={`Remove ${i.title}`}>
                    Remove
                  </button>
                </div>
              </td>
              <td style={{ textAlign: "right" }}>{formatMoney(i.total, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
