'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useResizable } from '@/hooks/use-resizable'
import { apiFetch } from '@/lib/api-fetch'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import type { LightItem, FullItem, ItemDetails } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface ItemDetailDrawerProps {
  item: LightItem | FullItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  collections: CollectionWithTypes[]
  onFullItemFetched: (item: FullItem) => void
  onItemSaved: (item: FullItem) => void
  onItemDeleted: (id: string) => void
}

function ItemDetailDrawerInner({
  item,
  collections,
  onOpenChange,
  onFullItemFetched,
  onItemSaved,
  onItemDeleted,
}: Omit<ItemDetailDrawerProps, 'open'>) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savedItem, setSavedItem] = useState<FullItem | null>(null)
  const [fullItem, setFullItem] = useState<FullItem | null>(null)

  const itemId = item?.id ?? null
  const propIsLight = item !== null && !('content' in item)

  // LightItem has truncated content; fetch the remaining fields without blocking the initial render
  useEffect(() => {
    if (!itemId || !propIsLight || !item) return

    const controller = new AbortController()

    apiFetch<ItemDetails>(`/api/items/${itemId}/remain-fields`).then((result) => {
      if (!controller.signal.aborted && result.status === 'ok' && result.data) {
        const mergedItem: FullItem = { ...item, ...result.data }
        setFullItem(mergedItem)
        onFullItemFetched(mergedItem)
      }
    })

    return () => controller.abort()
  }, [itemId, propIsLight, item, onFullItemFetched])

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
          item={displayItem as FullItem}
          collections={collections}
          onClose={() => onOpenChange(false)}
          onSave={(updated: FullItem) => {
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
  onFullItemFetched,
  onItemSaved,
  onItemDeleted,
}: ItemDetailDrawerProps) {
  const { width, dragging, startResize, onMouseMove, onMouseUp } = useResizable({
    defaultWidth: 560,
    maxBoundarySelector: 'main',
    maxBoundaryGapVw: 0.1,
  })

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

        {dragging && (
          <div
            className="fixed inset-0 z-[60] cursor-ew-resize select-none"
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />
        )}

        {item && (
          <ItemDetailDrawerInner
            key={item.id}
            item={item}
            collections={collections}
            onOpenChange={onOpenChange}
            onFullItemFetched={onFullItemFetched}
            onItemSaved={onItemSaved}
            onItemDeleted={onItemDeleted}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
