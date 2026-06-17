'use client'

import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { useMediaQuery } from '@/hooks/use-media-query'

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
}

// Shared responsive shell: a centered Dialog on desktop, a swipe-to-dismiss BottomSheet on
// mobile (`<768px`). Owns the single breakpoint + the title/description chrome so each create
// flow only supplies its form body. Used by the item- and collection-create dialogs.
export function ResponsiveFormDialog({
  open,
  onOpenChange,
  title,
  description,
  desktopClassName,
  headerClassName,
  mobileResizable,
  mobileClassName,
  children,
}: ResponsiveFormDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)')

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={desktopClassName}>
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
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title} description={description} resizable={mobileResizable} className={mobileClassName}>
      {(scrolled) => children(false, scrolled)}
    </BottomSheet>
  )
}
