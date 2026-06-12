import { create } from 'zustand'
import type { LightItem, FullItem } from '@/types/item'

interface ItemDrawerStore {
  isOpen: boolean
  selectedItemId: string | null
  item: LightItem | FullItem | null
  openDrawer: (item: LightItem | FullItem) => void
  closeDrawer: () => void
  setItem: (item: FullItem) => void
}

export const useItemDrawerStore = create<ItemDrawerStore>((set) => ({
  isOpen: false,
  selectedItemId: null,
  item: null,
  openDrawer: (item: LightItem | FullItem) => set({ isOpen: true, selectedItemId: item.id, item }),
  closeDrawer: () => set({ isOpen: false, selectedItemId: null, item: null }),
  setItem: (item: FullItem) => set({ item }),
}))
