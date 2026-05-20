import type { ItemModel, ItemTypeModel, CollectionModel, ItemCollectionModel } from '@/generated/prisma/models'

export type ItemType = ItemTypeModel

export type Item = ItemModel & {
  tags: string[]
}

export type Collection = CollectionModel & {
  itemCount: number
}

export type ItemCollection = ItemCollectionModel
