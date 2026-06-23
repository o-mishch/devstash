'use client'

import { type ReactNode } from 'react'
import { api } from '@/lib/api/client'
import { CollectionFormDialog } from './collection-form-dialog'
import { useLastNonNull } from '@/hooks/use-last-non-null'
import { EMPTY_COLLECTION, type CollectionWithTypes } from '@/types/collection'

interface CollectionEditDialogProps {
  collection: CollectionWithTypes | null
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CollectionEditDialog({ collection: activeCollection, trigger, open, onOpenChange }: CollectionEditDialogProps) {
  const lastNonNullCollection = useLastNonNull(activeCollection)
  const displayCollection = lastNonNullCollection || EMPTY_COLLECTION

  return (
    <CollectionFormDialog
      title="Edit Collection"
      description="Update the name and description of this collection."
      submitText="Save Changes"
      successMessage="Collection updated"
      defaultValues={{ name: displayCollection.name, description: displayCollection.description || '' }}
      onSubmitAction={(data) =>
        api.PATCH('/collections/{id}', {
          params: { path: { id: displayCollection.id } },
          body: { name: data.name, description: data.description ?? null },
        })
      }
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      idPrefix={`edit-${displayCollection.id}`}
    />
  )
}
