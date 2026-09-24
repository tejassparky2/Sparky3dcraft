/**
 * Client-side reading of product personalization config (flat metadata keys).
 * The backend re-validates everything on add-to-cart; this is UX only.
 * Keep in sync with apps/backend/src/lib/personalization.ts.
 */
export type PersonalizationConfig = {
  photo: "required" | "optional" | null
  photo_label: string
  choice: { name: string; values: { value: string; swatch: string | null }[]; required: boolean } | null
  text: { label: string; required: boolean; max: number } | null
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export function parsePersonalization(metadata: Record<string, unknown> | null | undefined): PersonalizationConfig | null {
  const m = metadata ?? {}
  const photo = str(m.personalization_photo).toLowerCase()
  const values = str(m.personalization_choice_values)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [value, swatch] = x.split(":").map((s) => s.trim())
      return { value, swatch: swatch && /^#[0-9a-f]{3,8}$/i.test(swatch) ? swatch : null }
    })
    .filter((x) => x.value)
  const choiceName = str(m.personalization_choice_name)
  const textLabel = str(m.personalization_text_label)
  const cfg: PersonalizationConfig = {
    photo: photo === "required" || photo === "optional" ? photo : null,
    photo_label: str(m.personalization_photo_label) || "Upload your photo",
    choice: choiceName && values.length ? { name: choiceName, values, required: str(m.personalization_choice_required) !== "false" } : null,
    text: textLabel ? { label: textLabel, required: str(m.personalization_text_required) === "true", max: Math.min(Math.max(Number(m.personalization_text_max) || 60, 1), 500) } : null,
  }
  return cfg.photo || cfg.choice || cfg.text ? cfg : null
}

export const MAX_UPLOAD_MB = 15
export const ACCEPTED_UPLOAD = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
