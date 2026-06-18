'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

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
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionDeleteDialogProps {
  collection: CollectionWithTypes | null
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: () => void
}

const DUMMY_COLLECTION: CollectionWithTypes = {
  id: '',
  name: '',
  description: '',
  isFavorite: false,
  createdAt: new Date(),
  itemCount: 0,
  dominantColor: null,
  types: [],
}

export function CollectionDeleteDialog({ collection: activeCollection, trigger, open: controlledOpen, onOpenChange, onSuccess }: CollectionDeleteDialogProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const lastNonNullCollection = useLastNonNull(activeCollection)
  const displayCollection = lastNonNullCollection || DUMMY_COLLECTION

  const { open, handleOpenChange } = useControllableOpen({
    open: controlledOpen,
    onOpenChange,
  })

  async function handleDelete() {
    if (!displayCollection.id) return
    setIsDeleting(true)
    try {
      const { error } = await api.DELETE('/collections/{id}', { params: { path: { id: displayCollection.id } } })
      if (!error) {
        toast.success('Collection deleted')
        handleOpenChange(false)
        if (onSuccess) {
          onSuccess()
        } else {
          router.refresh()
        }
      } else {
        toast.error(error.message || 'Failed to delete collection')
      }
    } catch {
      toast.error('Failed to delete collection')
    } finally {
      setIsDeleting(false)
    }
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
            isPending={isDeleting}
            confirmText="Delete Collection"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}


