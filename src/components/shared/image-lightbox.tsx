'use client'

import { useState, useEffect, useCallback, memo } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X, Loader2 } from 'lucide-react'
import { useIsPro } from '@/hooks/profile/use-user-profile'
import { useDownloadSrcActions } from '@/hooks/billing/use-pro-download-src'

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
// enhancement (renders the preview immediately, fetches the original R2 asset in the background,
// fades it in over the preview once cached, and updates the loading indicator).
export const ImageLightbox = memo(function ImageLightbox({
  open,
  onOpenChange,
  itemId,
  previewSrc,
  alt,
  isSvg = false,
}: ImageLightboxProps) {
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

  // Lazy-load the high-res URL only on open, and only for raster images (SVGs skip fullsize)
  useEffect(() => {
    if (!open || !isPro || isSvg) return

    let active = true

    // ensure() resolves to the cached signed URL or fetches it once, and never rejects (null on failure).
    void ensure(itemId, false).then((url) => {
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

  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleImageLoad = useCallback(() => {
    setIsImageLoading(false)
  }, [])

  const handleImageError = useCallback(() => {
    setIsImageLoading(false)
    setHasError(true)
  }, [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label={alt}
          onClick={handleClose}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 outline-none backdrop-blur-sm duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 sm:p-8"
        >
          <div className="relative h-full w-full flex items-center justify-center">
            {/* oxlint-disable-next-line nextjs/no-img-element */}
            <img
              src={previewSrc}
              alt={alt}
              crossOrigin="anonymous"
              className="h-full w-full object-contain drop-shadow-2xl duration-150 data-open:animate-in data-open:zoom-in-95"
            />

            {/* High-res fullsize overlay — raster images only */}
            {showFullsize && (
              // oxlint-disable-next-line nextjs/no-img-element
              <img
                src={fullsizeUrl}
                alt={alt}
                crossOrigin="anonymous"
                onLoad={handleImageLoad}
                onError={handleImageError}
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

          <DialogPrimitive.Close className="absolute right-4 top-4 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white sm:right-6 sm:top-6">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
})
