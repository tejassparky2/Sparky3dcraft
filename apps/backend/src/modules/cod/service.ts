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
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"

type CodOptions = { max_order_amount?: number }

/**
 * Cash on Delivery.
 *
 * Semantics (deliberately NOT a fake online payment):
 *  - checkout: payment is AUTHORIZED = "customer committed to pay on delivery"
 *  - no money has moved, so the order's payment status stays "authorized"
 *  - the merchant clicks "Capture" in Medusa Admin once cash is collected
 *  - refunds are recorded for bookkeeping; the money is returned offline
 */
class CodProviderService extends AbstractPaymentProvider<CodOptions> {
  static identifier = "cod"
  protected options_: CodOptions

  constructor(container: Record<string, unknown>, options: CodOptions) {
    super(container, options)
    const envMax = Number(process.env.COD_MAX_ORDER_AMOUNT)
    this.options_ = {
      max_order_amount:
        options?.max_order_amount ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : undefined),
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const amount = Number(input.amount?.toString?.() ?? input.amount)
    if (this.options_.max_order_amount && amount > this.options_.max_order_amount) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cash on Delivery is available for orders up to ${this.options_.max_order_amount} ${input.currency_code.toUpperCase()}`
      )
    }
    const sessionId = (input.data?.session_id as string) ?? input.context?.idempotency_key
    return {
      id: `cod_${sessionId}`,
      status: PaymentSessionStatus.PENDING,
      data: { method: "cod", session_id: sessionId, collected: false },
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const d = (input.data ?? {}) as Record<string, unknown>
    return {
      status: PaymentSessionStatus.PENDING,
      data: { method: "cod", session_id: d.session_id, collected: false },
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const d = (input.data ?? {}) as Record<string, unknown>
    return {
      status: PaymentSessionStatus.AUTHORIZED,
      data: { ...d, method: "cod", collected: false, authorized_at: new Date().toISOString() },
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const d = (input.data ?? {}) as Record<string, unknown>
    return {
      status: d.collected ? PaymentSessionStatus.CAPTURED : PaymentSessionStatus.AUTHORIZED,
      data: d,
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return {
      data: { ...(input.data ?? {}), collected: true, collected_at: new Date().toISOString() },
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const d = (input.data ?? {}) as Record<string, any>
    const refunds = [...(d.refunds ?? [])]
    refunds.push({
      amount: input.amount?.toString?.() ?? String(input.amount),
      at: new Date().toISOString(),
      note: "COD refund recorded; money returned offline",
    })
    return { data: { ...d, refunds } }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: { ...(input.data ?? {}), canceled_at: new Date().toISOString() } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: input.data }
  }

  async getWebhookActionAndData(): Promise<WebhookActionResult> {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
}

export default CodProviderService
