"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { applyPromotion } from "@/lib/data/cart"

export function PromoCode({ applied }: { applied: string[] }) {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      style={{ display: "flex", gap: 8, margin: "12px 0" }}
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        start(async () => {
          const res = await applyPromotion(code)
          if (!res.ok) setError(res.error)
          else setCode("")
          router.refresh()
        })
      }}
    >
      <label htmlFor="promo" className="visually-hidden">Discount code</label>
      <input id="promo" className="input" placeholder="Discount code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={64} />
      <button className="button button--secondary" disabled={pending || !code.trim()} type="submit" style={{ padding: "0 16px" }}>
        Apply
      </button>
      <div aria-live="polite" style={{ position: "absolute", left: -9999 }}>{error}</div>
      {error ? <p className="form-error" style={{ position: "static" }}>{error}</p> : null}
      {applied.length ? <p className="caption">Applied: {applied.join(", ")}</p> : null}
    </form>
  )
}
