'use client'

import { useCallback, useMemo, type ReactNode } from 'react'
import { z } from 'zod'
import { api } from '@/lib/api/client'
import { CollectionFormDialog } from './collection-form-dialog'
import { useLastNonNull } from '@/hooks/ui/use-last-non-null'
import { EMPTY_COLLECTION, type CollectionWithTypes } from '@/types/collection'
import { collectionFormSchema } from '@/lib/utils/validators'

type CollectionFormValues = z.input<typeof collectionFormSchema>

interface CollectionEditDialogProps {
  collection: CollectionWithTypes | null
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CollectionEditDialog({ collection: activeCollection, trigger, open, onOpenChange }: CollectionEditDialogProps) {
  const lastNonNullCollection = useLastNonNull(activeCollection)
  const displayCollection = lastNonNullCollection || EMPTY_COLLECTION

  const defaultValues = useMemo(
    () => ({ name: displayCollection.name, description: displayCollection.description || '' }),
    [displayCollection.name, displayCollection.description],
  )

  const handleSubmit = useCallback(
    (data: CollectionFormValues) =>
      api.PATCH('/collections/{id}', {
        params: { path: { id: displayCollection.id } },
        body: { name: data.name, description: data.description ?? null },
      }),
    [displayCollection.id],
  )

  return (
    <CollectionFormDialog
      title="Edit Collection"
      description="Update the name and description of this collection."
      submitText="Save Changes"
      successMessage="Collection updated"
      defaultValues={defaultValues}
      onSubmitAction={handleSubmit}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      idPrefix={`edit-${displayCollection.id}`}
    />
  )
}
