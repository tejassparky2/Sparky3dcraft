"use client"

import { useState } from "react"
import { ArrowIcon } from "./icons"
import { publicConfig } from "@/lib/public-config"

export function NewsletterForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle")
  const [error, setError] = useState("")
  return (
    <form
      className="newsletter__form"
      onSubmit={async (e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        setState("sending")
        try {
          const res = await fetch(`${publicConfig.medusaUrl}/store/sparky/newsletter`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-publishable-api-key": publicConfig.publishableKey },
            body: JSON.stringify({ email: fd.get("email"), company: fd.get("company") }),
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d.message || "Please enter a valid email address")
          }
          setState("done")
        } catch (err) {
          setError(err instanceof TypeError ? "Could not reach the store. Check your connection and try again." : (err as Error).message)
          setState("error")
        }
      }}
    >
      <label htmlFor="newsletter-email" className="visually-hidden">Email</label>
      <input id="newsletter-email" type="email" name="email" placeholder="Email" required autoComplete="email" maxLength={254} />
      <input className="honeypot" tabIndex={-1} aria-hidden="true" name="company" autoComplete="off" />
      <button type="submit" aria-label="Subscribe" disabled={state === "sending"}>
        <ArrowIcon />
      </button>
      <div aria-live="polite" style={{ marginTop: 12, fontSize: 14 }}>
        {state === "done" ? "Thanks for subscribing" : state === "error" ? error : null}
      </div>
    </form>
  )
}
