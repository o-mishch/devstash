'use client'

import { useState, useCallback, useMemo, useReducer } from 'react'
import { DrawerContext } from '@/context/item-drawer-context'
import { ItemsStoreContext, itemsStoreReducer, itemsStoreInitialState, ItemsStoreActionType } from '@/context/items-store-context'
import { itemToLightItem } from '@/types/item'
import { ItemDetailDrawer } from './drawer/item-detail-drawer'
import { EditorPreloader } from '@/components/shared/editor-preloader'
import type { WithChildren } from '@/types/common'
import type { Item, LightItem } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface ItemDrawerProviderProps extends WithChildren {
  collections: CollectionWithTypes[]
}

export function ItemDrawerProvider({ children, collections }: ItemDrawerProviderProps) {
  const [storeState, dispatch] = useReducer(itemsStoreReducer, itemsStoreInitialState)
  const [open, setOpen] = useState(false)
  const [openItem, setOpenItem] = useState<LightItem | Item | null>(null)

  const openDrawer = useCallback((item: LightItem | Item) => {
    setOpenItem(item)
    setOpen(true)
  }, [])

  const handleItemSaved = useCallback((updated: Item) => {
    dispatch({ type: ItemsStoreActionType.UpdateItem, item: itemToLightItem(updated) })
  }, [dispatch])

  const handleItemDeleted = useCallback((id: string) => {
    dispatch({ type: ItemsStoreActionType.RemoveItem, id })
  }, [dispatch])

  const contextValue = useMemo(() => ({ openDrawer }), [openDrawer])
  const storeContextValue = useMemo(() => ({ state: storeState, dispatch }), [storeState, dispatch])

  return (
    <ItemsStoreContext.Provider value={storeContextValue}>
      <DrawerContext.Provider value={contextValue}>
        {children}
        <ItemDetailDrawer
          item={openItem}
          open={open}
          onOpenChange={setOpen}
          collections={collections}
          onItemSaved={handleItemSaved}
          onItemDeleted={handleItemDeleted}
        />
        <EditorPreloader />
      </DrawerContext.Provider>
    </ItemsStoreContext.Provider>
  )
}
