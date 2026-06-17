import { create } from 'zustand'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionDialogsStore {
  editCollection: CollectionWithTypes | null
  deleteCollection: CollectionWithTypes | null
  openEdit: (collection: CollectionWithTypes) => void
  openDelete: (collection: CollectionWithTypes) => void
  closeEdit: () => void
  closeDelete: () => void
}

export const useCollectionDialogsStore = create<CollectionDialogsStore>((set) => ({
  editCollection: null,
  deleteCollection: null,
  openEdit: (editCollection) => set({ editCollection }),
  openDelete: (deleteCollection) => set({ deleteCollection }),
  closeEdit: () => set({ editCollection: null }),
  closeDelete: () => set({ deleteCollection: null }),
}))
