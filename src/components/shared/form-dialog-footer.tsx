'use client'

import { Button, SubmitButton } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface FormDialogFooterProps {
  submitText: string
  onCancel: () => void
  isPending: boolean
  // Mobile keeps both actions on one row (equal width) to preserve vertical space in the sheet.
  mobile?: boolean
  className?: string
}

// Shared Cancel + submit footer for the create/edit form dialogs (item, collection). The
// item dialog's scroll-reactive mobile footer stays bespoke; everything else renders this.
export function FormDialogFooter({ submitText, onCancel, isPending, mobile = false, className }: FormDialogFooterProps) {
  return (
    <DialogFooter className={cn(mobile && 'flex-row gap-2', className)}>
      <Button type="button" variant="outline" className={cn(mobile && 'flex-1')} onClick={onCancel}>
        Cancel
      </Button>
      <SubmitButton className={cn(mobile && 'flex-1')} isPending={isPending}>
        {submitText}
      </SubmitButton>
    </DialogFooter>
  )
}
