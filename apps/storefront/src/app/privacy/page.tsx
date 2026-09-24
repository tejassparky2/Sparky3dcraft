import { PolicyPage } from "@/components/PolicyPage"
import { readPolicy } from "@/lib/markdown"
import { pageMetadata } from "@/lib/seo"

const policy = readPolicy("privacy")
export const metadata = pageMetadata({ title: policy.title, path: "/privacy", noindex: policy.status !== "approved" })

export default function Page() {
  return <PolicyPage policy={policy} />
}
