import type { ItemType } from './item'

export interface CollectionWithTypes {
  id: string
  name: string
  description: string | null
  isFavorite: boolean
  createdAt: Date
  itemCount: number
  dominantColor: string | null
  types: ItemType[]
}

/** Slim shape used in the sidebar, search, and collection picker — no type chips */
export interface SidebarCollection {
  id: string
  name: string
  description: string | null
  isFavorite: boolean
  itemCount: number
  dominantColor: string | null
}

/** Minimal shape for the CollectionSelector picker */
export interface CollectionPickerItem {
  id: string
  name: string
}

export interface CollectionStats {
  totalCollections: number
  favoriteCollections: number
}
