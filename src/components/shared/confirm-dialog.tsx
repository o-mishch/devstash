'use client'

import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NestedAlertDialog } from '@/components/shared/nested-alert-dialog'

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
    <NestedAlertDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
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
    </NestedAlertDialog>
  )
}
