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
  // ISO date-time string — fetched from the API as a string (no client-side Date coercion) and
  // only ever rendered via formatDate(Date | string). §6.4 Option A.
  createdAt: string
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

/** Fetched on drawer open — only what LightItem doesn't already carry */
export interface ItemDetails {
  description: string | null
  // ISO date-time string — see LightItem.createdAt (§6.4 Option A).
  updatedAt: string
  collections: { id: string; name: string }[]
}

/** Returned by PATCH /api/items/[id] — superset of ItemDetails with all mutable fields */
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

/** Per-system-type item counts for the dashboard skins' type-distribution viz. Always includes
 * every system type (count 0 when none), ordered by SYSTEM_TYPE_ORDER. */
export interface ItemTypeDistribution {
  name: string
  count: number
}

/** One day of item-creation activity for the mission-control heatmap. Shaped to feed
 * react-activity-calendar directly (`date` as YYYY-MM-DD, `level` 0–4). */
export interface DashboardActivityDay {
  date: string
  count: number
  level: number
}

export interface SignedDownloadUrlResponse {
  url: string
  expiresAt: string
}

// Presigned PUT (not POST) — GCS S3-interop rejects x-amz-* POST policy forms.
// `key` is the server-authoritative S3 object key the URL is signed for — the client uses
// it verbatim (for item creation + cleanup) instead of parsing it out of `url`, whose path
// layout differs between virtual-host (AWS/Vercel) and path-style (GCS/MinIO) endpoints.
export interface PresignedPutCredential {
  url: string
  key: string
  contentType: string
}

export interface UploadUrlResult {
  original: PresignedPutCredential
  thumb: PresignedPutCredential | null
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
