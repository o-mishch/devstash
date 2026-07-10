'use client'

import { type ComponentProps, type ReactNode, useCallback, useMemo } from 'react'
import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api/client'
import { useUserProfile } from '@/hooks/profile/use-user-profile'
import { type MorphOrigin } from '@/components/ui/responsive-form-dialog'
import { CollectionFormDialog } from './collection-form-dialog'

interface CreatedCollection {
  id: string
  name: string
}

// Fully static — no props/state dependency — so it's hoisted once at module scope rather than
// recreated (or useMemo'd) per render of the standalone, uncontrolled usage.
const DEFAULT_TRIGGER = (
  <Button variant="outline" size="sm" className="hidden sm:flex">
    <FolderPlus className="size-4" />
    New Collection
  </Button>
)

interface CollectionCreateDialogProps {
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Prefills the name field (e.g. a Brain Dump source name). Empty string = blank.
  defaultName?: string
  // Fired with the created collection on success (for callers that auto-select it).
  onCreated?: (collection: CreatedCollection) => void
  // Desktop morph origin for a controlled open — the dialog grows out of the element that opened it.
  morphOrigin?: MorphOrigin | null
  // Lift above an open drawer/dialog (z-50) and dim it. Defaults on: this dialog is routinely launched
  // from inside the item drawer / item-create dialog's collection picker, and it's harmless standalone.
  elevated?: boolean
}

export function CollectionCreateDialog({ trigger, open, onOpenChange, defaultName, onCreated, morphOrigin, elevated = true }: CollectionCreateDialogProps) {
  const { data: profile } = useUserProfile()
  const canCreateCollection = profile?.canCreateCollection ?? true
  // A controlled (parent-driven `open`) usage drives the dialog itself and needs no built-in button; only
  // inject the default "New Collection" trigger for the standalone, uncontrolled usage.
  const triggerEl = trigger ?? (open === undefined ? DEFAULT_TRIGGER : undefined)

  const defaultValues = useMemo(() => ({ name: defaultName ?? '', description: '' }), [defaultName])

  // Typed off CollectionFormDialog's own prop (not an inlined object type) so it stays in sync with
  // whatever FormValues shape the form dialog expects.
  const onSubmitAction: ComponentProps<typeof CollectionFormDialog>['onSubmitAction'] = useCallback(
    (data) => api.POST('/collections', { body: { name: data.name, description: data.description ?? null } }),
    [],
  )

  return (
    <CollectionFormDialog
      title="Create Collection"
      description="Organize your items into a new collection."
      submitText="Create Collection"
      successMessage="Collection created"
      defaultValues={defaultValues}
      onSubmitAction={onSubmitAction}
      trigger={triggerEl}
      open={open}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      morphOrigin={morphOrigin}
      elevated={elevated}
      canCreate={canCreateCollection}
      isCreate
    />
  )
}
