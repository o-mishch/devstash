'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'

interface DestructiveDialogFooterProps {
  onCancel: () => void
  onConfirm: () => void
  isPending: boolean
  confirmText: string
  confirmDisabled?: boolean
}

export function DestructiveDialogFooter({
  onCancel,
  onConfirm,
  isPending,
  confirmText,
  confirmDisabled = false,
}: DestructiveDialogFooterProps) {
  return (
    <DialogFooter className="pt-2">
      <Button variant="ghost" onClick={onCancel} disabled={isPending}>
        Cancel
      </Button>
      <Button variant="destructiveSolid" onClick={onConfirm} disabled={isPending || confirmDisabled}>
        {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
        {confirmText}
      </Button>
    </DialogFooter>
  )
}
