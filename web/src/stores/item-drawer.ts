import { create } from 'zustand'
import type { LightItem } from '@/client'

// UI-only state for the item detail drawer: which item is open (null = closed). The item's
// heavy data (full content, description, collections) is fetched by the drawer from TanStack
// Query on open — only the lightweight selected row lives here.
interface ItemDrawerState {
  item: LightItem | null
  openDrawer: (item: LightItem) => void
  // Patch the open item in place (e.g. after a favorite/pinned toggle) so the drawer reflects the
  // change immediately — the row's favorite/pinned flags live on this snapshot, not the detail query.
  patchItem: (patch: Partial<LightItem>) => void
  closeDrawer: () => void
}

export const useItemDrawerStore = create<ItemDrawerState>((set) => ({
  item: null,
  openDrawer: (item): void => set({ item }),
  patchItem: (patch): void => set((s) => (s.item ? { item: { ...s.item, ...patch } } : s)),
  closeDrawer: (): void => set({ item: null }),
}))
