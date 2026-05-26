import { revalidateTag } from 'next/cache'

export const CACHE_TAGS = {
  items: 'items',
  collections: 'collections',
  itemTypes: 'item-types',
} as const

export function invalidateItemsCache() {
  revalidateTag(CACHE_TAGS.items, 'default')
}

export function invalidateCollectionsCache() {
  revalidateTag(CACHE_TAGS.collections, 'default')
}
