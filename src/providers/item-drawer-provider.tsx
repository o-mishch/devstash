'use client'

import { useState, useCallback, useMemo, useReducer, useRef } from 'react'
import { DrawerContext } from '@/context/item-drawer-context'
import { ItemsStoreContext, itemsStoreReducer, itemsStoreInitialState, ItemsStoreActionType } from '@/context/items-store-context'
import { itemToLightItem } from '@/types/item'
import { ItemDetailDrawer } from '@/components/items/drawer/item-detail-drawer'
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
  const fullItemCache = useRef<Map<string, Item>>(new Map())

  const openDrawer = useCallback((item: LightItem | Item) => {
    const cached = fullItemCache.current.get(item.id)
    setOpenItem(cached ?? item)
    setOpen(true)
  }, [])

  const handleFullItemFetched = useCallback((item: Item) => {
    fullItemCache.current.set(item.id, item)
  }, [])

  const handleItemSaved = useCallback((updated: Item) => {
    fullItemCache.current.set(updated.id, updated)
    dispatch({ type: ItemsStoreActionType.UpdateItem, item: itemToLightItem(updated) })
  }, [dispatch])

  const handleItemDeleted = useCallback((id: string) => {
    fullItemCache.current.delete(id)
    dispatch({ type: ItemsStoreActionType.RemoveItem, id })
  }, [dispatch])

  const closeDrawer = useCallback(() => {
    setOpen(false)
  }, [])

  const contextValue = useMemo(() => ({ openDrawer, closeDrawer }), [openDrawer, closeDrawer])
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
          onFullItemFetched={handleFullItemFetched}
          onItemSaved={handleItemSaved}
          onItemDeleted={handleItemDeleted}
        />
        <EditorPreloader />
      </DrawerContext.Provider>
    </ItemsStoreContext.Provider>
  )
}
