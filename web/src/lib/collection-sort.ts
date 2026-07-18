import { z } from 'zod'
import type { CollectionWithTypes } from '@/client'

// The four sort orders offered on the /collections index, mirroring the legacy app's dropdown.
export const COLLECTION_SORTS = ['recent', 'oldest', 'az', 'za'] as const
export type CollectionSort = (typeof COLLECTION_SORTS)[number]
export const DEFAULT_COLLECTION_SORT: CollectionSort = 'recent'

export const COLLECTION_SORT_LABELS: Record<CollectionSort, string> = {
  recent: 'Recently updated',
  oldest: 'Oldest first',
  az: 'Name (A–Z)',
  za: 'Name (Z–A)',
}

// Search-param schema: an unknown/garbage `?sort=` collapses to the default rather than erroring.
export const collectionSortSchema = z
  .object({
    sort: z.preprocess(
      (value) => (COLLECTION_SORTS.some((s) => s === value) ? value : DEFAULT_COLLECTION_SORT),
      z.enum(COLLECTION_SORTS),
    ),
  })
  .partial()

/** Narrow an arbitrary Select value to a known sort, falling back to the default. */
export function toCollectionSort(value: unknown): CollectionSort {
  return COLLECTION_SORTS.find((s) => s === value) ?? DEFAULT_COLLECTION_SORT
}

/**
 * `recent` keeps the server's order verbatim (favorites first, then most-recently-updated — the
 * list arrives that way and `updatedAt` isn't in the payload to re-derive it). The other three
 * re-sort the full set client-side by the fields we do have (`createdAt`, `name`).
 */
export function sortCollections(
  collections: CollectionWithTypes[],
  sort: CollectionSort,
): CollectionWithTypes[] {
  if (sort === 'oldest') {
    return collections.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  if (sort === 'az') {
    return collections.toSorted((a, b) => a.name.localeCompare(b.name))
  }
  if (sort === 'za') {
    return collections.toSorted((a, b) => b.name.localeCompare(a.name))
  }
  return collections
}
