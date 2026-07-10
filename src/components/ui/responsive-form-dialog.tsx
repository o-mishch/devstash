'use client'

import { memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { useMediaQuery } from '@/hooks/ui/use-media-query'

// Offset of the trigger's click point from the viewport centre, in px — the point the desktop
// dialog grows out of. See `.dialog-morph` in globals.css and `morphOrigin` below.
export interface MorphOrigin {
  x: number
  y: number
}

// Captures where a create-dialog was opened from so the desktop dialog can morph out of it. Uses
// the pointer position (it lands inside the trigger button, so the dialog appears to grow from it).
// Returns null for keyboard activation (clientX/Y are 0) so those fall back to the default zoom.
// window.innerWidth/Height is the only way to read the layout viewport centre; this runs on a user
// click, client-side, and there is no framework-level alternative for viewport dimensions.
export function morphOriginFromClick(e: MouseEvent): MorphOrigin | null {
  if (e.clientX === 0 && e.clientY === 0) return null
  return {
    x: e.clientX - window.innerWidth / 2,
    y: e.clientY - window.innerHeight / 2,
  }
}

interface ResponsiveFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  desktopClassName?: string
  headerClassName?: string
  // Makes the mobile bottom sheet resizable by dragging its grab handle (see BottomSheet). Use for
  // flows whose body has a flex-filling field (e.g. a description box) that should grow with it.
  mobileResizable?: boolean
  // Extra className forwarded to the mobile BottomSheet's SheetContent. Use to override the
  // default h-auto sizing — e.g. pin the sheet to a fixed height so content-height changes (lazy
  // loads, type switches) don't cause the sheet to jump.
  mobileClassName?: string
  // Receives the resolved breakpoint plus a `scrolled` flag (true once the mobile sheet body has
  // scrolled off the top) so the caller can render the matching form body AND react to scroll —
  // e.g. shrink the footer to free up space, mirroring the sheet header's collapse. `scrolled` is
  // always false on desktop (the centered Dialog has no collapsing chrome).
  children: (isDesktop: boolean, scrolled: boolean) => ReactNode
  // Desktop only: when set, the dialog grows out of this point (captured at open via
  // morphOriginFromClick) instead of the default centre zoom. Null/undefined → default zoom.
  morphOrigin?: MorphOrigin | null
  // Lift this dialog above another open drawer/dialog (z-50) and dim the surface behind it. Set when
  // the form is launched from inside another overlay — e.g. the collection-create dialog opened from
  // the item drawer's collection picker. Applies to both the desktop dialog and the mobile sheet.
  elevated?: boolean
}

// Shared responsive shell: a centered Dialog on desktop, a swipe-to-dismiss BottomSheet on
// mobile (`<768px`). Owns the single breakpoint + the title/description chrome so each create
// flow only supplies its form body. Used by the item- and collection-create dialogs.
const getMorphStyle = (morphOrigin: MorphOrigin) => ({
  '--ds-morph-x': `${morphOrigin.x}px`,
  '--ds-morph-y': `${morphOrigin.y}px`,
} as CSSProperties)

export const ResponsiveFormDialog = memo(function ResponsiveFormDialog({
  open,
  onOpenChange,
  title,
  description,
  desktopClassName,
  headerClassName,
  mobileResizable,
  mobileClassName,
  children,
  morphOrigin,
  elevated = false,
}: ResponsiveFormDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)')

  if (isDesktop) {
    const morphStyle = morphOrigin ? getMorphStyle(morphOrigin) : undefined
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={desktopClassName} morph={Boolean(morphOrigin)} elevated={elevated} style={morphStyle}>
          <DialogHeader className={headerClassName}>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children(true, false)}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title} description={description} resizable={mobileResizable} className={mobileClassName} elevated={elevated}>
      {(scrolled) => children(false, scrolled)}
    </BottomSheet>
  )
})
