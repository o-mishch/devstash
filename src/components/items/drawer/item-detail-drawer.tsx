'use client'

import { useState, useEffect } from 'react'
import { SheetTitle } from '@/components/ui/sheet'
import { $api } from '@/lib/api/client'
import { DrawerShell } from './drawer-shell'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import { ITEM_TYPES_WITH_CONTENT } from '@/lib/utils/constants'
import type { LightItem, FullItem, ItemDetails, ItemContent } from '@/types/item'
import { isFullItem } from '@/types/item'

interface ItemDetailDrawerProps {
  item: LightItem | FullItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onFullItemFetched: (item: FullItem) => void
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

interface ItemDetailDrawerInnerProps extends Omit<ItemDetailDrawerProps, 'open'> {
  sheetCloseRef: { current: (() => void) | null }
}

function ItemDetailDrawerInner({
  item,
  onOpenChange,
  onFullItemFetched,
  sheetCloseRef,
}: ItemDetailDrawerInnerProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savedItem, setSavedItem] = useState<FullItem | null>(null)

  const itemId = item?.id ?? null
  const needsDetailsFetch = item !== null && !isFullItem(item)
  const needsContent = item !== null && ITEM_TYPES_WITH_CONTENT.has(item.itemType.name) && !isFullItem(item)

  const { data: fetchedDetails } = $api.useQuery(
    'get',
    '/items/{id}/details',
    { params: { path: { id: itemId ?? '' } } },
    { enabled: needsDetailsFetch && itemId !== null },
  )

  const { data: fetchedContent } = $api.useQuery(
    'get',
    '/items/{id}/content',
    { params: { path: { id: itemId ?? '' } } },
    { enabled: needsContent && itemId !== null },
  )

  const { data: collections = [] } = $api.useQuery(
    'get',
    '/collections',
    {},
    { enabled: editingItemId !== null },
  )

  const initialDetails: ItemDetails | null =
    item && isFullItem(item)
      ? { description: item.description, updatedAt: item.updatedAt, collections: item.collections }
      : null
  const initialContent: ItemContent | null =
    item && isFullItem(item) && ITEM_TYPES_WITH_CONTENT.has(item.itemType.name)
      ? { content: item.content, language: item.language }
      : null

  const details = fetchedDetails ?? initialDetails
  const content = fetchedContent ?? initialContent

  const mergedItem = item && details ? mergeDrawerItem(item, details, content) : item

  useEffect(() => {
    // Once a save has produced `savedItem`, useUpdateItem has already seeded all three detail caches with
    // the persisted item — re-seeding here would clobber them with a stale `mergedItem`, which is still
    // built from the pre-save base `item` (notably its old `itemType` on a live type change). Skip.
    if (savedItem) return
    if (!item || !details || !mergedItem) return
    if (content || !ITEM_TYPES_WITH_CONTENT.has(item.itemType.name)) {
      onFullItemFetched(mergedItem as FullItem)
    }
  }, [item, savedItem, details, content, mergedItem, onFullItemFetched])

  const displayItem = savedItem ?? mergedItem
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

  let body
  if (!displayItem) {
    body = <DrawerSkeleton />
  } else if (editing) {
    body = (
      <ItemDrawerEditContent
        item={displayItem as FullItem}
        collections={collections}
        onClose={() => onOpenChange(false)}
        onSave={(updated: FullItem) => {
          setSavedItem(updated)
          setEditingItemId(null)
        }}
        onCancel={() => setEditingItemId(null)}
        sheetCloseRef={sheetCloseRef}
      />
    )
  } else {
    body = (
      <ItemDrawerViewContent
        item={displayItem}
        isLight={isLight}
        contentLoading={contentLoading}
        onClose={() => onOpenChange(false)}
        onEdit={() => contentLoaded && setEditingItemId(displayItem.id)}
        onDeleted={() => onOpenChange(false)}
        sheetCloseRef={sheetCloseRef}
        onAiResultSaved={(updated) => setSavedItem(updated)}
      />
    )
  }

  return (
    <>
      <SheetTitle className="sr-only">{displayItem?.title ?? 'Item details'}</SheetTitle>
      {body}
    </>
  )
}

export function ItemDetailDrawer({
  item,
  open,
  onOpenChange,
  onFullItemFetched,
}: ItemDetailDrawerProps) {
  // The Sheet shell (resize, swipe-to-dismiss, grab handle, editor-fullscreen gate, and the close-ref
  // plumbing that routes Esc/backdrop/swipe through the body's dirty guard) is shared with the Brain
  // Dump draft drawer via DrawerShell. Only the body differs.
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange}>
      {(sheetCloseRef) =>
        item ? (
          <ItemDetailDrawerInner
            key={item.id}
            item={item}
            onOpenChange={onOpenChange}
            onFullItemFetched={onFullItemFetched}
            sheetCloseRef={sheetCloseRef}
          />
        ) : (
          <>
            <SheetTitle className="sr-only">Loading…</SheetTitle>
            <DrawerSkeleton />
          </>
        )
      }
    </DrawerShell>
  )
}

