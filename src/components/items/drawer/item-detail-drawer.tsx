'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { apiFetch } from '@/lib/api-fetch'
import { useResizable } from '@/hooks/use-resizable'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import type { Item, ItemDetail } from '@/types/item'

interface ItemDetailDrawerProps {
  item: Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ItemDetailDrawer({ item, open, onOpenChange }: ItemDetailDrawerProps) {
  const [fullItem, setFullItem] = useState<ItemDetail | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const { width, dragging, startResize } = useResizable({ defaultWidth: 560 })

  const itemId = item?.id ?? null

  useEffect(() => {
    if (!open || !itemId) return
    setFullItem(null)
    apiFetch<ItemDetail>(`/api/items/${itemId}`)
      .then((res) => {
        if (res.status === 'ok' && res.data) setFullItem(res.data)
        else toast.error(res.message ?? 'Failed to load item')
      })
  }, [open, itemId])

  // Build a shell ItemDetail from the Item we already have so the drawer
  // renders instantly. fileUrl and collections are the only fields missing.
  const shellItem: ItemDetail | null = item
    ? { ...item, fileUrl: null, collections: [] }
    : null

  const resolvedFullItem = fullItem?.id === itemId ? fullItem : null
  const displayItem = resolvedFullItem ?? shellItem
  const isLoadingDetail = !resolvedFullItem

  const editing = editingItemId === itemId

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

        <SheetTitle className="sr-only">{displayItem?.title ?? 'Item details'}</SheetTitle>

        {!displayItem ? (
          <DrawerSkeleton />
        ) : editing ? (
          <ItemDrawerEditContent
            item={resolvedFullItem ?? displayItem}
            onClose={() => onOpenChange(false)}
            onSave={(updated) => { setFullItem(updated); setEditingItemId(null) }}
            onCancel={() => setEditingItemId(null)}
          />
        ) : (
          <ItemDrawerViewContent
            item={displayItem}
            isLoadingDetail={isLoadingDetail}
            onClose={() => onOpenChange(false)}
            onEdit={() => setEditingItemId(itemId)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
