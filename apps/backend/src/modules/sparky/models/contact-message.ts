import { model } from "@medusajs/framework/utils"

const ContactMessage = model.define("sparky_contact_message", {
  id: model.id({ prefix: "cmsg" }).primaryKey(),
  name: model.text().nullable(),
  email: model.text(),
  phone: model.text().nullable(),
  message: model.text(),
  status: model.enum(["new", "read", "archived"]).default("new"),
  notified: model.boolean().default(false),
})

export default ContactMessage
