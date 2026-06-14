'use client'

import { type ReactNode } from 'react'
import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { post } from '@/lib/api/api-fetch'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import type { CollectionWithTypes } from '@/types/collection'
import { CollectionFormDialog } from './collection-form-dialog'

interface CollectionCreateDialogProps {
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CollectionCreateDialog({ trigger, open, onOpenChange }: CollectionCreateDialogProps) {
  const { canCreateCollection } = useAppUserFlagsStore()
  const triggerEl = trigger ?? (
    <Button variant="outline" size="sm" className="hidden sm:flex">
      <FolderPlus className="size-4" />
      New Collection
    </Button>
  )

  return (
    <CollectionFormDialog
      title="Create Collection"
      description="Organize your items into a new collection."
      submitText="Create Collection"
      successMessage="Collection created"
      defaultValues={{ name: '', description: '' }}
      onSubmitAction={async (data) => post<CollectionWithTypes>('/api/collections', { name: data.name, description: data.description ?? null })}
      trigger={triggerEl}
      open={open}
      onOpenChange={onOpenChange}
      canCreate={canCreateCollection}
    />
  )
}
