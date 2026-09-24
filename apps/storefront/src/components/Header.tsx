"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { AccountIcon, CartIcon, CloseIcon, MenuIcon, SearchIcon } from "./icons"
import { CartNotification, type AddedItem } from "./CartNotification"

const NAV = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "Catalog" },
  { href: "/contact", label: "Contact" },
]

type Suggestion = { handle: string; title: string; thumbnail: string | null; price: string; compare: string | null }

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  if (href === "/catalog") return pathname.startsWith("/catalog") || pathname.startsWith("/collections") || pathname.startsWith("/products")
  return pathname.startsWith(href)
}

export function Header() {
  const pathname = usePathname() || "/"
  const isHome = pathname === "/"
  const router = useRouter()
  const [count, setCount] = useState<number | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [search, setSearch] = useState(false)
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Suggestion[] | null>(null)
  const [added, setAdded] = useState<AddedItem | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const refreshCount = useCallback(() => {
    fetch("/api/cart", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setCount(d.count ?? 0))
      .catch(() => setCount(null))
  }, [])

  useEffect(() => {
    refreshCount()
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { count?: number; item?: AddedItem } | undefined
      if (typeof detail?.count === "number") setCount(detail.count)
      else refreshCount()
      if (detail?.item) setAdded(detail.item)
    }
    window.addEventListener("cart:updated", onUpdate)
    return () => window.removeEventListener("cart:updated", onUpdate)
  }, [refreshCount])

  // close overlays on navigation (state derived during render, per React docs)
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setDrawer(false)
    setSearch(false)
  }

  useEffect(() => {
    if (!search) return
    searchInput.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSearch(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [search])

  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false)
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [drawer])

  // predictive search (debounced)
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setResults(d.products ?? []))
        .catch(() => {})
    }, 200)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  const logo = (
    <Link href="/" className="header__logo" aria-label="SPARKY 3D CRAFT CO — Home">
      <Image src="/brand/logo.png" alt="SPARKY 3D CRAFT CO" width={400} height={232} priority />
    </Link>
  )

  return (
    <header className="header" style={{ position: "relative" }}>
      <div className="page-width header__inner">
        <div className="header__left">
          <button type="button" className="icon-button header__mobile-only" aria-label="Menu" aria-expanded={drawer} aria-controls="menu-drawer" onClick={() => setDrawer(true)}>
            <MenuIcon />
          </button>
          <button type="button" className="icon-button header__desktop-only" aria-label="Search" onClick={() => setSearch(true)}>
            <SearchIcon />
          </button>
        </div>
        {isHome ? <h1 style={{ margin: 0, lineHeight: 0 }}>{logo}</h1> : logo}
        <div className="header__right">
          <button type="button" className="icon-button header__mobile-only" aria-label="Search" onClick={() => setSearch(true)}>
            <SearchIcon />
          </button>
          <Link href="/account" className="icon-button header__desktop-only" aria-label="Account">
            <AccountIcon />
          </Link>
          <Link href="/cart" className="icon-button" aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"} data-testid="cart-link">
            <CartIcon />
            {count ? (
              <span className="cart-count" aria-hidden="true" data-testid="cart-count">
                {count < 100 ? count : "99+"}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
      <nav aria-label="Main">
        <ul className="header__nav">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {added ? <CartNotification item={added} onClose={() => setAdded(null)} /> : null}

      {drawer ? (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <div className="drawer" id="menu-drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="drawer__top">
              <button type="button" className="icon-button" aria-label="Close menu" onClick={() => setDrawer(false)}>
                <CloseIcon />
              </button>
            </div>
            <ul className="drawer__nav">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="drawer__utility">
              <Link href="/account">
                <AccountIcon className="" /> <span>Log in</span>
              </Link>
            </div>
          </div>
        </>
      ) : null}

      {search ? (
        <>
          <div className="drawer-backdrop" onClick={() => setSearch(false)} />
          <div className="search-modal" role="dialog" aria-modal="true" aria-label="Search">
            <div className="page-width">
              <form
                className="search-modal__form"
                role="search"
                onSubmit={(e) => {
                  e.preventDefault()
                  router.push(`/search?q=${encodeURIComponent(q.trim())}`)
                }}
              >
                <label htmlFor="search-modal-input" className="visually-hidden">
                  Search
                </label>
                <input
                  id="search-modal-input"
                  ref={searchInput}
                  className="input"
                  type="search"
                  name="q"
                  placeholder="Search"
                  value={q}
                  autoComplete="off"
                  maxLength={100}
                  onChange={(e) => setQ(e.target.value)}
                />
                <button type="submit" className="icon-button" aria-label="Search">
                  <SearchIcon />
                </button>
                <button type="button" className="icon-button" aria-label="Close search" onClick={() => setSearch(false)}>
                  <CloseIcon />
                </button>
              </form>
              {results && q.trim().length >= 2 ? (
                <div className="search-results" aria-live="polite">
                  {results.length ? (
                    <>
                      <p className="caption" style={{ textTransform: "uppercase" }}>Products</p>
                      <ul>
                        {results.map((r) => (
                          <li key={r.handle}>
                            <Link href={`/products/${r.handle}`}>
                              {r.thumbnail ? <Image src={r.thumbnail} alt="" width={50} height={50} /> : null}
                              <span>
                                <span style={{ display: "block" }}>{r.title}</span>
                                <span className="caption">
                                  {r.compare ? <s style={{ opacity: 0.75, marginRight: 8 }}>{r.compare}</s> : null}
                                  {r.price}
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>No products found for “{q.trim()}”.</p>
                  )}
                  <p>
                    <Link href={`/search?q=${encodeURIComponent(q.trim())}`} className="link">
                      Search for “{q.trim()}”
                    </Link>
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </header>
  )
}
