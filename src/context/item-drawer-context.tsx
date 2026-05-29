'use client'

import { createContext, useContext } from 'react'
import type { Item } from '@/types/item'

interface ItemDrawerContextValue {
  openDrawer: (item: Item) => void
}

export const ItemDrawerContext = createContext<ItemDrawerContextValue>({
  openDrawer: () => {},
})

export function useItemDrawer() {
  return useContext(ItemDrawerContext)
}
