'use client'

import { createContext, useContext } from 'react'
import type { Item, LightItem } from '@/types/item'

interface DrawerContextValue {
  openDrawer: (item: LightItem | Item) => void
  closeDrawer: () => void
}

const DrawerContext = createContext<DrawerContextValue>({
  openDrawer: () => {},
  closeDrawer: () => {},
})

export { DrawerContext }

export function useItemDrawer() {
  return useContext(DrawerContext)
}
