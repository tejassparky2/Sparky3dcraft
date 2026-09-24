import { PolicyPage } from "@/components/PolicyPage"
import { readPolicy } from "@/lib/markdown"
import { pageMetadata } from "@/lib/seo"

const policy = readPolicy("shipping")
export const metadata = pageMetadata({ title: policy.title, path: "/shipping", noindex: policy.status !== "approved" })

export default function Page() {
  return <PolicyPage policy={policy} />
}
