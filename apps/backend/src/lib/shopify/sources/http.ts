/** Small fetch helper with timeout + bounded retry on 429/5xx. Read-only use. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { retries?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<Response> {
  const retries = opts.retries ?? 4
  const f = opts.fetchImpl ?? fetch
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 30000) })
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"))
        lastErr = new Error(`HTTP ${res.status} for ${redact(url)}`)
        if (attempt < retries) {
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt)
          continue
        }
      }
      return res
    } catch (e) {
      lastErr = e
      if (attempt < retries) await sleep(500 * 2 ** attempt)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Strip query strings that could contain tokens before logging a URL. */
export function redact(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return "<url>"
  }
}
