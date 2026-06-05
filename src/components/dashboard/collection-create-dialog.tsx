'use client'

import { type ReactNode } from 'react'
import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createCollectionAction } from '@/actions/collections'
import { CollectionFormDialog } from './collection-form-dialog'

interface CollectionCreateDialogProps {
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  canCreate?: boolean
}

export function CollectionCreateDialog({ trigger, open, onOpenChange, canCreate = true }: CollectionCreateDialogProps) {
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
      onSubmitAction={async (data) => createCollectionAction({ name: data.name, description: data.description ?? null })}
      trigger={triggerEl}
      open={open}
      onOpenChange={onOpenChange}
      canCreate={canCreate}
    />
  )
}
