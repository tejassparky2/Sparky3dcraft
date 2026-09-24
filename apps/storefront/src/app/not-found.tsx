import Link from "next/link"

export default function NotFound() {
  return (
    <div className="page-width section center" data-testid="not-found">
      <p className="caption">404</p>
      <h1>Page not found</h1>
      <p>
        <Link href="/catalog" className="button">Continue shopping</Link>
      </p>
    </div>
  )
}
