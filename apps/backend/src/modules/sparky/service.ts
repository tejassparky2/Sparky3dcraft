import { MedusaService } from "@medusajs/framework/utils"
import SourceMapping from "./models/source-mapping"
import WebhookEvent from "./models/webhook-event"
import MigrationRun from "./models/migration-run"
import CustomerUpload from "./models/customer-upload"
import ContactMessage from "./models/contact-message"
import NewsletterSubscriber from "./models/newsletter-subscriber"

class SparkyModuleService extends MedusaService({
  SourceMapping,
  WebhookEvent,
  MigrationRun,
  CustomerUpload,
  ContactMessage,
  NewsletterSubscriber,
}) {}

export default SparkyModuleService
