'use client'

import { createContext, useContext } from 'react'
import type { LightItem, FullItem } from '@/types/item'

interface DrawerContextValue {
  openDrawer: (item: LightItem | FullItem) => void
  closeDrawer: () => void
  isPro: boolean
}

const DrawerContext = createContext<DrawerContextValue>({
  openDrawer: () => {},
  closeDrawer: () => {},
  isPro: false,
})

export { DrawerContext }

export function useItemDrawer() {
  return useContext(DrawerContext)
}
