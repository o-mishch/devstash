'use client'

import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Button } from '@/components/ui/button'
import { NestedAlertDialog } from '@/components/shared/nested-alert-dialog'

interface UnsavedChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDiscard: () => void
}

export function UnsavedChangesDialog({ open, onOpenChange, onDiscard }: UnsavedChangesDialogProps) {
  return (
    <NestedAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Discard changes?"
      description="Your unsaved changes will be lost."
    >
      <div className="flex justify-end gap-2">
        <AlertDialog.Close render={<Button variant="outline" size="sm" />}>
          Keep editing
        </AlertDialog.Close>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            onOpenChange(false)
            onDiscard()
          }}
        >
          Discard
        </Button>
      </div>
    </NestedAlertDialog>
  )
}
