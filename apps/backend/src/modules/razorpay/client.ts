/**
 * Minimal Razorpay REST client (https://razorpay.com/docs/api/).
 *
 * We deliberately use fetch instead of the `razorpay` npm SDK: the surface we
 * need is five endpoints, and owning the code keeps the payment path
 * auditable. Secrets are only ever placed in the Authorization header and are
 * never included in thrown errors or logs.
 */

export type RazorpayOrder = {
  id: string
  entity: "order"
  amount: number
  amount_paid: number
  amount_due: number
  currency: string
  receipt: string | null
  status: "created" | "attempted" | "paid"
  notes: Record<string, string> | []
  created_at: number
}

export type RazorpayPayment = {
  id: string
  entity: "payment"
  amount: number
  currency: string
  status: "created" | "authorized" | "captured" | "refunded" | "failed"
  order_id: string | null
  method?: string
  captured: boolean
  amount_refunded: number
  refund_status: null | "partial" | "full"
  error_code?: string | null
  error_description?: string | null
  notes: Record<string, string> | []
  created_at: number
}

export type RazorpayRefund = {
  id: string
  entity: "refund"
  amount: number
  currency: string
  payment_id: string
  receipt: string | null
  status: "pending" | "processed" | "failed"
  notes: Record<string, string> | []
  created_at: number
}

type Collection<T> = { entity: "collection"; count: number; items: T[] }

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message)
    this.name = "RazorpayApiError"
  }
}

export type RazorpayClientOptions = {
  keyId: string
  keySecret: string
  apiBase?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class RazorpayClient {
  private readonly base: string
  private readonly auth: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: RazorpayClientOptions) {
    this.base = (opts.apiBase ?? "https://api.razorpay.com/v1").replace(/\/$/, "")
    this.auth = "Basic " + Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64")
    this.timeoutMs = opts.timeoutMs ?? 15000
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: this.auth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      const reason = e instanceof Error ? e.name : "unknown"
      throw new RazorpayApiError(`Razorpay request ${method} ${path} failed: ${reason}`, 0, "NETWORK")
    }
    const text = await res.text()
    let json: any = undefined
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const code = json?.error?.code
      const desc = json?.error?.description ?? `HTTP ${res.status}`
      throw new RazorpayApiError(`Razorpay ${method} ${path}: ${desc}`, res.status, code)
    }
    return json as T
  }

  createOrder(input: {
    amount: number
    currency: string
    receipt: string
    notes: Record<string, string>
  }): Promise<RazorpayOrder> {
    return this.request("POST", "/orders", input)
  }

  fetchOrder(orderId: string): Promise<RazorpayOrder> {
    return this.request("GET", `/orders/${encodeURIComponent(orderId)}`)
  }

  async fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
    const c = await this.request<Collection<RazorpayPayment>>(
      "GET",
      `/orders/${encodeURIComponent(orderId)}/payments`
    )
    return c?.items ?? []
  }

  fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    return this.request("GET", `/payments/${encodeURIComponent(paymentId)}`)
  }

  capturePayment(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment> {
    return this.request("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, {
      amount,
      currency,
    })
  }

  async listRefunds(paymentId: string): Promise<RazorpayRefund[]> {
    const c = await this.request<Collection<RazorpayRefund>>(
      "GET",
      `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`
    )
    return c?.items ?? []
  }

  createRefund(
    paymentId: string,
    input: { amount: number; receipt: string; notes?: Record<string, string> }
  ): Promise<RazorpayRefund> {
    return this.request("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, input)
  }
}
