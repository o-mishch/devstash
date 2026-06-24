import { create } from 'zustand'
import type { LightItem, FullItem } from '@/types/item'

interface ItemDrawerStore {
  isOpen: boolean
  selectedItemId: string | null
  item: LightItem | FullItem | null
  // Window scroll position captured synchronously at the open click. While the mobile item view is up the
  // window is pinned to the top (the item is the document scroller, shown from its header), so the page's
  // original window scroll is lost from the browser — Activity preserves the page's DOM but not the
  // document-level scroll value. The slider restores this on close. Captured here (not in a layout effect)
  // so it reads the real position before the open re-render pins the window. 0 on desktop (no slider reads it).
  openScrollY: number
  openDrawer: (item: LightItem | FullItem) => void
  closeDrawer: () => void
  setItem: (item: FullItem) => void
}

export const useItemDrawerStore = create<ItemDrawerStore>((set) => ({
  isOpen: false,
  selectedItemId: null,
  item: null,
  openScrollY: 0,
  openDrawer: (item: LightItem | FullItem) =>
    set({
      isOpen: true,
      selectedItemId: item.id,
      item,
      openScrollY: typeof window === 'undefined' ? 0 : window.scrollY,
    }),
  closeDrawer: () => set({ isOpen: false, selectedItemId: null, item: null }),
  setItem: (item: FullItem) => set({ item }),
}))
