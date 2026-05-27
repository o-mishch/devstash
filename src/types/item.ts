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

export interface SidebarItemType {
  id: string
  name: string
  icon: string
  color: string
  count: number
}
