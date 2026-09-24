import Link from "next/link"
import { logout } from "@/lib/data/customer"
import { redirect } from "next/navigation"

async function doLogout() {
  "use server"
  await logout()
  redirect("/")
}

export function AccountNav() {
  return (
    <nav className="account-nav" aria-label="Account">
      <Link className="link" href="/account">Overview</Link>
      <Link className="link" href="/account/orders">Orders</Link>
      <Link className="link" href="/account/addresses">Addresses</Link>
      <form action={doLogout}>
        <button className="link" type="submit" data-testid="logout">Log out</button>
      </form>
    </nav>
  )
}
