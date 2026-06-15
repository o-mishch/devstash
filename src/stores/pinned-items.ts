import { create } from 'zustand'
import type { LightItem } from '@/types/item'

interface PinnedOverride {
  item: LightItem
  pinned: boolean
}

interface PinnedItemsStore {
  overrides: Map<string, PinnedOverride>
  setPinnedOverride: (item: LightItem, pinned: boolean) => void
  removePinnedOverride: (id: string) => void
}

export const usePinnedItemsStore = create<PinnedItemsStore>((set) => ({
  overrides: new Map(),
  setPinnedOverride: (item, pinned) =>
    set(({ overrides }) => {
      const updated = new Map(overrides)
      updated.set(item.id, { item, pinned })
      return { overrides: updated }
    }),
  removePinnedOverride: (id) =>
    set(({ overrides }) => {
      if (!overrides.has(id)) return { overrides }
      const updated = new Map(overrides)
      updated.delete(id)
      return { overrides: updated }
    }),
}))
