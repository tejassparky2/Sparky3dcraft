"use client"

import { useState } from "react"
import { publicConfig } from "@/lib/public-config"

export function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [error, setError] = useState("")
  if (state === "sent") {
    return (
      <p className="form-success" role="status" data-testid="contact-success">
        Thanks for contacting us. We&apos;ll get back to you as soon as possible.
      </p>
    )
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        setState("sending")
        try {
          const res = await fetch(`${publicConfig.medusaUrl}/store/sparky/contact`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-publishable-api-key": publicConfig.publishableKey },
            body: JSON.stringify(Object.fromEntries(fd.entries())),
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d.message || "Could not send your message. Please try again.")
          }
          setState("sent")
        } catch (err) {
          setError(err instanceof TypeError ? "Could not reach the store. Check your connection and try again." : (err as Error).message)
          setState("error")
        }
      }}
    >
      <div className="field-row">
        <div className="field">
          <label htmlFor="ct-name">Name</label>
          <input id="ct-name" name="name" autoComplete="name" maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="ct-email">
            Email <span className="required" aria-hidden="true">*</span>
          </label>
          <input id="ct-email" name="email" type="email" autoComplete="email" required maxLength={254} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ct-phone">Phone number</label>
        <input id="ct-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} />
      </div>
      <div className="field">
        <label htmlFor="ct-comment">Comment</label>
        <textarea id="ct-comment" name="message" maxLength={5000} />
      </div>
      <input className="honeypot" tabIndex={-1} aria-hidden="true" name="company" autoComplete="off" />
      <div aria-live="assertive">{state === "error" ? <p className="form-error" role="alert">{error}</p> : null}</div>
      <button className="button" type="submit" disabled={state === "sending"} data-testid="contact-submit">
        {state === "sending" ? "Sending…" : "Send"}
      </button>
    </form>
  )
}
