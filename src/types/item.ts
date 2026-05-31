export interface ItemType {
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
}

interface ItemCollection {
  id: string
  name: string
}

export interface Item {
  id: string
  title: string
  contentType: string
  content: string | null
  url: string | null
  description: string | null
  language: string | null
  fileName: string | null
  fileSize: number | null
  fileUrl: string | null
  isFavorite: boolean
  isPinned: boolean
  createdAt: Date
  updatedAt: Date
  itemType: ItemType
  tags: string[]
  collections: ItemCollection[]
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
}

export interface ItemsPage {
  items: LightItem[]
  nextCursor: string | null
  hasMore: boolean
}

export type FetchItemsQuery =
  | { type: 'recent' }
  | { type: 'type'; typeName: string }
  | { type: 'collection'; collectionId: string }

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

/** Convert a full Item to LightItem shape for store mutations and pinned list rendering */
export function itemToLightItem(item: Item): LightItem {
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    itemType: item.itemType,
    descriptionPreview: item.description ? item.description.slice(0, 150) : null,
    contentPreview: item.content ? item.content.slice(0, 150) : null,
    url: item.url,
    tags: item.tags,
    fileUrl: item.fileUrl,
    fileName: item.fileName,
    fileSize: item.fileSize,
  }
}
