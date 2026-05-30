'use client'

import { useState, useCallback, useMemo } from 'react'
import { ItemDrawerContext } from '@/context/item-drawer-context'
import { ItemDetailDrawer } from './drawer/item-detail-drawer'
import { EditorPreloader } from '@/components/shared/editor-preloader'
import type { WithChildren } from '@/types/common'
import type { Item } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface ItemDrawerProviderProps extends WithChildren {
  collections: CollectionWithTypes[]
}

export function ItemDrawerProvider({ children, collections }: ItemDrawerProviderProps) {
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
        collections={collections}
      />
      <EditorPreloader />
    </ItemDrawerContext.Provider>
  )
}
