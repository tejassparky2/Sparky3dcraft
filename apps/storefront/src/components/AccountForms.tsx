"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { addAddress, deleteAddress, updateProfile } from "@/lib/data/customer"
import { validateAddress, type AddressInput } from "@/lib/data/cart"
import { INDIAN_STATES } from "@/lib/india"

export function ProfileForm(p: { first_name: string; last_name: string; phone: string }) {
  const router = useRouter()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      style={{ maxWidth: 620 }}
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        start(async () => {
          const res = await updateProfile({ first_name: String(fd.get("first_name")), last_name: String(fd.get("last_name")), phone: String(fd.get("phone")) })
          setMsg(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error })
          router.refresh()
        })
      }}
    >
      <div className="field-row">
        <div className="field"><label htmlFor="pf-first">First name</label><input id="pf-first" name="first_name" defaultValue={p.first_name} required /></div>
        <div className="field"><label htmlFor="pf-last">Last name</label><input id="pf-last" name="last_name" defaultValue={p.last_name} required /></div>
      </div>
      <div className="field"><label htmlFor="pf-phone">Mobile number</label><input id="pf-phone" name="phone" type="tel" defaultValue={p.phone} /></div>
      <div aria-live="polite">{msg ? <p className={msg.ok ? "form-success" : "form-error"}>{msg.text}</p> : null}</div>
      <button className="button button--secondary" disabled={pending}>Save</button>
    </form>
  )
}

export function AddressBook({ addresses }: { addresses: { id: string; line: string }[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div>
      {addresses.length ? (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {addresses.map((a) => (
            <li key={a.id} className="notice" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{a.line}</span>
              <button className="link" disabled={pending} onClick={() => start(async () => { await deleteAddress(a.id); router.refresh() })}>Delete</button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No saved addresses.</p>
      )}
      <h2 style={{ marginTop: 32, fontSize: 22 }}>Add a new address</h2>
      <form
        style={{ maxWidth: 620 }}
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
          setError(null)
          start(async () => {
            const errs = await validateAddress(data as unknown as AddressInput)
            if (errs.length) return setError(errs.join(". "))
            const res = await addAddress(data)
            if (!res.ok) return setError(res.error)
            form.reset()
            router.refresh()
          })
        }}
      >
        <div className="field-row">
          <div className="field"><label htmlFor="ad-first">First name</label><input id="ad-first" name="first_name" required /></div>
          <div className="field"><label htmlFor="ad-last">Last name</label><input id="ad-last" name="last_name" required /></div>
        </div>
        <div className="field"><label htmlFor="ad-1">Address</label><input id="ad-1" name="address_1" required /></div>
        <div className="field"><label htmlFor="ad-2">Apartment, suite, etc.</label><input id="ad-2" name="address_2" /></div>
        <div className="field-row">
          <div className="field"><label htmlFor="ad-city">City</label><input id="ad-city" name="city" required /></div>
          <div className="field">
            <label htmlFor="ad-state">State</label>
            <select id="ad-state" name="province" required defaultValue="">
              <option value="">Select state</option>
              {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field"><label htmlFor="ad-pin">PIN code</label><input id="ad-pin" name="postal_code" inputMode="numeric" maxLength={6} required /></div>
          <div className="field"><label htmlFor="ad-phone">Mobile number</label><input id="ad-phone" name="phone" type="tel" required /></div>
        </div>
        <div aria-live="assertive">{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <button className="button" disabled={pending}>Add address</button>
      </form>
    </div>
  )
}
