import Link from "next/link"
import { ResetForm } from "@/components/AuthForms"
import { pageMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
// no-referrer: the reset token is in the URL and must not leak to third parties
export const metadata = { ...pageMetadata({ title: "Set a new password", path: "/reset-password", noindex: true }), referrer: "no-referrer" as const }

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; email?: string }> }) {
  const { token, email } = await searchParams
  return (
    <div className="page-width section" style={{ maxWidth: 520 }}>
      <h1 className="center">Set a new password</h1>
      {token && email ? (
        <ResetForm token={token} email={email} />
      ) : (
        <p>
          This link is incomplete. <Link className="link" href="/forgot-password">Request a new reset link</Link>.
        </p>
      )}
    </div>
  )
}
