import { RegisterForm } from "@/components/AuthForms"
import { pageMetadata } from "@/lib/seo"

export const metadata = pageMetadata({ title: "Create Account", path: "/register" })

export default function RegisterPage() {
  return (
    <div className="page-width section" style={{ maxWidth: 620 }}>
      <h1 className="center">Create account</h1>
      <p className="caption center">
        Shopped with us before? Your account has moved to our new store — use “Forgot your password?” on the login page to set a password.
      </p>
      <RegisterForm />
    </div>
  )
}
