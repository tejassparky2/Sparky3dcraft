import { defineMiddlewares } from "@medusajs/framework/http"
import { enforcePersonalizationOnAdd, stripLineItemMetadataOnUpdate } from "../lib/personalization-middleware"

export default defineMiddlewares({
  routes: [
    {
      method: ["POST"],
      matcher: "/hooks/razorpay",
      bodyParser: { preserveRawBody: true, sizeLimit: "256kb" },
    },
    {
      method: ["POST"],
      matcher: "/store/sparky/uploads",
      // base64 of a 15 MB photo
      bodyParser: { sizeLimit: "21mb" },
    },
    {
      method: ["POST"],
      matcher: "/store/sparky/contact",
      bodyParser: { sizeLimit: "32kb" },
    },
    {
      method: ["POST"],
      matcher: "/store/carts/:id/line-items",
      middlewares: [enforcePersonalizationOnAdd],
    },
    {
      method: ["POST"],
      matcher: "/store/carts/:id/line-items/:line_id",
      middlewares: [stripLineItemMetadataOnUpdate],
    },
  ],
})
