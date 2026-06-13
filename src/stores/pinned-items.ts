import { create } from 'zustand'
import type { LightItem } from '@/types/item'

interface PinnedOverride {
  item: LightItem
  pinned: boolean
}

interface PinnedItemsStore {
  overrides: Map<string, PinnedOverride>
  setPinnedOverride: (item: LightItem, pinned: boolean) => void
}

export const usePinnedItemsStore = create<PinnedItemsStore>((set) => ({
  overrides: new Map(),
  setPinnedOverride: (item, pinned) =>
    set(({ overrides }) => {
      const updated = new Map(overrides)
      updated.set(item.id, { item, pinned })
      return { overrides: updated }
    }),
}))
