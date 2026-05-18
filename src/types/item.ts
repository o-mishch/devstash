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
  contentType: 'TEXT' | 'FILE' | 'URL'
  content: string | null
  url?: string | null
  description: string | null
  isFavorite: boolean
  isPinned: boolean
  language: string | null
  itemTypeId: string
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export interface Collection {
  id: string
  name: string
  description?: string | null
  isFavorite: boolean
  itemCount: number
  createdAt: Date
  updatedAt: Date
}

export interface ItemCollection {
  itemId: string
  collectionId: string
}
