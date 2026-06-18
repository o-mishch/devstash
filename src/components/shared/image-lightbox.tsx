'use client'

import { useState, useEffect } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X, Loader2 } from 'lucide-react'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { getSignedDownloadUrl } from '@/hooks/use-pro-download-src'

interface ImageLightboxProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string
  previewSrc: string
  alt: string
}

// Full-screen image preview (lightbox) following the established pattern: a dimmed full-viewport
// surface, the image scaled to fit (contained, preserving aspect ratio), a close button top-right,
// Esc to close, and tap/click-anywhere to dismiss. Built on the base-ui Dialog primitives so focus
// trapping, scroll lock, and focus restoration come for free — and so opening it from inside the
// item drawer (itself a dialog) nests correctly: Esc closes only the lightbox.
//
// When opened, if the user is Pro, it fetches the full-size image URL on demand.
// Progressive loading: displays the thumbnail immediately as a base layer, overlays the
// high-res image once fully downloaded, and displays a spinner while fetching/loading.
export function ImageLightbox({ open, onOpenChange, itemId, previewSrc, alt }: ImageLightboxProps) {
  const { isPro } = useAppUserFlagsStore()
  const [fullsizeUrl, setFullsizeUrl] = useState<string | null>(null)
  const [isFetchingUrl, setIsFetchingUrl] = useState(false)
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [hasError, setHasError] = useState(false)

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    setFullsizeUrl(null)
    setIsFetchingUrl(open && isPro)
    setIsImageLoading(false)
    setHasError(false)
  }

  useEffect(() => {
    if (!open || !isPro) return

    let active = true

    getSignedDownloadUrl(itemId, false)
      .then((url) => {
        if (!active) return
        setIsFetchingUrl(false)
        if (url) {
          setFullsizeUrl(url)
          setIsImageLoading(true)
        } else {
          setHasError(true)
        }
      })
      .catch(() => {
        if (!active) return
        setIsFetchingUrl(false)
        setHasError(true)
      })

    return () => {
      active = false
    }
  }, [open, itemId, isPro])

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
            {/* Low-res thumbnail placeholder (always rendered as background/base) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt={alt}
              crossOrigin="anonymous"
              className="h-full w-full object-contain drop-shadow-2xl duration-150 data-open:animate-in data-open:zoom-in-95"
            />

            {/* High-res fullsize image overlay */}
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
