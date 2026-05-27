export interface ItemType {
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
}

export interface Item {
  id: string
  title: string
  contentType: string
  description: string | null
  language: string | null
  isFavorite: boolean
  isPinned: boolean
  createdAt: Date
  updatedAt: Date
  itemType: ItemType
  tags: string[]
}

export interface ItemStats {
  totalItems: number
  favoriteItems: number
}

interface ItemDetailCollection {
  id: string
  name: string
}

export interface ItemDetail extends Item {
  content: string | null
  url: string | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  collections: ItemDetailCollection[]
}

export interface SidebarItemType {
  id: string
  name: string
  icon: string
  color: string
  count: number
}
