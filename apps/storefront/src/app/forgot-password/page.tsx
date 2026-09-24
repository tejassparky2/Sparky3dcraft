import { ForgotForm } from "@/components/AuthForms"
import { pageMetadata } from "@/lib/seo"

export const metadata = pageMetadata({ title: "Reset your password", path: "/forgot-password", noindex: true })

export default function ForgotPage() {
  return (
    <div className="page-width section" style={{ maxWidth: 520 }}>
      <h1 className="center">Reset your password</h1>
      <p className="center">We will send you an email to reset your password.</p>
      <ForgotForm />
    </div>
  )
}
