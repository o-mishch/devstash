import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { clampLimit } from '@/lib/utils'

const RECENT_COLLECTIONS_LIMIT = 50

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
  types: Array<{ id: string; name: string; icon: string; color: string; isSystem: boolean }>
}

const COLLECTION_INCLUDE = {
  items: {
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
  const typeCounts = new Map<string, { count: number; type: { id: string; name: string; icon: string; color: string; isSystem: boolean } }>()

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

export async function getRecentCollections(userId: string, limit = 6): Promise<CollectionWithTypes[]> {
  const collections = await prisma.collection.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: clampLimit(limit, 1, RECENT_COLLECTIONS_LIMIT),
    include: COLLECTION_INCLUDE,
  })
  return collections.map(mapCollection)
}

export async function getAllCollections(userId: string): Promise<CollectionWithTypes[]> {
  const collections = await prisma.collection.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: COLLECTION_INCLUDE,
  })
  return collections.map(mapCollection)
}

// TODO: Replace with real session lookup once NextAuth is configured
export async function getCurrentUserId(): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email: 'demo@devstash.io' },
    select: { id: true },
  })
  return user?.id ?? null
}
