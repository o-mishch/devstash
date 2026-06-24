'use client'

import { useState, useEffect } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X, Loader2 } from 'lucide-react'
import { useIsPro } from '@/hooks/use-user-profile'
import { useDownloadSrcActions } from '@/hooks/use-pro-download-src'

interface ImageLightboxProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string
  previewSrc: string
  alt: string
  /** SVGs are resolution-independent — skip the full-size fetch and render the existing preview at full viewport size. */
  isSvg?: boolean
}

// Full-screen image preview (lightbox) following the established pattern: a dimmed full-viewport
// surface, the image scaled to fit (contained, preserving aspect ratio), a close button top-right,
// Esc to close, and tap/click-anywhere to dismiss. Built on the base-ui Dialog primitives so focus
// trapping, scroll lock, and focus restoration come for free — and so opening it from inside the
// item drawer (itself a dialog) nests correctly: Esc closes only the lightbox.
//
// For raster images: if the user is Pro, fetches the full-size image URL on demand with progressive
// loading (thumbnail as base layer, high-res overlay once downloaded).
// For SVGs: renders the existing preview src at full viewport size — no fetch needed.
export function ImageLightbox({ open, onOpenChange, itemId, previewSrc, alt, isSvg = false }: ImageLightboxProps) {
  const isPro = useIsPro()
  const { ensure } = useDownloadSrcActions()
  const [fullsizeUrl, setFullsizeUrl] = useState<string | null>(null)
  const [isFetchingUrl, setIsFetchingUrl] = useState(false)
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [hasError, setHasError] = useState(false)

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    setFullsizeUrl(null)
    setIsFetchingUrl(open && isPro && !isSvg)
    setIsImageLoading(false)
    setHasError(false)
  }

  useEffect(() => {
    if (!open || !isPro || isSvg) return

    let active = true

    // ensure() resolves to the cached signed URL or fetches it once, and never rejects (null on failure).
    ensure(itemId, false).then((url) => {
      if (!active) return
      setIsFetchingUrl(false)
      if (url) {
        setFullsizeUrl(url)
        setIsImageLoading(true)
      } else {
        setHasError(true)
      }
    })

    return () => {
      active = false
    }
  }, [open, itemId, isPro, isSvg, ensure])

  const showFullsize = !!fullsizeUrl && !hasError
  const showLoading = isFetchingUrl || (showFullsize && isImageLoading)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label={alt}
          onClick={() => onOpenChange(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 outline-none backdrop-blur-sm duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 sm:p-8"
        >
          <div className="relative h-full w-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt={alt}
              crossOrigin="anonymous"
              className="h-full w-full object-contain drop-shadow-2xl duration-150 data-open:animate-in data-open:zoom-in-95"
            />

            {/* High-res fullsize overlay — raster images only */}
            {showFullsize && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fullsizeUrl}
                alt={alt}
                crossOrigin="anonymous"
                onLoad={() => setIsImageLoading(false)}
                onError={() => {
                  setIsImageLoading(false)
                  setHasError(true)
                }}
                className={`absolute inset-0 h-full w-full object-contain drop-shadow-2xl transition-opacity duration-300 ${isImageLoading ? 'opacity-0' : 'opacity-100'}`}
              />
            )}

            {/* Loading Indicator */}
            {showLoading && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/80 backdrop-blur-sm flex items-center gap-1.5 pointer-events-none z-10 animate-fade-in">
                <Loader2 className="size-3.5 animate-spin" />
                <span>Loading high-res...</span>
              </div>
            )}
          </div>

          <DialogPrimitive.Close
            aria-label="Close preview"
            className="absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 z-20"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
