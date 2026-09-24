import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { RazorpayApiError, RazorpayClient, RazorpayPayment } from "./client"
import {
  fromMinorUnits,
  headerValue,
  notesOf,
  toMinorUnits,
  verifyWebhookSignature,
} from "./utils"

export type RazorpayOptions = {
  key_id: string
  key_secret: string
  webhook_secret?: string
  api_base?: string
  merchant_name?: string
}

type InjectedDependencies = { logger: Logger }

/**
 * Data we persist on the Medusa payment session. It is returned to the
 * storefront (it needs `razorpay_order_id`, `amount`, `currency`, `key_id` to
 * open Razorpay Checkout), so it must never contain secrets.
 */
export type RazorpaySessionData = {
  session_id: string
  razorpay_order_id: string
  amount: number // minor units
  currency: string // upper-case ISO
  key_id: string // public key id
  merchant_name?: string
  razorpay_payment_id?: string
  razorpay_status?: RazorpayPayment["status"]
  captured_amount?: number
  refunds?: { id: string; amount: number; receipt: string | null }[]
}

class RazorpayProviderService extends AbstractPaymentProvider<RazorpayOptions> {
  static identifier = "razorpay"

  protected logger_: Logger
  protected options_: RazorpayOptions
  protected client_: RazorpayClient

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.key_id || !options.key_secret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Razorpay provider requires key_id and key_secret"
      )
    }
  }

  constructor(container: InjectedDependencies, options: RazorpayOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
    this.client_ = new RazorpayClient({
      keyId: options.key_id,
      keySecret: options.key_secret,
      apiBase: options.api_base,
    })
    if (!options.webhook_secret) {
      this.logger_.warn(
        "[razorpay] RAZORPAY_WEBHOOK_SECRET not set: webhooks will be rejected. " +
          "Orders still complete via server-side verification at checkout."
      )
    }
  }

  // ------------------------------------------------------------------ helpers

  private sessionData(data: Record<string, unknown> | undefined): RazorpaySessionData {
    const d = (data ?? {}) as Partial<RazorpaySessionData>
    if (!d.razorpay_order_id || typeof d.razorpay_order_id !== "string") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing Razorpay order reference")
    }
    return d as RazorpaySessionData
  }

  private wrap(err: unknown, action: string): never {
    if (err instanceof MedusaError) throw err
    if (err instanceof RazorpayApiError) {
      this.logger_.error(`[razorpay] ${action} failed: ${err.message} (status ${err.status})`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Payment provider error during ${action}. Please try again.`
      )
    }
    this.logger_.error(`[razorpay] ${action} failed: ${(err as Error)?.message}`)
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Payment error during ${action}`)
  }

  /**
   * Pick the payment that settles the order: captured beats authorized; it
   * must match the order currency and full order amount.
   */
  private pickSettlingPayment(
    payments: RazorpayPayment[],
    expectedAmount: number,
    currency: string
  ): RazorpayPayment | undefined {
    const valid = payments.filter(
      (p) =>
        p.amount === expectedAmount &&
        p.currency?.toUpperCase() === currency.toUpperCase() &&
        (p.status === "captured" || p.status === "authorized")
    )
    return (
      valid.find((p) => p.status === "captured") ?? valid.find((p) => p.status === "authorized")
    )
  }

  private async createOrderFor(
    sessionId: string,
    amount: unknown,
    currencyCode: string
  ): Promise<RazorpaySessionData> {
    const currency = currencyCode.toUpperCase()
    const minor = toMinorUnits(amount, currency)
    if (minor < 100) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Order total is below the minimum payable amount")
    }
    const order = await this.client_.createOrder({
      amount: minor,
      currency,
      // Razorpay receipt max length is 40 chars; Medusa session ids fit.
      receipt: sessionId.slice(0, 40),
      notes: { session_id: sessionId, source: "medusa" },
    })
    return {
      session_id: sessionId,
      razorpay_order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: this.options_.key_id,
      merchant_name: this.options_.merchant_name,
    }
  }

  // --------------------------------------------------------------- lifecycle

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    // `session_id` is appended by the Payment Module after any user-provided
    // data, so it cannot be spoofed by the storefront.
    const sessionId = (input.data?.session_id as string) ?? input.context?.idempotency_key
    if (!sessionId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing payment session id")
    }
    try {
      const data = await this.createOrderFor(sessionId, input.amount, input.currency_code)
      return { id: data.razorpay_order_id, data, status: PaymentSessionStatus.PENDING }
    } catch (e) {
      this.wrap(e, "initiate payment")
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // A Razorpay order's amount is immutable; if the cart total changed, a new
    // order is created. Only our own stored fields are trusted.
    const current = input.data as Partial<RazorpaySessionData> | undefined
    const sessionId = current?.session_id ?? input.context?.idempotency_key
    try {
      const currency = input.currency_code.toUpperCase()
      const minor = toMinorUnits(input.amount, currency)
      if (
        current?.razorpay_order_id &&
        current.amount === minor &&
        current.currency?.toUpperCase() === currency
      ) {
        return { data: current as Record<string, unknown>, status: PaymentSessionStatus.PENDING }
      }
      if (!sessionId) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing payment session id")
      }
      const data = await this.createOrderFor(sessionId, input.amount, input.currency_code)
      return { data, status: PaymentSessionStatus.PENDING }
    } catch (e) {
      this.wrap(e, "update payment")
    }
  }

  /**
   * Called by Medusa when the cart is completed (and from the webhook flow).
   * Authoritative, server-side check against Razorpay — the browser's
   * success callback is never trusted.
   */
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = this.sessionData(input.data)
    try {
      const order = await this.client_.fetchOrder(data.razorpay_order_id)
      const orderSession = notesOf(order).session_id
      if (orderSession && data.session_id && orderSession !== data.session_id) {
        this.logger_.error(
          `[razorpay] order ${order.id} belongs to a different session; refusing authorization`
        )
        return { status: PaymentSessionStatus.ERROR, data: data as unknown as Record<string, unknown> }
      }
      const payments = await this.client_.fetchOrderPayments(data.razorpay_order_id)
      const settling = this.pickSettlingPayment(payments, order.amount, order.currency)
      if (!settling) {
        const failed = payments.some((p) => p.status === "failed")
        return {
          status: failed && !payments.some((p) => p.status === "created")
            ? PaymentSessionStatus.ERROR
            : PaymentSessionStatus.PENDING,
          data: data as unknown as Record<string, unknown>,
        }
      }
      const newData: RazorpaySessionData = {
        ...data,
        razorpay_payment_id: settling.id,
        razorpay_status: settling.status,
        captured_amount: settling.status === "captured" ? settling.amount : 0,
      }
      return {
        status:
          settling.status === "authorized"
            ? PaymentSessionStatus.AUTHORIZED
            : PaymentSessionStatus.CAPTURED,
        data: newData as unknown as Record<string, unknown>,
      }
    } catch (e) {
      this.wrap(e, "authorize payment")
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const res = await this.authorizePayment(input)
    return res
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = this.sessionData(input.data)
    if (!data.razorpay_payment_id) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "No Razorpay payment to capture")
    }
    try {
      let payment = await this.client_.fetchPayment(data.razorpay_payment_id)
      if (payment.status === "authorized") {
        payment = await this.client_.capturePayment(payment.id, payment.amount, payment.currency)
      } else if (payment.status !== "captured" && payment.status !== "refunded") {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Razorpay payment is ${payment.status}; cannot capture`
        )
      }
      return {
        data: {
          ...data,
          razorpay_status: payment.status,
          captured_amount: payment.amount,
        },
      }
    } catch (e) {
      // Capturing twice returns BAD_REQUEST_ERROR from Razorpay; re-check state.
      if (e instanceof RazorpayApiError && e.status === 400) {
        const p = await this.client_.fetchPayment(data.razorpay_payment_id).catch(() => undefined)
        if (p?.status === "captured") {
          return { data: { ...data, razorpay_status: "captured", captured_amount: p.amount } }
        }
      }
      this.wrap(e, "capture payment")
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = this.sessionData(input.data)
    if (!data.razorpay_payment_id) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "No Razorpay payment to refund")
    }
    const receipt = (input.context?.idempotency_key ?? "").slice(0, 40)
    if (!receipt) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Refund requires an idempotency key")
    }
    try {
      const minor = toMinorUnits(input.amount, data.currency)
      // Idempotency: Medusa passes its refund id; if a refund with that
      // receipt already exists (e.g. retried request) return it instead.
      const existing = (await this.client_.listRefunds(data.razorpay_payment_id)).find(
        (r) => r.receipt === receipt
      )
      let refund = existing
      if (!refund) {
        try {
          refund = await this.client_.createRefund(data.razorpay_payment_id, {
            amount: minor,
            receipt,
            notes: { session_id: data.session_id },
          })
        } catch (e) {
          // Concurrent retry: Razorpay rejects a reused receipt ("Duplicate
          // receipt found"); the refund already exists, so return it.
          if (e instanceof RazorpayApiError && e.status === 400) {
            refund = (await this.client_.listRefunds(data.razorpay_payment_id)).find((r) => r.receipt === receipt)
          }
          if (!refund) throw e
        }
      }
      const refunds = [...(data.refunds ?? []).filter((r) => r.id !== refund.id)]
      refunds.push({ id: refund.id, amount: refund.amount, receipt: refund.receipt })
      return { data: { ...data, refunds } }
    } catch (e) {
      this.wrap(e, "refund payment")
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    // Razorpay has no API to void an authorization; uncaptured payments are
    // auto-refunded by Razorpay after the capture window. Record intent only.
    const data = (input.data ?? {}) as Record<string, unknown>
    return { data: { ...data, canceled_at: new Date().toISOString() } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    // Razorpay orders cannot be deleted; unpaid orders simply expire.
    return { data: input.data }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = this.sessionData(input.data)
    try {
      if (data.razorpay_payment_id) {
        const p = await this.client_.fetchPayment(data.razorpay_payment_id)
        return { data: { ...data, razorpay_status: p.status } }
      }
      const o = await this.client_.fetchOrder(data.razorpay_order_id)
      return { data: { ...data, razorpay_order_status: o.status } }
    } catch (e) {
      this.wrap(e, "retrieve payment")
    }
  }

  /**
   * Webhook → Medusa action. Signature is verified again here (defence in
   * depth; the /hooks/razorpay route verifies before enqueueing).
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const raw = payload.rawData as string | Buffer | undefined
    const signature = headerValue(payload.headers as Record<string, unknown>, "x-razorpay-signature")
    if (!raw || !verifyWebhookSignature(raw, signature, this.options_.webhook_secret)) {
      this.logger_.warn("[razorpay] webhook with invalid or missing signature ignored")
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    const body = payload.data as any
    const event: string = body?.event
    const payment: RazorpayPayment | undefined = body?.payload?.payment?.entity
    const orderEntity = body?.payload?.order?.entity
    if (!payment) return { action: PaymentActions.NOT_SUPPORTED }

    let sessionId = notesOf(payment).session_id ?? notesOf(orderEntity).session_id
    if (!sessionId && payment.order_id) {
      try {
        const order = await this.client_.fetchOrder(payment.order_id)
        sessionId = notesOf(order).session_id
      } catch (e) {
        this.logger_.error(`[razorpay] could not resolve session for ${payment.order_id}`)
      }
    }
    if (!sessionId) return { action: PaymentActions.NOT_SUPPORTED }

    const amount = fromMinorUnits(payment.amount)
    switch (event) {
      case "payment.authorized":
        return { action: PaymentActions.AUTHORIZED, data: { session_id: sessionId, amount } }
      case "payment.captured":
      case "order.paid":
        return { action: PaymentActions.SUCCESSFUL, data: { session_id: sessionId, amount } }
      case "payment.failed":
        return { action: PaymentActions.FAILED, data: { session_id: sessionId, amount } }
      default:
        return { action: PaymentActions.NOT_SUPPORTED }
    }
  }
}

export default RazorpayProviderService
