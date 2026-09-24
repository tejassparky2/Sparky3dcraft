"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import type { MediaItem } from "@/lib/data/catalog"
import { CloseIcon } from "./icons"

function MediaView({ m, priority, sizes }: { m: MediaItem; priority?: boolean; sizes: string }) {
  if (m.kind === "video") {
    return (
      <video
        src={m.url}
        poster={m.poster ?? undefined}
        controls
        playsInline
        muted
        loop
        preload="metadata"
        aria-label={m.alt}
        style={{ width: "100%", height: "auto", aspectRatio: m.width && m.height ? `${m.width} / ${m.height}` : undefined }}
      />
    )
  }
  return <Image src={m.url} alt={m.alt} width={1200} height={1200} sizes={sizes} priority={priority} style={{ width: "100%", height: "auto" }} />
}

export function ProductGallery({ media, title }: { media: MediaItem[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    document.body.style.overflow = "hidden"
    document.getElementById(`lightbox-media-${open}`)?.scrollIntoView({ block: "start" })
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null)
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = ""
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  const go = (i: number) => {
    const n = Math.max(0, Math.min(media.length - 1, i))
    const el = track.current?.children[n] as HTMLElement | undefined
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
    setIndex(n)
  }

  if (!media.length) return <div className="card__media card__media--square" aria-label={`${title} (no image)`} />

  return (
    <div>
      {/* desktop: first media full width, rest in a 2-column grid; click opens modal */}
      <ul className="gallery" aria-label={`${title} media`}>
        {media.map((m, i) => (
          <li key={m.key}>
            {m.kind === "image" ? (
              <button type="button" className="gallery__item" onClick={() => setOpen(i)} aria-label={`Open media ${i + 1} in modal`}>
                <MediaView m={m} priority={i === 0} sizes={i === 0 ? "(min-width: 750px) 55vw, 100vw" : "(min-width: 750px) 27vw, 50vw"} />
              </button>
            ) : (
              <div className="gallery__item" style={{ cursor: "default" }}>
                <MediaView m={m} sizes="55vw" />
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* mobile: swipe slider with counter */}
      <div className="slider">
        <div
          className="slider__track"
          ref={track}
          onScroll={(e) => {
            const el = e.currentTarget
            const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth
            setIndex(Math.round(el.scrollLeft / (w + 10)))
          }}
        >
          {media.map((m, i) => (
            <div className="slider__slide" key={m.key}>
              <MediaView m={m} priority={i === 0} sizes="88vw" />
            </div>
          ))}
        </div>
        {media.length > 1 ? (
          <div className="slider__controls">
            <button type="button" className="icon-button" aria-label="Previous slide" onClick={() => go(index - 1)} disabled={index === 0}>
              ‹
            </button>
            <span aria-live="polite">
              {Math.min(index + 1, media.length)} / {media.length}
            </span>
            <button type="button" className="icon-button" aria-label="Next slide" onClick={() => go(index + 1)} disabled={index >= media.length - 1}>
              ›
            </button>
          </div>
        ) : null}
      </div>

      {open !== null ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${title} media gallery`}>
          <button type="button" className="icon-button lightbox__close" aria-label="Close" onClick={() => setOpen(null)} autoFocus>
            <CloseIcon />
          </button>
          {media.map((m, i) => (
            <div key={m.key} id={`lightbox-media-${i}`}>
              <MediaView m={m} sizes="100vw" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
