import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { useMediaQuery } from '@/hooks/use-media-query'

/**
 * Offset of the trigger's click point from the viewport centre, in px — the point the desktop
 * dialog grows out of. See `.dialog-morph` in app.css.
 */
export interface MorphOrigin {
  x: number
  y: number
}

/**
 * Captures where a create-dialog was opened from so the desktop dialog can morph out of it. Uses
 * the pointer position (which lands inside the trigger button, so the dialog appears to grow from
 * it). Returns null for keyboard activation (clientX/Y are 0) so those fall back to the default
 * centre zoom. window.innerWidth/Height is the only way to read the layout viewport centre; this
 * runs on a user click, client-side, with no framework-level alternative.
 */
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
  /** Makes the mobile bottom sheet resizable by dragging its grab handle. */
  mobileResizable?: boolean
  /** Extra className for the mobile BottomSheet's SheetContent — e.g. to pin its height. */
  mobileClassName?: string
  /**
   * Receives the resolved breakpoint plus a `scrolled` flag (true once the mobile sheet body has
   * scrolled off the top) so the caller can render the matching form body AND react to scroll.
   * `scrolled` is always false on desktop (the centered Dialog has no collapsing chrome).
   */
  children: (isDesktop: boolean, scrolled: boolean) => ReactNode
  /**
   * Desktop only: when set, the dialog grows out of this point (captured at open via
   * morphOriginFromClick) instead of the default centre zoom.
   */
  morphOrigin?: MorphOrigin | null
  /** Lift this dialog above another open drawer/dialog and dim the surface behind it. */
  elevated?: boolean
}

// The morph origin travels to CSS as custom properties, which React passes through untouched.
function getMorphStyle(morphOrigin: MorphOrigin): CSSProperties {
  return {
    '--ds-morph-x': `${String(morphOrigin.x)}px`,
    '--ds-morph-y': `${String(morphOrigin.y)}px`,
  }
}

/**
 * Shared responsive shell: a centered Dialog on desktop, a swipe-to-dismiss BottomSheet on mobile
 * (<768px). Owns the single breakpoint plus the title/description chrome, so each create flow only
 * supplies its form body.
 */
export function ResponsiveFormDialog({
  open,
  onOpenChange,
  title,
  description,
  desktopClassName,
  mobileResizable,
  mobileClassName,
  children,
  morphOrigin,
  elevated = false,
}: ResponsiveFormDialogProps): ReactNode {
  const isDesktop = useMediaQuery('(min-width: 768px)')

  if (isDesktop) {
    const morphStyle = morphOrigin ? getMorphStyle(morphOrigin) : undefined
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={desktopClassName}
          morph={Boolean(morphOrigin)}
          elevated={elevated}
          style={morphStyle}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description !== undefined && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children(true, false)}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      resizable={mobileResizable}
      className={mobileClassName}
      elevated={elevated}
    >
      {/* Annotated because ReactNode itself includes Promise in React 19, which reads to lint as a
          promise-returning function unless the non-promise union is stated. */}
      {(scrolled): ReactNode => children(false, scrolled)}
    </BottomSheet>
  )
}
