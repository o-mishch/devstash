import type { CollectionWithTypes, ItemTypeCount, LightItem } from '@/client'
import { useSession } from '@/auth/session'
import { useStats } from '@/hooks/use-stats'
import { useCollections } from '@/hooks/use-collections'
import { flattenItems, useItemsInfinite } from '@/hooks/use-items'

/** Pinned/recent lists shown on the dashboard are short, fixed glance lists across all skins. */
const PINNED_LIMIT = 5
const RECENT_LIMIT = 7

/**
 * The single data source every dashboard skin reads. Replaces the legacy RSC promise bag with
 * TanStack Query hooks: skins receive the resolved values (never their own data path), so they
 * differ only in structure/CSS. Stats are exposed as flat numbers (0 while loading) so skins read
 * `data.totalItems` directly; the route gates on `isPending` before rendering a skin, so a skin
 * never has to render a half-loaded state.
 *
 * Pinned items are derived from the `recent` list rather than a dedicated request: the Go backend
 * orders `recent` pin-first (`isPinned DESC, createdAt DESC`), so the pinned items are exactly the
 * `isPinned` rows at the top of that one cached query — no extra round-trip and no backend filter.
 * Both widgets share the query; TanStack dedupes it to a single fetch. Activity (mission-control's
 * heatmap) is fetched by that skin itself, not here, so non-mission-control loads pay nothing for it.
 */
export interface DashboardData {
  isPro: boolean
  totalItems: number
  favoriteItems: number
  totalCollections: number
  favoriteCollections: number
  distribution: ItemTypeCount[]
  collections: CollectionWithTypes[]
  collectionsPending: boolean
  collectionsError: boolean
  pinned: LightItem[]
  recent: LightItem[]
  isPending: boolean
  isError: boolean
}

export function useDashboardData(): DashboardData {
  const { data: session } = useSession()
  const stats = useStats()
  const collections = useCollections()
  const recentQuery = useItemsInfinite({ type: 'recent' })

  // Plain computations — the React Compiler (enabled in web/) memoizes these; a manual useMemo here
  // would be dead indirection. None needs referential identity: the consumers are plain components.
  const recentItems = flattenItems(recentQuery.data)
  const pinned = recentItems.filter((item) => item.isPinned).slice(0, PINNED_LIMIT)
  const recent = recentItems.slice(0, RECENT_LIMIT)

  const s = stats.data

  return {
    isPro: session?.user.isPro ?? false,
    totalItems: s?.totalItems ?? 0,
    favoriteItems: s?.favoriteItems ?? 0,
    totalCollections: s?.totalCollections ?? 0,
    favoriteCollections: s?.favoriteCollections ?? 0,
    distribution: s?.itemTypeCounts ?? [],
    collections: collections.data ?? [],
    collectionsPending: collections.isPending,
    collectionsError: collections.isError,
    pinned,
    recent,
    // The route gates the whole skin on these; collections has its own grid states inside widgets.
    isPending: stats.isPending || recentQuery.isPending,
    isError: stats.isError || recentQuery.isError,
  }
}
