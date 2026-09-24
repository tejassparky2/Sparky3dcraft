import Link from "next/link"
import { site } from "@/lib/site"
import { NewsletterForm } from "./NewsletterForm"

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer>
      <section className="newsletter" aria-labelledby="newsletter-heading">
        <div className="page-width">
          <h2 id="newsletter-heading" className="h1">{site.newsletterHeading}</h2>
          <p>{site.newsletterText}</p>
          <NewsletterForm />
        </div>
      </section>
      <div className="footer">
        <div className="page-width">
          <ul className="footer__links">
            <li>
              <Link href="/">© {year}, {site.name}</Link>
            </li>
            <li><Link href="/privacy">Privacy policy</Link></li>
            <li><Link href="/terms">Terms of service</Link></li>
            <li><Link href="/shipping">Shipping policy</Link></li>
            <li><Link href="/refunds">Refund policy</Link></li>
            <li><Link href="/contact">Contact</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
