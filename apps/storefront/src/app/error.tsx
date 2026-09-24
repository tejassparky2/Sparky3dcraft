"use client"

import Link from "next/link"

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page-width section center" role="alert">
      <h1>Something went wrong</h1>
      <p>We couldn&apos;t load this page. Please try again.</p>
      <p style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button className="button" onClick={() => reset()}>Try again</button>
        <Link href="/" className="button button--secondary">Home</Link>
      </p>
    </div>
  )
}
