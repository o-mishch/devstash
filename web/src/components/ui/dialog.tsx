import type { ComponentProps, ReactNode } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface DialogContentProps extends DialogPrimitive.Popup.Props {
  showCloseButton?: boolean
  /**
   * When true the popup grows out of a captured origin point instead of the default centre zoom.
   * The caller sets the --ds-morph-x/y CSS vars via `style`; see `.dialog-morph` in app.css.
   */
  morph?: boolean
  /**
   * When this dialog is opened from inside another drawer/dialog, `elevated` lifts the backdrop +
   * popup to z-[60] above the z-50 drawer and force-renders the backdrop — Base UI suppresses a
   * nested child's backdrop by default, so without it the surface behind stays un-dimmed.
   */
  elevated?: boolean
}

interface DialogOverlayProps extends DialogPrimitive.Backdrop.Props {
  elevated?: boolean
}

interface DialogFooterProps extends ComponentProps<'div'> {
  showCloseButton?: boolean
}

function Dialog({ ...props }: DialogPrimitive.Root.Props): ReactNode {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props): ReactNode {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props): ReactNode {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props): ReactNode {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, elevated = false, ...props }: DialogOverlayProps): ReactNode {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      forceRender={elevated || undefined}
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        elevated && 'z-[60]',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  morph = false,
  elevated = false,
  ...props
}: DialogContentProps): ReactNode {
  return (
    <DialogPortal>
      <DialogOverlay elevated={elevated} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        // Centering stays on the `translate` property (Tailwind's -translate-x/y-1/2), which leaves
        // `transform` free for .dialog-morph to drive the grow-from-origin.
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm',
          morph
            ? 'dialog-morph'
            : 'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          elevated && 'z-[60]',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: DialogFooterProps): ReactNode {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props): ReactNode {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-none font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props): ReactNode {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
