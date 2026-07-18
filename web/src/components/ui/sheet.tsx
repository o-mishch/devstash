'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface SheetContentProps extends SheetPrimitive.Popup.Props {
  side?: 'top' | 'right' | 'bottom' | 'left'
  showCloseButton?: boolean
  /**
   * Lifts the backdrop + popup to z-[60] above a z-50 drawer, and force-renders the backdrop so the
   * surface behind is dimmed. Set when this sheet is opened from inside another drawer/dialog.
   */
  elevated?: boolean
}

interface SheetOverlayProps extends SheetPrimitive.Backdrop.Props {
  elevated?: boolean
}

function Sheet({ ...props }: SheetPrimitive.Root.Props): ReactNode {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props): ReactNode {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props): ReactNode {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props): ReactNode {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, elevated = false, ...props }: SheetOverlayProps): ReactNode {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      forceRender={elevated || undefined}
      className={cn(
        'fixed inset-0 z-50 bg-black/10 transition-opacity duration-500 ease-out data-ending-style:opacity-0 data-ending-style:duration-500 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs',
        elevated && 'z-[60]',
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  elevated = false,
  ...props
}: SheetContentProps): ReactNode {
  return (
    <SheetPortal>
      <SheetOverlay elevated={elevated} />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        // A full-length slide (translate-*-full) on the app's signature curve at duration-500 —
        // the panel travels in from off-screen rather than nudging into place.
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition-[transform,translate,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:opacity-0 data-ending-style:duration-500 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full data-[side=left]:top-0 data-[side=left]:left-0 data-[side=left]:h-dvh data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:-translate-x-full data-[side=left]:data-starting-style:-translate-x-full data-[side=right]:top-0 data-[side=right]:right-0 data-[side=right]:h-dvh data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-full data-[side=right]:data-starting-style:translate-x-full data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:-translate-y-full data-[side=top]:data-starting-style:-translate-y-full data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm',
          elevated && 'z-[60]',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-0.5 p-4', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props): ReactNode {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-base font-medium text-foreground', className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props): ReactNode {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
