'use client'

import { type ReactNode, useCallback } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import { api } from '@/lib/api/client'
import { useControllableOpen } from '@/hooks/ui/use-controllable-open'
import { useLastNonNull } from '@/hooks/ui/use-last-non-null'
import { EMPTY_COLLECTION, type CollectionWithTypes } from '@/types/collection'
import { useRemoveCollectionQuery } from '@/hooks/items/use-collections'
import { useInvalidate } from '@/hooks/items/use-cache-invalidation'

interface CollectionDeleteDialogProps {
  collection: CollectionWithTypes | null
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: () => void
}

export function CollectionDeleteDialog({ collection: activeCollection, trigger, open: controlledOpen, onOpenChange, onSuccess }: CollectionDeleteDialogProps) {
  const removeCollectionQuery = useRemoveCollectionQuery()
  const invalidate = useInvalidate()
  const lastNonNullCollection = useLastNonNull(activeCollection)
  const displayCollection = lastNonNullCollection || EMPTY_COLLECTION

  const { open, handleOpenChange } = useControllableOpen({
    open: controlledOpen,
    onOpenChange,
  })

  const { mutate: deleteCollection, isPending: isDeletePending } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE('/collections/{id}', { params: { path: { id } } })
      if (error) throw new Error(error.message || 'Failed to delete collection')
    },
    onSuccess: () => {
      toast.success('Collection deleted')
      handleOpenChange(false)
      if (displayCollection.id) {
        removeCollectionQuery(displayCollection.id)
      }
      invalidate('collections')
      // Deleting a collection frees a free-tier slot, flipping canCreateCollection back to true in
      // /profile/me (which gates the create dialog).
      invalidate('userProfile')
      if (onSuccess) {
        onSuccess()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete collection')
    },
  })

  // `deleteCollection` (the destructured `mutate`) is a stable reference from TanStack Query,
  // so this callback only changes when the target collection id changes.
  const handleDelete = useCallback(() => {
    if (!displayCollection.id) return
    deleteCollection(displayCollection.id)
  }, [displayCollection.id, deleteCollection])

  const handleTriggerClick = useCallback(() => handleOpenChange(true), [handleOpenChange])
  const handleCancel = useCallback(() => handleOpenChange(false), [handleOpenChange])

  const triggerEl = trigger ? (
    // This wrapper only opens the dialog on a mouse click — it never needs its own keyboard handling.
    // Every call site passes a real, natively keyboard-accessible <button>, so Enter/Space on it already
    // fires a native `click` event that bubbles up to this handler.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span onClick={handleTriggerClick} className="contents">
      {trigger}
    </span>
  ) : null

  return (
    <>
      {triggerEl}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Collection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the collection &quot;{displayCollection.name}&quot;?
              Your items will <strong>not</strong> be deleted, but they will be removed from this collection.
            </DialogDescription>
          </DialogHeader>
          <DestructiveDialogFooter
            onCancel={handleCancel}
            onConfirm={handleDelete}
            isPending={isDeletePending}
            confirmText="Delete Collection"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
