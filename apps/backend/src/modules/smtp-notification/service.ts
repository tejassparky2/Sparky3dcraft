import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import nodemailer, { Transporter } from "nodemailer"
import { renderEmail } from "../../lib/email-templates"

type SmtpOptions = {
  channels?: string[]
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
  /** false only for local test SMTP servers without STARTTLS (rejected in production). */
  require_tls?: boolean
}

/**
 * Generic SMTP notification provider (works with any transactional mail
 * service: Zoho, Brevo, SES SMTP, Postmark SMTP, Google Workspace relay…).
 */
class SmtpNotificationService extends AbstractNotificationProviderService {
  static identifier = "smtp"
  protected transporter_: Transporter
  protected from_: string
  protected logger_: Logger

  static validateOptions(options: Record<string, unknown>) {
    if (!options.host || !options.from) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "SMTP provider requires host and from")
    }
  }

  constructor({ logger }: { logger: Logger }, options: SmtpOptions) {
    super()
    this.logger_ = logger
    this.from_ = options.from
    this.transporter_ = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.user ? { user: options.user, pass: options.pass } : undefined,
      requireTLS: !options.secure && options.require_tls !== false,
      ignoreTLS: options.require_tls === false,
    })
  }

  async send(n: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const rendered =
      n.content?.html || n.content?.text
        ? { subject: n.content.subject ?? "", html: n.content.html ?? "", text: n.content.text ?? "" }
        : renderEmail(n.template, (n.data ?? {}) as Record<string, any>)
    try {
      const info = await this.transporter_.sendMail({
        from: n.from || this.from_,
        to: n.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
      return { id: info.messageId }
    } catch (e) {
      // Do not log recipient address or body (may contain reset tokens).
      this.logger_.error(`[smtp] failed to send "${n.template}": ${(e as Error).message}`)
      throw e
    }
  }
}

export default SmtpNotificationService
