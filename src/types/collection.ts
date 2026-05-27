import type { ItemType } from './item'

export interface CollectionWithTypes {
  id: string
  name: string
  description: string | null
  isFavorite: boolean
  defaultTypeId: string | null
  createdAt: Date
  updatedAt: Date
  itemCount: number
  dominantColor: string | null
  types: ItemType[]
}

export interface CollectionStats {
  totalCollections: number
  favoriteCollections: number
}
