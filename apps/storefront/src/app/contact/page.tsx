import { ContactForm } from "@/components/ContactForm"
import { pageMetadata } from "@/lib/seo"

export const metadata = pageMetadata({ title: "Contact", path: "/contact" })

export default function ContactPage() {
  return (
    <div className="page-width section" style={{ maxWidth: 820 }}>
      <h1>Contact</h1>
      <ContactForm />
    </div>
  )
}
