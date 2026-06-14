export interface ItemType {
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
}

/** Slim item type shape used in list/search responses — icon + color resolved client-side from constants */
export interface SlimItemType {
  name: string
}

export interface LightItem {
  id: string
  title: string
  createdAt: Date
  itemType: SlimItemType
  descriptionPreview: string | null
  contentPreview: string | null
  url: string | null
  tags: string[]
  fileName: string | null
  fileSize: number | null
  isFavorite: boolean
  isPinned: boolean
}

/** Slim shape for global search API responses */
export interface SearchResultItem {
  id: string
  title: string
  itemType: SlimItemType
  descriptionPreview: string | null
}

export function searchResultToLightItem(hit: SearchResultItem): LightItem {
  return {
    id: hit.id,
    title: hit.title,
    itemType: hit.itemType,
    descriptionPreview: hit.descriptionPreview,
    contentPreview: null,
    createdAt: new Date(0),
    url: null,
    tags: [],
    fileName: null,
    fileSize: null,
    isFavorite: false,
    isPinned: false,
  }
}

export function isSearchResultItem(item: LightItem | SearchResultItem): item is SearchResultItem {
  return !('tags' in item)
}

/** Fetched on drawer open — only what LightItem doesn't already carry */
export interface ItemDetails {
  description: string | null
  updatedAt: Date
  collections: { id: string; name: string }[]
}

/** Returned by updateItemAction — superset of ItemDetails with all mutable fields */
export interface ItemSavedDetails extends ItemDetails {
  url: string | null
  tags: string[]
  isFavorite: boolean
  isPinned: boolean
}

/** Fetched separately for content-bearing types (snippet/prompt/command/note/link) */
export interface ItemContent {
  content: string | null
  language: string | null
}

/** LightItem merged with lazily-fetched ItemDetails — the shape used inside the item drawer */
export type FullItem = LightItem & ItemDetails & ItemContent

export interface ItemsPage {
  items: LightItem[]
  nextCursor: string | null
  hasMore: boolean
}

export type FetchItemsQuery =
  | { type: 'recent' }
  | { type: 'type'; typeName: string }
  | { type: 'collection'; collectionId: string }
  | { type: 'favorites' }

export interface ItemStats {
  totalItems: number
  favoriteItems: number
}

export interface SignedDownloadUrlResponse {
  url: string
  expiresAt: string
}

export interface PresignedPostCredential {
  url: string
  fields: Record<string, string>
}

export interface UploadUrlResult {
  original: PresignedPostCredential
  thumb: PresignedPostCredential | null
  expiresAt: string
}

export interface SidebarItemType {
  id: string
  name: string
  icon: string
  color: string
  count: number
}

export function isFullItem(item: LightItem | FullItem): item is FullItem {
  return 'collections' in item
}
