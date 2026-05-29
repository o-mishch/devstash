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
  content: string | null
  url: string | null
  description: string | null
  language: string | null
  fileName: string | null
  fileSize: number | null
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
  fileUrl: string | null
  collections: ItemDetailCollection[]
}

export interface SidebarItemType {
  id: string
  name: string
  icon: string
  color: string
  count: number
}
