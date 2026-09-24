/** Typed access to Medusa `metadata` JSON (avoids `any`). */
export type Meta = Record<string, unknown>

export function meta(o: { metadata?: unknown } | null | undefined): Meta {
  const m = o?.metadata
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Meta) : {}
}

/** String metadata value, or undefined. */
export function ms(o: { metadata?: unknown } | null | undefined, key: string): string | undefined {
  const v = meta(o)[key]
  return typeof v === "string" && v.length ? v : undefined
}

export function errMessage(e: unknown): string | undefined {
  return e instanceof Error ? e.message : typeof e === "object" && e && "message" in e && typeof (e as { message: unknown }).message === "string" ? (e as { message: string }).message : undefined
}
