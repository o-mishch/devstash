'use client'

import { AlertDialog } from '@base-ui/react/alert-dialog'
import type { ReactNode } from 'react'

interface NestedAlertDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  // The footer/actions row, laid out by the caller.
  children: ReactNode
}

// Shared shell for alert dialogs nested inside the item drawer's base-ui Dialog. Renders the
// backdrop + popup + title/description; callers supply only their footer row.
export function NestedAlertDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: NestedAlertDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        {/* forceRender: nested inside the item drawer's base-ui Dialog, which suppresses a nested
            child's backdrop by default — without it the editing surface behind stays un-dimmed.
            z-[60] keeps backdrop + popup above the drawer and markdown editor overlay (both z-50). */}
        <AlertDialog.Backdrop forceRender className="fixed inset-0 isolate z-[60] bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <AlertDialog.Popup className="fixed top-[calc(50%+1.25rem*var(--nested-dialogs))] left-1/2 z-[60] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 scale-[calc(1-0.03*var(--nested-dialogs))] rounded-xl bg-popover p-5 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="mb-4 flex flex-col gap-1">
            <AlertDialog.Title className="font-heading text-base font-medium leading-none">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">
              {description}
            </AlertDialog.Description>
          </div>
          {children}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
