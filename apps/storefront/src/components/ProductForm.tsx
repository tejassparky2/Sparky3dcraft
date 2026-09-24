"use client"

import { useRouter } from "next/navigation"
import { useId, useRef, useState, useTransition } from "react"
import { addToCart } from "@/lib/data/cart"
import { ACCEPTED_UPLOAD, MAX_UPLOAD_MB, type PersonalizationConfig } from "@/lib/personalization"
import { publicConfig } from "@/lib/public-config"
import { MinusIcon, PlusIcon } from "./icons"

type Props = {
  variantId: string | null
  inStock: boolean
  personalization: PersonalizationConfig | null
  title: string
  thumbnail: string | null
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("Could not read the file"))
    r.readAsDataURL(file)
  })
}

export function ProductForm({ variantId, inStock, personalization: cfg, title, thumbnail }: Props) {
  const router = useRouter()
  const id = useId()
  const [qty, setQty] = useState(1)
  const [choice, setChoice] = useState("")
  const [text, setText] = useState("")
  const [upload, setUpload] = useState<{ id: string; filename: string; preview: string | null } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`Photo must be smaller than ${MAX_UPLOAD_MB} MB`)
      return
    }
    setUploading(true)
    try {
      const content_base64 = await readAsBase64(file)
      const res = await fetch(`${publicConfig.medusaUrl}/store/sparky/uploads`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-publishable-api-key": publicConfig.publishableKey },
        body: JSON.stringify({ filename: file.name, content_base64 }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.message || "Upload failed. Please try again.")
      const preview = /image\/(jpeg|png|webp)/.test(file.type) ? URL.createObjectURL(file) : null
      setUpload({ id: d.upload.id, filename: d.upload.filename, preview })
    } catch (e) {
      setUpload(null)
      setError(e instanceof TypeError ? "Could not reach the store. Check your connection and try again." : (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const missing = (): string | null => {
    if (!cfg) return null
    if (cfg.photo === "required" && !upload) return `${cfg.photo_label} is required`
    if (cfg.choice?.required && !choice) return `Please choose a ${cfg.choice.name}`
    if (cfg.text?.required && !text.trim()) return `${cfg.text.label} is required`
    return null
  }

  const submit = (buyNow: boolean) => {
    if (!variantId) return
    const m = missing()
    if (m) {
      setError(m)
      return
    }
    setError(null)
    start(async () => {
      const res = await addToCart({
        variantId,
        quantity: qty,
        personalization: cfg
          ? { photo_upload_id: upload?.id, choice_value: choice || undefined, custom_text: text.trim() || undefined }
          : undefined,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (buyNow) {
        router.push("/checkout")
        return
      }
      const detail = [choice && cfg?.choice ? `${cfg.choice.name}: ${choice}` : null, upload ? `Photo: ${upload.filename}` : null].filter(Boolean).join(" · ")
      window.dispatchEvent(new CustomEvent("cart:updated", { detail: { count: res.data?.count, item: { title, thumbnail, detail: detail || null } } }))
      window.scrollTo({ top: 0, behavior: "smooth" })
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
      noValidate
    >
      <div className="field" style={{ maxWidth: 142 }}>
        <label htmlFor={`${id}-qty`}>Quantity</label>
        <div className="quantity">
          <button type="button" aria-label={`Decrease quantity for ${title}`} onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>
            <MinusIcon />
          </button>
          <input
            id={`${id}-qty`}
            type="number"
            min={1}
            max={99}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
            inputMode="numeric"
          />
          <button type="button" aria-label={`Increase quantity for ${title}`} onClick={() => setQty((q) => Math.min(99, q + 1))}>
            <PlusIcon />
          </button>
        </div>
      </div>

      {cfg?.photo ? (
        <div className="field">
          <span id={`${id}-photo-label`} style={{ color: "rgb(var(--fg))", fontWeight: 700, fontSize: 14 }}>
            {cfg.photo_label} {cfg.photo === "required" ? <span className="required" aria-hidden="true">*</span> : null}
          </span>
          <div
            className="dropzone"
            role="button"
            tabIndex={0}
            aria-labelledby={`${id}-photo-label`}
            aria-describedby={`${id}-photo-help`}
            data-dragging={dragging}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileInput.current?.click())}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              handleFile(e.dataTransfer.files?.[0])
            }}
          >
            {uploading ? (
              <span>Uploading…</span>
            ) : upload ? (
              <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                {upload.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob: preview of the customer's own file
                  <img src={upload.preview} alt="Your uploaded photo" width={48} height={48} style={{ objectFit: "cover", borderRadius: 4 }} />
                ) : null}
                <span>{upload.filename}</span>
                <span className="dropzone__button">Change</span>
              </span>
            ) : (
              <>
                <span className="dropzone__button">Choose file</span>
                <div className="caption">or drop file to upload</div>
              </>
            )}
          </div>
          <input ref={fileInput} type="file" accept={ACCEPTED_UPLOAD} hidden onChange={(e) => handleFile(e.target.files?.[0])} data-testid="photo-input" />
          <span id={`${id}-photo-help`} className="caption">JPG, PNG, WEBP or HEIC, up to {MAX_UPLOAD_MB} MB</span>
        </div>
      ) : null}

      {cfg?.choice ? (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
          <legend style={{ color: "rgb(var(--fg))", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
            {cfg.choice.name} {cfg.choice.required ? <span className="required" aria-hidden="true">*</span> : null}
            {choice ? <span style={{ fontWeight: 400 }}> — {choice}</span> : null}
          </legend>
          <div className="swatches">
            {cfg.choice.values.map((v) => (
              <label className="swatch" key={v.value} title={v.value}>
                <input type="radio" name={`${id}-choice`} value={v.value} checked={choice === v.value} onChange={() => setChoice(v.value)} aria-label={v.value} />
                {v.swatch ? <span style={{ background: v.swatch }} /> : <span style={{ width: "auto", padding: "0 12px", lineHeight: "60px" }}>{v.value}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {cfg?.text ? (
        <div className="field">
          <label htmlFor={`${id}-text`}>
            {cfg.text.label} {cfg.text.required ? <span className="required">*</span> : null}
          </label>
          <input id={`${id}-text`} value={text} maxLength={cfg.text.max} onChange={(e) => setText(e.target.value)} />
        </div>
      ) : null}

      <div aria-live="assertive">{error ? <p className="form-error" role="alert">{error}</p> : null}</div>

      <div className="product__buttons">
        <button type="submit" className="button button--secondary button--full" disabled={!inStock || !variantId || pending || uploading} data-testid="add-to-cart">
          {!inStock ? "Sold out" : pending ? "Adding…" : "Add to cart"}
        </button>
        {inStock && !cfg ? (
          <button type="button" className="button button--full" disabled={pending || !variantId} onClick={() => submit(true)} data-testid="buy-now">
            Buy it now
          </button>
        ) : null}
      </div>
    </form>
  )
}
