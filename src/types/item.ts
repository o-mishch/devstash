export interface ItemType {
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
}

export interface ItemCollection {
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
