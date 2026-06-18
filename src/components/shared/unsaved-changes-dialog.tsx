'use client'

import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Button } from '@/components/ui/button'

interface UnsavedChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDiscard: () => void
}

export function UnsavedChangesDialog({ open, onOpenChange, onDiscard }: UnsavedChangesDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <AlertDialog.Popup className="fixed top-[calc(50%+1.25rem*var(--nested-dialogs))] left-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 scale-[calc(1-0.03*var(--nested-dialogs))] rounded-xl bg-popover p-5 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="mb-4 flex flex-col gap-1">
            <AlertDialog.Title className="font-heading text-base font-medium leading-none">
              Discard changes?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">
              Your unsaved changes will be lost.
            </AlertDialog.Description>
          </div>
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
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
