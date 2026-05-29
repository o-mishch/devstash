'use client'

import { useState, useCallback, useMemo } from 'react'
import { ItemDrawerContext } from '@/context/item-drawer-context'
import { ItemDetailDrawer } from './drawer/item-detail-drawer'
import type { WithChildren } from '@/types/common'
import type { Item } from '@/types/item'

export function ItemDrawerProvider({ children }: WithChildren) {
  const [open, setOpen] = useState(false)
  const [openItem, setOpenItem] = useState<Item | null>(null)

  const openDrawer = useCallback((item: Item) => {
    setOpenItem(item)
    setOpen(true)
  }, [])

  const contextValue = useMemo(() => ({ openDrawer }), [openDrawer])

  return (
    <ItemDrawerContext.Provider value={contextValue}>
      {children}
      <ItemDetailDrawer
        item={openItem}
        open={open}
        onOpenChange={setOpen}
      />
    </ItemDrawerContext.Provider>
  )
}
