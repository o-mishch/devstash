'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import { useItemUrlParamSync } from '@/hooks/items/use-item-url-param-sync'
import { useCacheItemDetail } from '@/hooks/items/use-item-detail'
import { useIsTouch } from '@/hooks/ui/use-is-touch'
import { ItemDetailDrawer, ItemFullScreenView } from '@/components/items/drawer/item-detail-drawer'
import { MobileDrawerHost } from '@/components/items/drawer/drawer-shared'
import type { WithChildren } from '@/types/common'
import type { LightItem, FullItem } from '@/types/item'
import type { SheetCloseRef } from '@/hooks/ui/use-register-sheet-close'

// Keeps `?item=<id>` in the URL in sync with the drawer open state (shared `useItemUrlParamSync`):
// - drawer opens (any source) → pushes `?item=<id>` so the URL is shareable/bookmarkable
// - drawer closes → clears `?item` while preserving other query params
// - page loads with `?item=<id>` → ItemDeepLink fetches and opens the drawer; URL persists until close
// - browser Back removes `?item` while the drawer is open → close the drawer (URL→store direction below),
//   so backing out of a deep-linked item returns to the prior page with the drawer dismissed.
// Must live inside a Suspense boundary because useSearchParams opts the subtree into client rendering.
function ItemDrawerUrlSync() {
  const searchParams = useSearchParams()
  const { isOpen, selectedItemId } = useItemDrawerStore()
  useItemUrlParamSync(isOpen, selectedItemId ?? '')

  // URL → store: the store→URL sync above is one-directional, so a browser Back (which pops `?item=<id>`
  // off the URL without touching the store) would otherwise leave the drawer open over the prior page.
  // Close the drawer only on a genuine *transition* — when the URL param was matching the open item and
  // then stops matching (the Back). Tracking the transition (not the bare current value) avoids closing
  // during the open transient, where the param hasn't yet caught up to a just-opened drawer.
  const urlItemId = searchParams.get('item')
  const prevMatched = useRef(false)
  useEffect(() => {
    const matched = isOpen && selectedItemId !== null && urlItemId === selectedItemId
    if (prevMatched.current && !matched && isOpen) {
      useItemDrawerStore.getState().closeDrawer()
    }
    prevMatched.current = matched
  }, [isOpen, selectedItemId, urlItemId])

  return null
}

export function ItemDrawerProvider({ children }: WithChildren) {
  const { isOpen, item: openItem, openScrollY } = useItemDrawerStore()
  const cacheItemDetail = useCacheItemDetail()
  // `useIsTouch` returns false on the server and the first client paint, then resolves after hydration.
  // So on a touch device the desktop branch renders first and swaps to the slider post-hydration — which
  // moves `children` into the slider's stable wrapper, a one-time remount on initial load (and a brief
  // desktop-Sheet mount if `?item=` is deep-linked). Accepted: it happens once at hydration, before any
  // open/close interaction; the no-remount guarantee holds for every open/close AFTER that first paint.
  const isTouch = useIsTouch()

  // Seed the shared item-detail caches once the drawer has assembled the full item from its progressive
  // /details + /content reads, so a later deep-link / preview / list-open of the same item is served from
  // cache. (Saves seed the caches in useUpdateItem; deletes drop them in useRemoveItem.)
  const handleFullItemFetched = useCallback((item: FullItem) => {
    cacheItemDetail(item)
  }, [cacheItemDetail])

  // Stable reference (no external deps — reads the store via getState()) so it can be passed to the
  // three non-memoized drawer hosts below without creating a new function identity every render.
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) useItemDrawerStore.getState().closeDrawer()
  }, [])

  // Latch the last non-null item so the closing slide keeps rendering it after the store clears `item`.
  const [paneItem, setPaneItem] = useState<LightItem | FullItem | null>(openItem)
  if (isOpen && openItem && openItem.id !== paneItem?.id) setPaneItem(openItem)

  const renderMobileBody = useCallback(
    ({ sheetCloseRef }: { sheetCloseRef: SheetCloseRef }) => (
      <ItemFullScreenView
        item={paneItem}
        onOpenChange={handleOpenChange}
        onFullItemFetched={handleFullItemFetched}
        sheetCloseRef={sheetCloseRef}
      />
    ),
    [paneItem, handleOpenChange, handleFullItemFetched],
  )

  return (
    <>
      {/* Touch: MobileDrawerHost (shared with the brain-dump draft drawer) owns the page↔item paired slide
          (page slides left, item slides in from the right) and, once settled, renders the item as document
          content so the mobile URL bar retracts. It always renders `children` from one stable slot, so the
          app page never remounts. Desktop: the page renders straight through and the right-side Sheet drawer
          handles items. */}
      {isTouch ? (
        <MobileDrawerHost
          page={children}
          open={isOpen}
          openScrollY={openScrollY}
          decoration="blobs"
          resetKey={paneItem?.id ?? null}
          onOpenChange={handleOpenChange}
          renderBody={renderMobileBody}
        />
      ) : (
        children
      )}
      <Suspense fallback={null}>
        <ItemDrawerUrlSync />
      </Suspense>
      {!isTouch && (
        <ItemDetailDrawer
          item={openItem}
          open={isOpen}
          onOpenChange={handleOpenChange}
          onFullItemFetched={handleFullItemFetched}
        />
      )}
    </>
  )
}
