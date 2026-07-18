import { z } from 'zod'

// The two panes of the /favorites page.
export const FAVORITES_TABS = ['items', 'collections'] as const
export type FavoritesTab = (typeof FAVORITES_TABS)[number]
export const DEFAULT_FAVORITES_TAB: FavoritesTab = 'items'

export const FAVORITES_TAB_LABELS: Record<FavoritesTab, string> = {
  items: 'Items',
  collections: 'Collections',
}

// Search-param schema: an unknown `?tab=` collapses to the default rather than erroring.
export const favoritesTabSchema = z
  .object({
    tab: z.preprocess(
      (value) => (FAVORITES_TABS.some((t) => t === value) ? value : DEFAULT_FAVORITES_TAB),
      z.enum(FAVORITES_TABS),
    ),
  })
  .partial()

/** Narrow an arbitrary value to a known favorites tab, falling back to the default. */
export function toFavoritesTab(value: unknown): FavoritesTab {
  return FAVORITES_TABS.find((t) => t === value) ?? DEFAULT_FAVORITES_TAB
}
