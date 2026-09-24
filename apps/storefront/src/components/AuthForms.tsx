"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition } from "react"
import { login, register, requestPasswordReset, resetPassword } from "@/lib/data/customer"

function safeNext(n: string | null): string {
  // only same-site relative paths (prevents open redirects)
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/account"
}

export function LoginForm() {
  const router = useRouter()
  const sp = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        setError(null)
        start(async () => {
          const res = await login({ email: String(fd.get("email")), password: String(fd.get("password")) })
          if (!res.ok) return setError(res.error)
          window.dispatchEvent(new CustomEvent("cart:updated"))
          router.replace(safeNext(sp.get("next")))
          router.refresh()
        })
      }}
    >
      <div className="field">
        <label htmlFor="login-email">Email</label>
        <input id="login-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="login-password">Password</label>
        <input id="login-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <p>
        <Link href="/forgot-password" className="link">Forgot your password?</Link>
      </p>
      <div aria-live="assertive">{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
      <button className="button" type="submit" disabled={pending} data-testid="login-submit">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p>
        <Link href="/register" className="link">Create account</Link>
      </p>
    </form>
  )
}

export function RegisterForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        setError(null)
        start(async () => {
          const res = await register({
            first_name: String(fd.get("first_name")),
            last_name: String(fd.get("last_name")),
            email: String(fd.get("email")),
            password: String(fd.get("password")),
            phone: String(fd.get("phone") ?? ""),
          })
          if (!res.ok) return setError(res.error)
          router.replace("/account")
          router.refresh()
        })
      }}
    >
      <div className="field-row">
        <div className="field">
          <label htmlFor="reg-first">First name</label>
          <input id="reg-first" name="first_name" autoComplete="given-name" required />
        </div>
        <div className="field">
          <label htmlFor="reg-last">Last name</label>
          <input id="reg-last" name="last_name" autoComplete="family-name" required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="reg-email">Email</label>
        <input id="reg-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="reg-phone">Mobile number (optional)</label>
        <input id="reg-phone" name="phone" type="tel" autoComplete="tel" />
      </div>
      <div className="field">
        <label htmlFor="reg-password">Password (min. 8 characters)</label>
        <input id="reg-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div aria-live="assertive">{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
      <button className="button" type="submit" disabled={pending} data-testid="register-submit">
        {pending ? "Creating…" : "Create"}
      </button>
    </form>
  )
}

export function ForgotForm() {
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (done) {
    return <p className="form-success" role="status">If an account exists for that email, we&apos;ve sent a link to reset your password. The link expires in 15 minutes.</p>
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        setError(null)
        start(async () => {
          const res = await requestPasswordReset(String(fd.get("email")))
          if (!res.ok) return setError(res.error)
          setDone(true)
        })
      }}
    >
      <div className="field">
        <label htmlFor="fp-email">Email</label>
        <input id="fp-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div aria-live="assertive">{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
      <button className="button" type="submit" disabled={pending}>Submit</button>
      <p><Link href="/login" className="link">Cancel</Link></p>
    </form>
  )
}

export function ResetForm({ token, email }: { token: string; email: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        const pw = String(fd.get("password"))
        if (pw !== String(fd.get("confirm"))) return setError("Passwords do not match")
        setError(null)
        start(async () => {
          const res = await resetPassword({ token, email, password: pw })
          if (!res.ok) return setError(res.error)
          router.replace("/login?reset=1")
        })
      }}
    >
      <p>Set a new password for {email}.</p>
      <div className="field">
        <label htmlFor="rp-password">New password (min. 8 characters)</label>
        <input id="rp-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="field">
        <label htmlFor="rp-confirm">Confirm password</label>
        <input id="rp-confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div aria-live="assertive">{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
      <button className="button" type="submit" disabled={pending}>Reset password</button>
    </form>
  )
}
