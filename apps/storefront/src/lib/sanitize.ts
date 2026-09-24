import "server-only"
import sanitizeHtml from "sanitize-html"

/**
 * Product/collection descriptions are merchant HTML (from Shopify or Admin).
 * Render only an allowlist — defence in depth against a compromised admin
 * account or malicious imported content.
 */
export function sanitizeDescription(html: string | null | undefined): string {
  return sanitizeHtml(String(html ?? ""), {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "h2", "h3", "h4", "h5", "h6", "blockquote", "a", "span", "div", "table", "thead", "tbody", "tr", "td", "th", "img", "hr"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, ...(attribs.target === "_blank" ? { rel: "noopener noreferrer" } : {}) },
      }),
    },
  })
}
