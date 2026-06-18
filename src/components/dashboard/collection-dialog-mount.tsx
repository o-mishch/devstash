'use client'

import { useEffect } from 'react'
import { useCollectionDialogsStore } from '@/stores/collection-dialogs'
import { CollectionEditDialog } from './collection-edit-dialog'
import { CollectionDeleteDialog } from './collection-delete-dialog'

/** Mounts collection edit/delete dialogs driven by the Zustand store. */
export function CollectionDialogMount() {
  const editCollection = useCollectionDialogsStore((s) => s.editCollection)
  const deleteCollection = useCollectionDialogsStore((s) => s.deleteCollection)
  const closeEdit = useCollectionDialogsStore((s) => s.closeEdit)
  const closeDelete = useCollectionDialogsStore((s) => s.closeDelete)

  // The store is a module global; clear it when this mount unmounts (navigating away from the
  // collections page) so returning later doesn't immediately re-open a dialog with stale collection
  // data.
  useEffect(() => () => {
    closeEdit()
    closeDelete()
  }, [closeEdit, closeDelete])

  return (
    <>
      <CollectionEditDialog
        collection={editCollection}
        open={!!editCollection}
        onOpenChange={(open) => !open && closeEdit()}
      />
      <CollectionDeleteDialog
        collection={deleteCollection}
        open={!!deleteCollection}
        onOpenChange={(open) => !open && closeDelete()}
      />
    </>
  )
}

