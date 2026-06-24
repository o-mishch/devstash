'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// Keeps `?item=<id>` in the URL in sync with an open/close flag (a drawer or inline editor), so the URL
// is shareable/bookmarkable and a page loaded with `?item=<id>` can deep-link straight to the item.
//
// - open + id → push `?item=<id>` (only when it changed, to avoid history spam)
// - close (after having been open) → replace, clearing `?item` while preserving every other query param
//
// Uses the `next/navigation` router (the app-wide convention) rather than raw `window.history`, so the
// two former hand-rolled copies (the item drawer provider + the Brain Dump draft card) share one
// mechanism. Must be called from inside a Suspense boundary because `useSearchParams` opts the subtree
// into client rendering.
export function useItemUrlParamSync(open: boolean, id: string) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const prevOpen = useRef(open)
  const prevId = useRef(id)

  useEffect(() => {
    const wasOpen = prevOpen.current
    const previousId = prevId.current
    prevOpen.current = open
    prevId.current = id

    const next = new URLSearchParams(searchParams)

    if (open && id) {
      // Assert our param only on the open transition or when the id itself changed — never re-add it in
      // response to an external `searchParams` change (e.g. browser Back clearing `?item` while a close
      // is still in flight, or a sibling owner writing its own id). Re-pushing then would fight the
      // navigation, spam history, and let two open owners ping-pong over the param.
      const openedOrChanged = !wasOpen || previousId !== id
      if (openedOrChanged && next.get('item') !== id) {
        next.set('item', id)
        // scroll: false — this is a same-page param toggle, not a content navigation. Next's default
        // scroll-to-top would reset the list's scroll position to 0, racing the mobile slider's open
        // snapshot (capturing 0 instead of the real position) and clobbering its close-time restore.
        router.push(`${pathname}?${next.toString()}`, { scroll: false })
      }
    } else if (!open && wasOpen) {
      next.delete('item')
      const query = next.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }
  }, [open, id, pathname, router, searchParams])
}
