import { model } from "@medusajs/framework/utils"

const NewsletterSubscriber = model
  .define("sparky_newsletter_subscriber", {
    id: model.id({ prefix: "nlsub" }).primaryKey(),
    email: model.text(),
    status: model.enum(["subscribed", "unsubscribed"]).default("subscribed"),
    source: model.text().default("storefront-footer"),
  })
  .indexes([{ on: ["email"], unique: true, where: "deleted_at IS NULL" }])

export default NewsletterSubscriber
