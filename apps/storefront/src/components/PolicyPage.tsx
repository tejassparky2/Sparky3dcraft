import type { Policy } from "@/lib/markdown"

export function PolicyPage({ policy }: { policy: Policy }) {
  return (
    <div className="page-width section" style={{ maxWidth: 820 }}>
      <h1>{policy.title}</h1>
      <div className="rte" dangerouslySetInnerHTML={{ __html: policy.html }} />
    </div>
  )
}
