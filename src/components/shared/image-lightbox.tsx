'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'

interface ImageLightboxProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  src: string
  alt: string
}

// Full-screen image preview (lightbox) following the established pattern: a dimmed full-viewport
// surface, the image scaled to fit (contained, preserving aspect ratio), a close button top-right,
// Esc to close, and tap/click-anywhere to dismiss. Built on the base-ui Dialog primitives so focus
// trapping, scroll lock, and focus restoration come for free — and so opening it from inside the
// item drawer (itself a dialog) nests correctly: Esc closes only the lightbox.
//
// The dark scrim lives on the Popup itself (not a separate Backdrop): when nested inside the
// drawer's dialog the standalone backdrop renders behind the sheet, so painting it here guarantees
// the dimming. `h-full w-full object-contain` lets the image grow to fill the viewport (so vector
// art scales up) while staying contained.
export function ImageLightbox({ open, onOpenChange, src, alt }: ImageLightboxProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label={alt}
          onClick={() => onOpenChange(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 outline-none backdrop-blur-sm duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 sm:p-8"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            crossOrigin="anonymous"
            className="h-full w-full object-contain drop-shadow-2xl duration-150 data-open:animate-in data-open:zoom-in-95"
          />
          <DialogPrimitive.Close
            aria-label="Close preview"
            className="absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
