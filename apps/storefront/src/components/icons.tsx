/* Outline icons in the style of the Dawn/Craft theme. Decorative: aria-hidden. */
type P = { className?: string }
const base = { "aria-hidden": true, focusable: false, fill: "none", xmlns: "http://www.w3.org/2000/svg" } as const

export const SearchIcon = (p: P) => (
  <svg {...base} viewBox="0 0 18 19" className={p.className}>
    <path fillRule="evenodd" clipRule="evenodd" d="M11.03 11.68A5.784 5.784 0 112.85 3.5a5.784 5.784 0 018.18 8.18zm.26 1.12a6.78 6.78 0 11.72-.7l5.4 5.4a.5.5 0 11-.71.7l-5.41-5.4z" fill="currentColor" />
  </svg>
)
export const AccountIcon = (p: P) => (
  <svg {...base} viewBox="0 0 18 19" className={p.className}>
    <path fillRule="evenodd" clipRule="evenodd" d="M6 4.5a3 3 0 116 0 3 3 0 01-6 0zm3-4a4 4 0 100 8 4 4 0 000-8zm5.58 12.15c1.12.82 1.83 2.24 1.91 4.85H1.51c.08-2.6.79-4.03 1.9-4.85C4.66 11.75 6.5 11.5 9 11.5s4.35.26 5.58 1.15zM9 10.5c-2.5 0-4.65.24-6.17 1.35C1.27 12.98.5 14.93.5 18v.5h17V18c0-3.07-.77-5.02-2.33-6.15-1.52-1.1-3.67-1.35-6.17-1.35z" fill="currentColor" />
  </svg>
)
export const CartIcon = (p: P) => (
  <svg {...base} viewBox="0 0 40 40" className={`icon-cart ${p.className ?? ""}`}>
    <path fillRule="evenodd" clipRule="evenodd" d="M15.75 11.8h-3.16l-.77 11.6a5 5 0 004.99 5.34h7.38a5 5 0 004.99-5.33L28.4 11.8zm0 1h-2.22l-.71 10.67a4 4 0 003.99 4.27h7.38a4 4 0 004-4.27l-.72-10.67h-2.22v.63a4.75 4.75 0 11-9.5 0zm8.5 0h-7.5v.63a3.75 3.75 0 107.5 0z" fill="currentColor" />
  </svg>
)
export const MenuIcon = (p: P) => (
  <svg {...base} viewBox="0 0 18 16" className={p.className}>
    <path d="M1 .5a.5.5 0 100 1h15.71a.5.5 0 000-1H1zM.5 8a.5.5 0 01.5-.5h15.71a.5.5 0 010 1H1A.5.5 0 01.5 8zm0 7a.5.5 0 01.5-.5h15.71a.5.5 0 010 1H1a.5.5 0 01-.5-.5z" fill="currentColor" />
  </svg>
)
export const CloseIcon = (p: P) => (
  <svg {...base} viewBox="0 0 18 17" className={p.className}>
    <path d="M.865 15.978a.5.5 0 00.707.707l7.433-7.431 7.579 7.282a.501.501 0 00.846-.37.5.5 0 00-.153-.351L9.712 8.546l7.417-7.416a.5.5 0 10-.707-.708L8.991 7.853 1.413.573a.5.5 0 10-.693.72l7.563 7.268-7.418 7.417z" fill="currentColor" />
  </svg>
)
export const ArrowIcon = (p: P) => (
  <svg {...base} viewBox="0 0 14 10" className={p.className} style={{ width: 14, height: 10, display: "inline-block" }}>
    <path fillRule="evenodd" clipRule="evenodd" d="M8.537.808a.5.5 0 01.817-.162l4 4a.5.5 0 010 .708l-4 4a.5.5 0 11-.708-.708L11.793 5.5H1a.5.5 0 010-1h10.793L8.646 1.354a.5.5 0 01-.109-.546z" fill="currentColor" />
  </svg>
)
export const MinusIcon = (p: P) => (
  <svg {...base} viewBox="0 0 10 2" className={p.className} style={{ width: 10, height: 2 }}>
    <path fillRule="evenodd" clipRule="evenodd" d="M.5 1C.5.7.7.5 1 .5h8a.5.5 0 110 1H1A.5.5 0 01.5 1z" fill="currentColor" />
  </svg>
)
export const PlusIcon = (p: P) => (
  <svg {...base} viewBox="0 0 10 10" className={p.className} style={{ width: 10, height: 10 }}>
    <path fillRule="evenodd" clipRule="evenodd" d="M1 4.51a.5.5 0 000 1h3.5l.01 3.5a.5.5 0 001-.01V5.5l3.5-.01a.5.5 0 00-.01-1H5.5L5.49.99a.5.5 0 00-1 .01v3.5l-3.5.01H1z" fill="currentColor" />
  </svg>
)
export const CheckIcon = (p: P) => (
  <svg {...base} viewBox="0 0 12 9" className={p.className} style={{ width: 12, height: 9 }}>
    <path fillRule="evenodd" clipRule="evenodd" d="M11.35.643a.5.5 0 01.006.707l-6.77 6.886a.5.5 0 01-.719-.006L.638 4.845a.5.5 0 11.724-.69l2.872 3.011 6.41-6.517a.5.5 0 01.707-.006h-.001z" fill="currentColor" />
  </svg>
)
