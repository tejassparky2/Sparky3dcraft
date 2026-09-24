import "@fontsource/trirong/300.css"
import "@fontsource/quattrocento-sans/400.css"
import "@fontsource/quattrocento-sans/700.css"
import "./globals.css"
import type { Metadata, Viewport } from "next"
import { Footer } from "@/components/Footer"
import { Header } from "@/components/Header"
import { site } from "@/lib/site"
import { jsonLd, siteUrl } from "@/lib/seo"

const noindex = process.env.SITE_NOINDEX === "true"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${site.metaTitle} – ${site.name}`, template: `%s – ${site.name}` },
  description: site.metaDescription,
  applicationName: site.name,
  // Staging safety: SITE_NOINDEX=true on staging; final-verification.sh
  // fails a production cutover if it is still set.
  robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
  openGraph: { siteName: site.name, locale: "en_IN", type: "website", images: ["/brand/og-default.jpg"] },
  twitter: { card: "summary_large_image" },
}

export const viewport: Viewport = { themeColor: "#2C332F", width: "device-width", initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link visually-hidden" href="#MainContent">
          Skip to content
        </a>
        <div className="announcement" role="region" aria-label="Announcement">
          {site.announcement}
        </div>
        <Header />
        <main id="MainContent" tabIndex={-1}>
          {children}
        </main>
        <Footer />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={jsonLd({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: site.name,
            url: siteUrl(),
            logo: `${siteUrl()}/brand/icon-512.png`,
            contactPoint: [{ "@type": "ContactPoint", telephone: site.contact.phone, email: site.contact.email, contactType: "customer service", areaServed: "IN" }],
          })}
        />
      </body>
    </html>
  )
}
