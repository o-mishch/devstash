'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { CollectionWithTypes } from '@/types/collection'
import { CollectionEditDialog } from './collection-edit-dialog'
import { CollectionDeleteDialog } from './collection-delete-dialog'

interface CollectionDialogContextValue {
  openEdit: (collection: CollectionWithTypes) => void
  openDelete: (collection: CollectionWithTypes) => void
}

const CollectionDialogContext = createContext<CollectionDialogContextValue | null>(null)

export function useCollectionDialogs() {
  const ctx = useContext(CollectionDialogContext)
  if (!ctx) throw new Error('useCollectionDialogs must be used within CollectionDialogProvider')
  return ctx
}

export function CollectionDialogProvider({ children }: { children: ReactNode }) {
  const [editCollection, setEditCollection] = useState<CollectionWithTypes | null>(null)
  const [deleteCollection, setDeleteCollection] = useState<CollectionWithTypes | null>(null)

  return (
    <CollectionDialogContext.Provider
      value={{
        openEdit: setEditCollection,
        openDelete: setDeleteCollection,
      }}
    >
      {children}
      {editCollection && (
        <CollectionEditDialog
          collection={editCollection}
          open={!!editCollection}
          onOpenChange={(open) => !open && setEditCollection(null)}
        />
      )}
      {deleteCollection && (
        <CollectionDeleteDialog
          collection={deleteCollection}
          open={!!deleteCollection}
          onOpenChange={(open) => !open && setDeleteCollection(null)}
        />
      )}
    </CollectionDialogContext.Provider>
  )
}
