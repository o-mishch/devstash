'use client'

import { type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
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
import { useControllableOpen } from '@/hooks/use-controllable-open'
import { useLastNonNull } from '@/hooks/use-last-non-null'
import { EMPTY_COLLECTION, type CollectionWithTypes } from '@/types/collection'

interface CollectionDeleteDialogProps {
  collection: CollectionWithTypes | null
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: () => void
}

export function CollectionDeleteDialog({ collection: activeCollection, trigger, open: controlledOpen, onOpenChange, onSuccess }: CollectionDeleteDialogProps) {
  const router = useRouter()
  const lastNonNullCollection = useLastNonNull(activeCollection)
  const displayCollection = lastNonNullCollection || EMPTY_COLLECTION

  const { open, handleOpenChange } = useControllableOpen({
    open: controlledOpen,
    onOpenChange,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE('/collections/{id}', { params: { path: { id } } })
      if (error) throw new Error(error.message || 'Failed to delete collection')
    },
    onSuccess: () => {
      toast.success('Collection deleted')
      handleOpenChange(false)
      if (onSuccess) {
        onSuccess()
      } else {
        router.refresh()
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete collection')
    },
  })

  function handleDelete() {
    if (!displayCollection.id) return
    deleteMutation.mutate(displayCollection.id)
  }

  const triggerEl = trigger ? (
    <span onClick={() => handleOpenChange(true)} className="contents">
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
            onCancel={() => handleOpenChange(false)}
            onConfirm={handleDelete}
            isPending={deleteMutation.isPending}
            confirmText="Delete Collection"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}


