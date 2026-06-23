import { create } from 'zustand'
import type { LightItem } from '@/types/item'

export interface PinnedOverride {
  item: LightItem
  pinned: boolean
}

interface PinnedItemsStore {
  overrides: Map<string, PinnedOverride>
  setPinnedOverride: (item: LightItem, pinned: boolean) => void
  removePinnedOverride: (id: string) => void
  // Reflects an edit (e.g. a live type change) of a still-pinned item on the dashboard. Writes a
  // `pinned: true` override carrying the updated snapshot so `mergePinnedItems` renders the new data —
  // covering both items that already had an override and server-pinned items that had none yet.
  patchPinnedItem: (item: LightItem) => void
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
  patchPinnedItem: (item) =>
    set(({ overrides }) => {
      const updated = new Map(overrides)
      updated.set(item.id, { item, pinned: true })
      return { overrides: updated }
    }),
}))
