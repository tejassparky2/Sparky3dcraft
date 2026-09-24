import "server-only"
import fs from "node:fs"
import path from "node:path"

/**
 * Minimal, safe Markdown → HTML for policy pages (headings, paragraphs,
 * lists, bold/italic, links). Input HTML is escaped first.
 */
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function inline(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:|tel:|\/)[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

export function renderMarkdown(md: string): string {
  const out: string[] = []
  let list: "ul" | "ol" | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`)
    para = []
  }
  const closeList = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    let m: RegExpExecArray | null
    if (!line.trim()) {
      flushPara()
      closeList()
    } else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      flushPara()
      closeList()
      const level = Math.min(m[1].length + 1, 4)
      out.push(`<h${level}>${inline(m[2])}</h${level}>`)
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      flushPara()
      if (list !== "ul") {
        closeList()
        out.push("<ul>")
        list = "ul"
      }
      out.push(`<li>${inline(m[1])}</li>`)
    } else if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) {
      flushPara()
      if (list !== "ol") {
        closeList()
        out.push("<ol>")
        list = "ol"
      }
      out.push(`<li>${inline(m[1])}</li>`)
    } else {
      closeList()
      para.push(line.trim())
    }
  }
  flushPara()
  closeList()
  return out.join("\n")
}

export type Policy = { title: string; status: string; html: string }

export function readPolicy(slug: "privacy" | "terms" | "shipping" | "refunds"): Policy {
  const file = path.join(process.cwd(), "content", "policies", `${slug}.md`)
  const text = fs.readFileSync(file, "utf8")
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  const meta: Record<string, string> = {}
  for (const l of (fm?.[1] ?? "").split("\n")) {
    const i = l.indexOf(":")
    if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  }
  const body = fm ? text.slice(fm[0].length) : text
  return { title: meta.title ?? slug, status: meta.status ?? "missing", html: renderMarkdown(body) }
}
