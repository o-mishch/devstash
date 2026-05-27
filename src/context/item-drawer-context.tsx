'use client'

import { createContext, useContext } from 'react'

interface ItemDrawerContextValue {
  openDrawer: (itemId: string) => void
}

export const ItemDrawerContext = createContext<ItemDrawerContextValue>({
  openDrawer: () => {},
})

export function useItemDrawer() {
  return useContext(ItemDrawerContext)
}
