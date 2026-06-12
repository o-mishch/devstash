import { create } from 'zustand'
import type { LightItem } from '@/types/item'

interface ItemsStore {
  items: Map<string, LightItem>
  updateItem: (item: LightItem) => void
  removeItem: (id: string) => void
}

export const useItemsStore = create<ItemsStore>((set) => ({
  items: new Map(),
  updateItem: (item: LightItem) => {
    set(({ items }) => {
      const updated = new Map(items)
      updated.set(item.id, item)
      return { items: updated }
    })
  },
  removeItem: (id: string) => {
    set(({ items }) => {
      const updated = new Map(items)
      updated.delete(id)
      return { items: updated }
    })
  },
}))
