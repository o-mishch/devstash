'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useItemDrawerStore } from '@/stores/item-drawer'

// Opens an item's detail drawer from a deep-link (`?item=<id>`) — the target of the Brain Dump source
// link. Fetches the item once, pops the drawer, then strips the param so a refresh/back doesn't re-open
// it. A ref guards against re-fetching the same id across renders.
export function ItemDeepLink() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const openDrawer = useItemDrawerStore((state) => state.openDrawer)
  const itemId = searchParams.get('item')
  const handledId = useRef<string | null>(null)

  useEffect(() => {
    if (!itemId || handledId.current === itemId) return
    handledId.current = itemId
    let cancelled = false
    void (async () => {
      const { data } = await api.GET('/items/{id}', { params: { path: { id: itemId } } })
      if (cancelled) return
      if (data) {
        openDrawer(data)
      } else {
        // Foreign/deleted/invalid id (IDOR-scoped 404) — tell the user instead of silently no-opping.
        toast.error('That item is no longer available.')
      }
      // Strip only the `item` param so the URL is clean (a missing item doesn't keep retrying) while
      // any other query state on the page is preserved.
      const next = new URLSearchParams(searchParams)
      next.delete('item')
      const query = next.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    })()
    return () => {
      cancelled = true
    }
  }, [itemId, openDrawer, router, pathname, searchParams])

  return null
}
