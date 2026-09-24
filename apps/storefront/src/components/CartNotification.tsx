"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef } from "react"
import { CheckIcon, CloseIcon } from "./icons"

export type AddedItem = { title: string; thumbnail: string | null; detail?: string | null }

/** "Item added to your cart" popup, like the live theme's cart-notification. */
export function CartNotification({ item, onClose }: { item: AddedItem; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="cart-notification" role="dialog" aria-label="Item added to your cart" tabIndex={-1} ref={ref} data-testid="cart-notification">
      <div className="cart-notification__heading">
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <CheckIcon /> Item added to your cart
        </span>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        {item.thumbnail ? <Image src={item.thumbnail} alt="" width={70} height={70} style={{ borderRadius: 6, objectFit: "cover" }} /> : null}
        <div>
          <div style={{ fontFamily: "var(--font-heading)", color: "rgb(var(--fg))" }}>{item.title}</div>
          {item.detail ? <div className="caption">{item.detail}</div> : null}
        </div>
      </div>
      <div className="cart-notification__links">
        <Link href="/cart" className="button button--secondary button--full" onClick={onClose}>
          View cart
        </Link>
        <Link href="/checkout" className="button button--full" onClick={onClose}>
          Check out
        </Link>
        <button type="button" className="link" onClick={onClose}>
          Continue shopping
        </button>
      </div>
    </div>
  )
}
