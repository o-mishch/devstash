'use client'

import { createContext, useContext } from 'react'
import type { LightItem, FullItem } from '@/types/item'

interface DrawerContextValue {
  openDrawer: (item: LightItem | FullItem) => void
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
