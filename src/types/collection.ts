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

/** Empty placeholder used as a fallback while a real collection loads/closes (see `useLastNonNull`). */
export const EMPTY_COLLECTION: CollectionWithTypes = {
  id: '',
  name: '',
  description: '',
  isFavorite: false,
  createdAt: new Date(),
  itemCount: 0,
  dominantColor: null,
  types: [],
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
