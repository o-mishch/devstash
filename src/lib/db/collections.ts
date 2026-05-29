import { prisma } from '@/lib/prisma'
import { withDataCache, CacheTags } from '@/lib/cache'
import type { CollectionWithTypes, CollectionStats } from '@/types/collection'
import type { Prisma } from '@/generated/prisma/client'

const COLLECTION_INCLUDE = {
  items: {
    take: 50,
    select: {
      item: {
        select: {
          itemType: {
            select: { id: true, name: true, icon: true, color: true, isSystem: true },
          },
        },
      },
    },
  },
} as const

type CollectionRow = Prisma.CollectionGetPayload<{ include: typeof COLLECTION_INCLUDE }>

function mapCollection(col: CollectionRow): CollectionWithTypes {
  const typeCounts = new Map<string, { count: number; type: CollectionWithTypes['types'][number] }>()

  for (const ic of col.items) {
    const { itemType } = ic.item
    const existing = typeCounts.get(itemType.id)
    if (existing) {
      existing.count++
    } else {
      typeCounts.set(itemType.id, {
        count: 1,
        type: { id: itemType.id, name: itemType.name, icon: itemType.icon, color: itemType.color, isSystem: itemType.isSystem },
      })
    }
  }

  const sortedTypes = Array.from(typeCounts.values()).sort((a, b) => b.count - a.count)

  return {
    id: col.id,
    name: col.name,
    description: col.description,
    isFavorite: col.isFavorite,
    defaultTypeId: col.defaultTypeId,
    createdAt: col.createdAt,
    updatedAt: col.updatedAt,
    itemCount: col.items.length,
    dominantColor: sortedTypes[0]?.type.color ?? null,
    types: sortedTypes.slice(0, 4).map(({ type }) => type),
  }
}

export async function getAllCollections(userId: string): Promise<CollectionWithTypes[]> {
  return withDataCache(CacheTags.allCollections(userId), async () => {
    const collections = await prisma.collection.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: COLLECTION_INCLUDE,
    })
    return collections.map(mapCollection)
  })
}

export async function getCollectionById(userId: string, collectionId: string): Promise<CollectionWithTypes | null> {
  return withDataCache(CacheTags.collectionById(userId, collectionId), async () => {
    const col = await prisma.collection.findFirst({
      where: { id: collectionId, userId },
      include: COLLECTION_INCLUDE,
    })
    if (!col) return null
    return mapCollection(col)
  })
}

export interface CreateCollectionInput {
  name: string
  description?: string | null
}

export async function createCollection(userId: string, input: CreateCollectionInput): Promise<CollectionWithTypes> {
  const col = await prisma.collection.create({
    data: {
      name: input.name,
      description: input.description,
      userId,
    },
    include: COLLECTION_INCLUDE,
  })
  return mapCollection(col)
}

export async function getCollectionStats(userId: string): Promise<CollectionStats> {
  return withDataCache(CacheTags.collectionStats(userId), async () => {
    const [totalCollections, favoriteCollections] = await Promise.all([
      prisma.collection.count({ where: { userId } }),
      prisma.collection.count({ where: { userId, isFavorite: true } }),
    ])
    return { totalCollections, favoriteCollections }
  })
}
