"use client"

import { useState } from "react"

export function ShareButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="link"
      style={{ marginTop: 16 }}
      onClick={async () => {
        try {
          if (navigator.share) await navigator.share({ title, url })
          else {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }
        } catch {
          /* user cancelled */
        }
      }}
    >
      {copied ? "Link copied to clipboard" : "Share"}
    </button>
  )
}
