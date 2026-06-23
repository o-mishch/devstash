'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useFetchItemDetail } from '@/hooks/use-item-detail'
import { useItemDrawerStore } from '@/stores/item-drawer'

// Opens an item's detail drawer from a deep-link (`?item=<id>`). Fetches the item and pops the drawer;
// the URL param persists while the drawer is open and is cleared when the drawer closes (via
// ItemDrawerUrlSync in the provider).
//
// Intent is derived from the STORE, not a private "already handled" ref: open whenever the URL names an
// item the drawer isn't already showing. A ref guard is wrong here because Next caches the page segment
// (`staleTimes.dynamic`), so on browser Back→forward this component is reused — not remounted — and a
// ref stuck on the last id would short-circuit a repeat click of the same deep-link, leaving the drawer
// shut. Comparing against the live `selectedItemId` self-heals across cached remounts and reopens.
export function ItemDeepLink() {
  const searchParams = useSearchParams()
  const fetchItemDetail = useFetchItemDetail()
  const openDrawer = useItemDrawerStore((state) => state.openDrawer)
  const selectedItemId = useItemDrawerStore((state) => state.selectedItemId)
  const isOpen = useItemDrawerStore((state) => state.isOpen)
  const itemId = searchParams.get('item')
  // Track the id whose fetch is in flight so a re-render mid-fetch doesn't fire a second request.
  const fetchingId = useRef<string | null>(null)
  // Track the previous open state so we can recognise the close-transient (open→closed) below.
  const prevIsOpen = useRef(isOpen)

  useEffect(() => {
    const wasOpen = prevIsOpen.current
    prevIsOpen.current = isOpen

    // Nothing to open, or the drawer already shows this item — leave it be.
    if (!itemId || (isOpen && selectedItemId === itemId) || fetchingId.current === itemId) return

    // Close-transient guard: the drawer just went open→closed, but clearing `?item` from the URL is an
    // async `router.replace` (ItemDrawerUrlSync) that lands a frame later. During that gap the stale
    // `?item` is NOT an open-intent — re-opening from it flickers the drawer back open until the URL
    // settles and closes it again. Skip; once the param clears this effect re-runs with no item to open.
    if (wasOpen && !isOpen) return
    fetchingId.current = itemId
    let cancelled = false
    void (async () => {
      // Cached fetch (TanStack ensureQueryData) — a repeat deep-link to the same item skips the backend.
      const item = await fetchItemDetail(itemId)
      if (cancelled) return
      if (item) {
        openDrawer(item)
      } else {
        // Foreign/deleted/invalid id (IDOR-scoped 404) — tell the user instead of silently no-opping.
        toast.error('That item is no longer available.')
      }
    })()
    return () => {
      cancelled = true
      // Release the in-flight marker on teardown. In dev Strict Mode the effect mounts → tears down →
      // remounts; clearing here lets the surviving remount re-fetch instead of being blocked by a marker
      // the cancelled run set. The store guard above still prevents a redundant open once the drawer is up.
      if (fetchingId.current === itemId) fetchingId.current = null
    }
  }, [itemId, isOpen, selectedItemId, openDrawer, fetchItemDetail])

  return null
}
