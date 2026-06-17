'use client'

import { useCallback, useRef } from 'react'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useItemsStore } from '@/stores/items'
import { ItemDetailDrawer } from '@/components/items/drawer/item-detail-drawer'
import type { WithChildren } from '@/types/common'
import type { FullItem } from '@/types/item'

export function ItemDrawerProvider({ children }: WithChildren) {
  const { isOpen, item: openItem } = useItemDrawerStore()
  const { updateItem, removeItem } = useItemsStore()
  const fullItemCache = useRef<Map<string, FullItem>>(new Map())

  const handleFullItemFetched = useCallback((item: FullItem) => {
    fullItemCache.current.set(item.id, item)
  }, [])

  const handleItemSaved = useCallback((updated: FullItem) => {
    fullItemCache.current.set(updated.id, updated)
    updateItem(updated)
  }, [updateItem])

  const handleItemDeleted = useCallback((id: string) => {
    fullItemCache.current.delete(id)
    removeItem(id)
  }, [removeItem])

  return (
    <>
      {children}
      <ItemDetailDrawer
        item={openItem}
        open={isOpen}
        onOpenChange={(newOpen) => {
          if (!newOpen) useItemDrawerStore.getState().closeDrawer()
        }}
        onFullItemFetched={handleFullItemFetched}
        onItemSaved={handleItemSaved}
        onItemDeleted={handleItemDeleted}
      />
    </>
  )
}
