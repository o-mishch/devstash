'use client'

import { memo, useCallback } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Button } from '@/components/ui/button'
import { NestedAlertDialog } from '@/components/shared/nested-alert-dialog'

interface UnsavedChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDiscard: () => void
}

import type { HTMLProps } from '@base-ui/react/types'

export const UnsavedChangesDialog = memo(function UnsavedChangesDialog({ open, onOpenChange, onDiscard }: UnsavedChangesDialogProps) {
  const renderCloseButton = useCallback((props: HTMLProps) => (
    <Button {...props} variant="outline" size="sm" />
  ), [])

  const handleDiscard = useCallback(() => {
    onOpenChange(false)
    onDiscard()
  }, [onOpenChange, onDiscard])

  return (
    <NestedAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Discard changes?"
      description="Your unsaved changes will be lost."
    >
      <div className="flex justify-end gap-2">
        <AlertDialog.Close render={renderCloseButton}>
          Keep editing
        </AlertDialog.Close>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDiscard}
        >
          Discard
        </Button>
      </div>
    </NestedAlertDialog>
  )
})
