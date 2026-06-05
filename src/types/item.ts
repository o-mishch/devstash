export interface ItemType {
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
}

export interface LightItem {
  id: string
  title: string
  createdAt: Date
  itemType: ItemType
  descriptionPreview: string | null
  contentPreview: string | null
  url: string | null
  tags: string[]
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  isFavorite: boolean
  isPinned: boolean
}

/** Lazily-fetched fields loaded when the item drawer opens */
export interface ItemDetails {
  id: string
  content: string | null
  description: string | null
  language: string | null
  updatedAt: Date
  collections: { id: string; name: string }[]
}

/** LightItem merged with lazily-fetched ItemDetails — the shape used inside the item drawer */
export type FullItem = LightItem & ItemDetails

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
