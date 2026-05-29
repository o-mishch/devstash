'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useResizable } from '@/hooks/use-resizable'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import type { Item } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface ItemDetailDrawerProps {
  item: Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
  collections: CollectionWithTypes[]
}

export function ItemDetailDrawer({ item, open, onOpenChange, collections }: ItemDetailDrawerProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savedItem, setSavedItem] = useState<Item | null>(null)
  const { width, dragging, startResize } = useResizable({ defaultWidth: 560 })

  useEffect(() => { setSavedItem(null) }, [item?.id])

  const displayItem = savedItem ?? item
  const editing = editingItemId !== null && editingItemId === displayItem?.id

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
            item={displayItem}
            collections={collections}
            onClose={() => onOpenChange(false)}
            onSave={(updated: Item) => { setSavedItem(updated); setEditingItemId(null) }}
            onCancel={() => setEditingItemId(null)}
          />
        ) : (
          <ItemDrawerViewContent
            item={displayItem}
            onClose={() => onOpenChange(false)}
            onEdit={() => setEditingItemId(displayItem?.id ?? null)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
