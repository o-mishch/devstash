'use client'

import { type ReactNode } from 'react'
import { patch } from '@/lib/api/api-fetch'
import { CollectionFormDialog } from './collection-form-dialog'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionEditDialogProps {
  collection: CollectionWithTypes
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CollectionEditDialog({ collection, trigger, open, onOpenChange }: CollectionEditDialogProps) {
  return (
    <CollectionFormDialog
      title="Edit Collection"
      description="Update the name and description of this collection."
      submitText="Save Changes"
      successMessage="Collection updated"
      defaultValues={{ name: collection.name, description: collection.description || '' }}
      onSubmitAction={async (data) => patch<CollectionWithTypes>(`/api/collections/${collection.id}`, { name: data.name, description: data.description ?? null })}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      idPrefix={`edit-${collection.id}`}
    />
  )
}
