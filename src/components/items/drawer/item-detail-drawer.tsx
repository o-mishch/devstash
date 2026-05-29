'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { apiFetch } from '@/lib/api-fetch'
import { useResizable } from '@/hooks/use-resizable'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import type { ItemDetail } from '@/types/item'

interface ItemDetailDrawerProps {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ItemDetailDrawer({ itemId, open, onOpenChange }: ItemDetailDrawerProps) {
  const [item, setItem] = useState<ItemDetail | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const { width, dragging, startResize } = useResizable({ defaultWidth: 560 })
  
  const editing = editingItemId === itemId

  useEffect(() => {
    if (!open || !itemId) return
    apiFetch<ItemDetail>(`/api/items/${itemId}`)
      .then((res) => {
        if (res.status === 'ok' && res.data) setItem(res.data)
        else toast.error(res.message ?? 'Failed to load item')
      })
  }, [open, itemId])

  const showSkeleton = !item || item.id !== itemId

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

        <SheetTitle className="sr-only">{item?.title ?? 'Item details'}</SheetTitle>

        {showSkeleton ? (
          <DrawerSkeleton />
        ) : editing ? (
          <ItemDrawerEditContent
            item={item}
            onClose={() => onOpenChange(false)}
            onSave={(updated) => { setItem(updated); setEditingItemId(null) }}
            onCancel={() => setEditingItemId(null)}
          />
        ) : (
          <ItemDrawerViewContent
            item={item}
            onClose={() => onOpenChange(false)}
            onEdit={() => setEditingItemId(itemId)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
