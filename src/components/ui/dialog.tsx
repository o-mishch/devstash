"use client"

import React, { memo, useCallback } from "react"
import type { ComponentProps } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import type { HTMLProps } from "@base-ui/react/types"

import { cn } from "@/lib/utils/index"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

const Dialog = memo(function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
})

const DialogTrigger = memo(function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
})

const DialogPortal = memo(function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
})

const DialogOverlay = memo(function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
})

const DialogContent = memo(function DialogContent({
  className,
  children,
  showCloseButton = true,
  morph = false,
  elevated = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  // When true the popup grows out of a captured origin point instead of the default centre zoom.
  // The caller sets the --ds-morph-x/y CSS vars via `style`; see `.dialog-morph` in globals.css.
  morph?: boolean
  // When this dialog is opened from inside another drawer/dialog (e.g. the collection-create dialog
  // launched from the item drawer), `elevated` lifts the backdrop + popup to z-[60] above the z-50
  // drawer and `forceRender`s the backdrop — Base UI suppresses a nested child's backdrop by default,
  // so without it the surface behind stays un-dimmed (same fix as NestedAlertDialog).
  elevated?: boolean
}) {
  const renderCloseButton = useCallback((buttonProps: HTMLProps) => (
    <Button
      {...buttonProps}
      variant="ghost"
      className="absolute top-2 right-2"
      size="icon-sm"
    />
  ), [])

  return (
    <DialogPortal>
      <DialogOverlay forceRender={elevated || undefined} className={cn(elevated && "z-[60]")} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm",
          morph
            ? "dialog-morph"
            : "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          elevated && "z-[60]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={renderCloseButton}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
})

const DialogHeader = memo(function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
})

const DialogFooter = memo(function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const renderCloseButton = useCallback((buttonProps: HTMLProps) => (
    <Button {...buttonProps} variant="outline" />
  ), [])

  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={renderCloseButton}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
})

const DialogTitle = memo(function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
})

const DialogDescription = memo(function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
})

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
