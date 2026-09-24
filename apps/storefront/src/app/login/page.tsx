import { Suspense } from "react"
import { redirect } from "next/navigation"
import { LoginForm } from "@/components/AuthForms"
import { getCustomer } from "@/lib/data/customer"
import { pageMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
export const metadata = pageMetadata({ title: "Account", path: "/login" })

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (await getCustomer()) redirect("/account")
  const { reset } = await searchParams
  return (
    <div className="page-width section" style={{ maxWidth: 520 }}>
      <h1 className="center">Login</h1>
      {reset ? <p className="form-success" role="status">Your password has been updated. Please sign in.</p> : null}
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
