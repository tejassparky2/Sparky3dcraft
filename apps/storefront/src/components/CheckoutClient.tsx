"use client"

import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"
import {
  completeCart,
  initiatePayment,
  listShippingOptions,
  setCheckoutAddress,
  setShippingMethod,
  type AddressInput,
  type PaymentProvider,
  type ShippingOption,
} from "@/lib/data/cart"
import { formatMoney } from "@/lib/money"
import { publicConfig } from "@/lib/public-config"
import { INDIAN_STATES } from "@/lib/india"

type RazorpayFailure = { error?: { description?: string; code?: string; reason?: string } }

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: RazorpayFailure) => void) => void }
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = publicConfig.razorpayCheckoutUrl
    s.async = true
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error("Payment library failed to load")))
    s.onerror = () => reject(new Error("Could not load the payment window. Check your connection and try again."))
    document.body.appendChild(s)
  })
}

type Props = {
  email: string
  address: AddressInput
  addressSaved: boolean
  shippingOptions: ShippingOption[]
  selectedShippingOptionId: string | null
  providers: PaymentProvider[]
  loggedIn: boolean
  currency: string
}

export function CheckoutClient(props: Props) {
  const router = useRouter()
  const [email, setEmail] = useState(props.email)
  const [addr, setAddr] = useState<AddressInput>(props.address)
  const [step, setStep] = useState<"address" | "shipping" | "payment">(
    props.addressSaved ? (props.selectedShippingOptionId ? "payment" : "shipping") : "address"
  )
  const [options, setOptions] = useState<ShippingOption[]>(props.shippingOptions)
  const [shippingId, setShippingId] = useState<string | null>(props.selectedShippingOptionId)
  const [provider, setProvider] = useState<string>(props.providers[0]?.id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [placing, setPlacing] = useState(false)
  const placingRef = useRef(false)


  const set = (k: keyof AddressInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setAddr({ ...addr, [k]: e.target.value })

  const saveAddress = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    start(async () => {
      const res = await setCheckoutAddress({ email, address: addr })
      if (!res.ok) return setError(res.error)
      const opts = await listShippingOptions()
      setOptions(opts)
      // single option: preselect (the customer still confirms with "Continue")
      if (opts.length === 1) setShippingId(opts[0].id)
      if (!opts.length) return setError("Sorry, we don't deliver to this address yet. Please contact us.")
      setStep("shipping")
      router.refresh()
    })
  }

  const saveShipping = () => {
    if (!shippingId) return setError("Choose a shipping method")
    setError(null)
    start(async () => {
      const res = await setShippingMethod(shippingId)
      if (!res.ok) return setError(res.error)
      setStep("payment")
      router.refresh()
    })
  }

  const finish = async () => {
    const res = await completeCart()
    if (res.ok && res.data) {
      router.replace(`/order/confirmed/${res.data.orderId}`)
      return true
    }
    setError(res.ok ? "Could not place order" : res.error)
    return false
  }

  const placeOrder = async () => {
    if (placingRef.current) return // double-click guard
    if (!provider) return setError("No payment method is available. Please contact us.")
    placingRef.current = true
    setPlacing(true)
    setError(null)
    setInfo(null)
    try {
      const init = await initiatePayment(provider)
      if (!init.ok || !init.data) {
        setError(init.ok ? "Could not start payment" : init.error)
        return
      }
      if (provider.startsWith("pp_razorpay")) {
        await loadRazorpay()
        const d = init.data.data as { razorpay_order_id: string; amount: number; currency: string; key_id: string; merchant_name?: string }
        await new Promise<void>((resolve) => {
          const rzp = new window.Razorpay!({
            key: d.key_id,
            order_id: d.razorpay_order_id,
            amount: d.amount,
            currency: d.currency,
            name: d.merchant_name || "Sparky 3D Craft Co",
            prefill: { name: `${addr.first_name} ${addr.last_name}`.trim(), email, contact: addr.phone },
            theme: { color: "#2C332F" },
            // The success callback only triggers server-side completion; Medusa
            // re-verifies the payment with Razorpay before creating the order.
            handler: async () => {
              setInfo("Payment received. Confirming your order…")
              const ok = await finish()
              if (!ok) {
                setInfo(
                  "Your payment went through but we could not confirm the order yet. Please don't pay again — press “Retry confirmation”, or check your email; the order is also confirmed automatically."
                )
              }
              resolve()
            },
            modal: {
              ondismiss: () => {
                setInfo("Payment was cancelled. You can try again.")
                resolve()
              },
              confirm_close: true,
            },
          })
          rzp.on("payment.failed", (r: RazorpayFailure) => {
            setError(r?.error?.description ? `Payment failed: ${r.error.description}` : "Payment failed. Please try again.")
          })
          rzp.open()
        })
      } else {
        await finish()
      }
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again.")
    } finally {
      placingRef.current = false
      setPlacing(false)
    }
  }

  const retryConfirm = async () => {
    setPlacing(true)
    await finish()
    setPlacing(false)
  }

  return (
    <div>
      <div aria-live="assertive">
        {error ? (
          <p className="form-error" role="alert" data-testid="checkout-error">
            {error}
          </p>
        ) : null}
      </div>
      <div aria-live="polite">
        {info ? (
          <p className="notice" data-testid="checkout-info">
            {info}{" "}
            {info.includes("Retry") ? (
              <button type="button" className="link" onClick={retryConfirm} disabled={placing}>
                Retry confirmation
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      <section className="checkout__step" aria-labelledby="step-contact">
        <h2 id="step-contact">Contact & delivery</h2>
        {step === "address" ? (
          <form onSubmit={saveAddress} noValidate>
            {!props.loggedIn ? (
              <p className="caption">
                Have an account? <a className="link" href="/login?next=/checkout">Log in</a>
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="co-email">Email <span className="required">*</span></label>
              <input id="co-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="co-first">First name <span className="required">*</span></label>
                <input id="co-first" autoComplete="given-name" required value={addr.first_name} onChange={set("first_name")} />
              </div>
              <div className="field">
                <label htmlFor="co-last">Last name <span className="required">*</span></label>
                <input id="co-last" autoComplete="family-name" required value={addr.last_name} onChange={set("last_name")} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="co-addr1">Address <span className="required">*</span></label>
              <input id="co-addr1" autoComplete="address-line1" required value={addr.address_1} onChange={set("address_1")} />
            </div>
            <div className="field">
              <label htmlFor="co-addr2">Apartment, suite, etc. (optional)</label>
              <input id="co-addr2" autoComplete="address-line2" value={addr.address_2 ?? ""} onChange={set("address_2")} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="co-city">City <span className="required">*</span></label>
                <input id="co-city" autoComplete="address-level2" required value={addr.city} onChange={set("city")} />
              </div>
              <div className="field">
                <label htmlFor="co-state">State <span className="required">*</span></label>
                <select id="co-state" autoComplete="address-level1" required value={addr.province} onChange={set("province")}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="co-pin">PIN code <span className="required">*</span></label>
                <input id="co-pin" autoComplete="postal-code" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} required value={addr.postal_code} onChange={set("postal_code")} />
              </div>
              <div className="field">
                <label htmlFor="co-phone">Mobile number <span className="required">*</span></label>
                <input id="co-phone" type="tel" autoComplete="tel" inputMode="tel" required value={addr.phone} onChange={set("phone")} />
              </div>
            </div>
            <p className="caption">Country: India</p>
            <button className="button" type="submit" disabled={pending} data-testid="continue-to-shipping">
              {pending ? "Saving…" : "Continue to shipping"}
            </button>
          </form>
        ) : (
          <div>
            <p style={{ margin: 0 }}>{email}</p>
            <p className="caption" style={{ margin: 0 }}>
              {[`${addr.first_name} ${addr.last_name}`, addr.address_1, addr.address_2, addr.city, addr.province, addr.postal_code, addr.phone].filter(Boolean).join(", ")}
            </p>
            <button type="button" className="link" onClick={() => setStep("address")} disabled={placing}>
              Change
            </button>
          </div>
        )}
      </section>

      <section className="checkout__step" aria-labelledby="step-shipping">
        <h2 id="step-shipping">Shipping method</h2>
        {step === "shipping" ? (
          <div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="visually-hidden">Shipping method</legend>
              {options.map((o) => (
                <label key={o.id} className="radio-card">
                  <input type="radio" name="shipping" value={o.id} checked={shippingId === o.id} onChange={() => setShippingId(o.id)} />
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", color: "rgb(var(--fg))" }}>{o.name}</span>
                    {o.description ? <span className="caption">{o.description}</span> : null}
                  </span>
                  <span>{o.amount === 0 ? "Free" : formatMoney(o.amount, props.currency)}</span>
                </label>
              ))}
            </fieldset>
            <button type="button" className="button" onClick={saveShipping} disabled={pending || !shippingId} data-testid="continue-to-payment">
              {pending ? "Saving…" : "Continue to payment"}
            </button>
          </div>
        ) : step === "payment" ? (
          <div>
            <p style={{ margin: 0 }}>{options.find((o) => o.id === shippingId)?.name ?? "Selected"}</p>
            <button type="button" className="link" onClick={() => setStep("shipping")} disabled={placing}>
              Change
            </button>
          </div>
        ) : (
          <p className="caption">Enter your address first.</p>
        )}
      </section>

      <section className="checkout__step" aria-labelledby="step-payment">
        <h2 id="step-payment">Payment</h2>
        {step === "payment" ? (
          props.providers.length ? (
            <div>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="visually-hidden">Payment method</legend>
                {props.providers.map((p) => (
                  <label key={p.id} className="radio-card">
                    <input type="radio" name="payment" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} disabled={placing} />
                    <span>{p.label}</span>
                  </label>
                ))}
              </fieldset>
              {provider.startsWith("pp_cod") ? <p className="caption">Pay in cash when your order is delivered.</p> : null}
              <button type="button" className="button button--full" onClick={placeOrder} disabled={placing} data-testid="place-order">
                {placing ? "Processing…" : provider.startsWith("pp_razorpay") ? "Pay now" : "Place order"}
              </button>
            </div>
          ) : (
            <p className="form-error">Online payment is not available right now. Please contact us to place your order.</p>
          )
        ) : (
          <p className="caption">Choose a shipping method first.</p>
        )}
      </section>
    </div>
  )
}
