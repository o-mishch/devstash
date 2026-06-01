'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useResizable } from '@/hooks/use-resizable'
import { apiFetch } from '@/lib/api-fetch'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import type { Item, LightItem } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface ItemDetailDrawerProps {
  item: LightItem | Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
  collections: CollectionWithTypes[]
  onItemSaved: (item: Item) => void
  onItemDeleted: (id: string) => void
}

function ItemDetailDrawerInner({
  item,
  collections,
  onOpenChange,
  onItemSaved,
  onItemDeleted,
}: Omit<ItemDetailDrawerProps, 'open'>) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savedItem, setSavedItem] = useState<Item | null>(null)
  const [fullItem, setFullItem] = useState<Item | null>(null)

  const itemId = item?.id ?? null
  const propIsLight = item !== null && !('content' in item)

  // Fetch the full item in the background when opened with a LightItem
  useEffect(() => {
    if (!itemId || !propIsLight) return

    const controller = new AbortController()

    apiFetch<Item>(`/api/items/${itemId}`).then((result) => {
      if (!controller.signal.aborted && result.status === 'ok' && result.data) {
        setFullItem(result.data)
      }
    })

    return () => controller.abort()
  }, [itemId, propIsLight])

  const displayItem = savedItem ?? fullItem ?? item
  const isLight = displayItem !== null && !('content' in displayItem)
  const editing = editingItemId !== null && editingItemId === displayItem?.id && !isLight

  return (
    <>
      <SheetTitle className="sr-only">{displayItem?.title ?? 'Item details'}</SheetTitle>

      {!displayItem ? (
        <DrawerSkeleton />
      ) : editing ? (
        <ItemDrawerEditContent
          item={displayItem as Item}
          collections={collections}
          onClose={() => onOpenChange(false)}
          onSave={(updated: Item) => {
            setSavedItem(updated)
            setEditingItemId(null)
            onItemSaved(updated)
          }}
          onCancel={() => setEditingItemId(null)}
        />
      ) : (
        <ItemDrawerViewContent
          item={displayItem}
          isLight={isLight}
          onClose={() => onOpenChange(false)}
          onEdit={() => !isLight && setEditingItemId(displayItem.id)}
          onDeleted={() => {
            onItemDeleted(displayItem.id)
            onOpenChange(false)
          }}
        />
      )}
    </>
  )
}

export function ItemDetailDrawer({
  item,
  open,
  onOpenChange,
  collections,
  onItemSaved,
  onItemDeleted,
}: ItemDetailDrawerProps) {
  const { width, dragging, startResize } = useResizable({ defaultWidth: 560 })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0"
        style={{ width, maxWidth: 'none' }}
        showCloseButton={false}
      >
        <div
          className={`absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors ${dragging ? 'bg-primary/40' : 'hover:bg-primary/30'}`}
          onMouseDown={startResize}
        />

        {item && (
          <ItemDetailDrawerInner
            key={item.id}
            item={item}
            collections={collections}
            onOpenChange={onOpenChange}
            onItemSaved={onItemSaved}
            onItemDeleted={onItemDeleted}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
