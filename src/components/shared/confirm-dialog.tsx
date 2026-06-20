'use client'

import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  isPending: boolean
  // Cancel/dismiss button copy. Defaults to "Keep current" (the replace-confirm flow); the
  // unsaved-guard flow passes "Keep open".
  cancelLabel?: string
  // When provided, a left-aligned Discard button is shown (the unsaved-guard variant). Without it the
  // dialog is a plain confirm with the cancel + confirm buttons right-aligned (the replace variant).
  onDiscard?: () => void
  discardLabel?: string
}

// Shared confirm/guard dialog for the AI Explain + Optimize flows (replace-existing confirm and
// unsaved-on-close guard). The optional Discard button is the only structural difference between the
// two layouts.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending,
  cancelLabel = 'Keep current',
  onDiscard,
  discardLabel = 'Discard',
}: ConfirmDialogProps) {
  const actions = (
    <div className="flex gap-2">
      <AlertDialog.Close render={<Button variant="outline" size="sm" />}>
        {cancelLabel}
      </AlertDialog.Close>
      <Button size="sm" disabled={isPending} onClick={onConfirm} className="gap-1.5">
        {isPending && <Loader2 className="size-3.5 animate-spin" />}
        {confirmLabel}
      </Button>
    </div>
  )

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
          {onDiscard ? (
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={onDiscard} className="text-muted-foreground hover:text-foreground">
                {discardLabel}
              </Button>
              {actions}
            </div>
          ) : (
            <div className="flex justify-end gap-2">{actions}</div>
          )}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
