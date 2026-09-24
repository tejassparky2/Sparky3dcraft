/**
 * Product personalization ("King Product Options" replacement).
 *
 * Configured per product with FLAT metadata keys so the merchant can edit
 * them in Medusa Admin → Product → Metadata:
 *   personalization_photo            "required" | "optional"
 *   personalization_photo_label      e.g. "Upload Your Custom Photo"
 *   personalization_choice_name      e.g. "Color"
 *   personalization_choice_values    "BLACK:#000000,GOLD:#d4af37"  (name[:swatch])
 *   personalization_choice_required  "true" | "false"
 *   personalization_text_label       optional free-text field label
 *   personalization_text_required    "true" | "false"
 *   personalization_text_max         max characters (default 60)
 *
 * The cart line item stores the customer's answers in metadata:
 *   photo_upload_id, photo_filename, choice_name, choice_value, custom_text
 */

export type PersonalizationConfig = {
  photo: "required" | "optional" | null
  photo_label: string
  choice: { name: string; values: { value: string; swatch: string | null }[]; required: boolean } | null
  text: { label: string; required: boolean; max: number } | null
}

export type PersonalizationInput = {
  photo_upload_id?: unknown
  choice_value?: unknown
  custom_text?: unknown
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export function parsePersonalization(metadata: Record<string, unknown> | null | undefined): PersonalizationConfig | null {
  const m = metadata ?? {}
  const photo = str(m.personalization_photo).toLowerCase()
  const choiceName = str(m.personalization_choice_name)
  const choiceValues = str(m.personalization_choice_values)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [value, swatch] = x.split(":").map((s) => s.trim())
      return { value, swatch: swatch && /^#[0-9a-f]{3,8}$/i.test(swatch) ? swatch : null }
    })
    .filter((x) => x.value)
  const textLabel = str(m.personalization_text_label)
  const cfg: PersonalizationConfig = {
    photo: photo === "required" || photo === "optional" ? photo : null,
    photo_label: str(m.personalization_photo_label) || "Upload your photo",
    choice: choiceName && choiceValues.length ? { name: choiceName, values: choiceValues, required: str(m.personalization_choice_required) !== "false" } : null,
    text: textLabel
      ? { label: textLabel, required: str(m.personalization_text_required) === "true", max: Math.min(Math.max(Number(m.personalization_text_max) || 60, 1), 500) }
      : null,
  }
  return cfg.photo || cfg.choice || cfg.text ? cfg : null
}

export type ValidationResult = { ok: true; metadata: Record<string, string> } | { ok: false; errors: string[] }

/**
 * Validate customer answers against the product config. Returns the ONLY
 * metadata keys that will be stored (unknown keys are dropped).
 */
export function validatePersonalization(cfg: PersonalizationConfig | null, input: PersonalizationInput | undefined): ValidationResult {
  const errors: string[] = []
  const out: Record<string, string> = {}
  const i = input ?? {}
  if (!cfg) {
    if (str(i.photo_upload_id) || str(i.choice_value) || str(i.custom_text)) errors.push("This product does not accept personalization")
    return errors.length ? { ok: false, errors } : { ok: true, metadata: out }
  }
  const upload = str(i.photo_upload_id)
  if (cfg.photo === "required" && !upload) errors.push(`${cfg.photo_label} is required`)
  if (upload) {
    if (!cfg.photo) errors.push("This product does not accept a photo")
    else if (!/^cupl_[0-9A-Z]{26}$/.test(upload)) errors.push("Invalid photo reference")
    else out.photo_upload_id = upload
  }
  if (cfg.choice) {
    const v = str(i.choice_value)
    if (!v && cfg.choice.required) errors.push(`${cfg.choice.name} is required`)
    if (v) {
      const match = cfg.choice.values.find((x) => x.value.toLowerCase() === v.toLowerCase())
      if (!match) errors.push(`Invalid ${cfg.choice.name}`)
      else {
        out.choice_name = cfg.choice.name
        out.choice_value = match.value
      }
    }
  } else if (str(i.choice_value)) errors.push("This product has no options to choose")
  if (cfg.text) {
    const t = str(i.custom_text).replace(/[\u0000-\u001f\u007f]/g, "")
    if (!t && cfg.text.required) errors.push(`${cfg.text.label} is required`)
    if (t.length > cfg.text.max) errors.push(`${cfg.text.label} must be at most ${cfg.text.max} characters`)
    if (t) out.custom_text = t
  } else if (str(i.custom_text)) errors.push("This product does not accept custom text")
  return errors.length ? { ok: false, errors } : { ok: true, metadata: out }
}

/** Accepted upload types, sniffed from bytes (never from the client's claim). */
export function sniffUpload(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" }
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { mime: "image/png", ext: "png" }
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" }
  if (buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12)
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return { mime: "image/heic", ext: "heic" }
    if (brand === "avif") return { mime: "image/avif", ext: "avif" }
  }
  return null
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
