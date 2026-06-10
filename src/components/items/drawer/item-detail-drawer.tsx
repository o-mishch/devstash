'use client'

import { useState, useEffect, useRef } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useResizable } from '@/hooks/use-resizable'
import { apiFetch } from '@/lib/api/api-fetch'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import { ITEM_TYPES_WITH_CONTENT } from '@/lib/utils/constants'
import type { LightItem, FullItem, ItemDetails, ItemContent } from '@/types/item'
import { isFullItem } from '@/types/item'
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

function mergeDrawerItem(
  base: LightItem | FullItem,
  details: ItemDetails | null,
  content: ItemContent | null,
): LightItem | FullItem {
  if (!details) return base
  return {
    ...base,
    ...details,
    content: content?.content ?? ('content' in base ? base.content : null),
    language: content?.language ?? ('language' in base ? base.language : null),
  }
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
  const [details, setDetails] = useState<ItemDetails | null>(() =>
    item && isFullItem(item)
      ? { description: item.description, updatedAt: item.updatedAt, collections: item.collections }
      : null
  )
  const [content, setContent] = useState<ItemContent | null>(() =>
    item && isFullItem(item) && ITEM_TYPES_WITH_CONTENT.has(item.itemType.name)
      ? { content: item.content, language: item.language }
      : null
  )

  const itemId = item?.id ?? null
  const needsDetailsFetch = item !== null && !isFullItem(item)
  const needsContent = item !== null && ITEM_TYPES_WITH_CONTENT.has(item.itemType.name) && !isFullItem(item)
  // Ref guard: fires fetch exactly once per item mount, even under React StrictMode double-invoke
  const hasFetched = useRef(false)

  useEffect(() => {
    if (!itemId || !needsDetailsFetch || hasFetched.current) return
    hasFetched.current = true

    apiFetch<ItemDetails>(`/api/items/${itemId}/details`).then((result) => {
      if (result.status === 'ok' && result.data) setDetails(result.data)
    })

    if (needsContent) {
      apiFetch<ItemContent>(`/api/items/${itemId}/content`).then((result) => {
        if (result.status === 'ok' && result.data) setContent(result.data)
      })
    }
  }, [itemId, needsDetailsFetch, needsContent])

  useEffect(() => {
    if (!item || !details) return
    const merged = mergeDrawerItem(item, details, content) as FullItem
    if (content || !ITEM_TYPES_WITH_CONTENT.has(item.itemType.name)) {
      onFullItemFetched(merged)
    }
  }, [item, details, content, onFullItemFetched])

  const displayItem = savedItem ?? (item && details ? mergeDrawerItem(item, details, content) : item)
  const detailsLoaded = Boolean(details) || Boolean(savedItem) || (item !== null && isFullItem(item))
  const contentLoaded =
    !item ||
    !ITEM_TYPES_WITH_CONTENT.has(item.itemType.name) ||
    Boolean(content) ||
    Boolean(savedItem) ||
    (item !== null && isFullItem(item))
  const isLight = !detailsLoaded
  const contentLoading = detailsLoaded && !contentLoaded
  const editing = editingItemId !== null && editingItemId === displayItem?.id && contentLoaded

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
          contentLoading={contentLoading}
          onClose={() => onOpenChange(false)}
          onEdit={() => contentLoaded && setEditingItemId(displayItem.id)}
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
