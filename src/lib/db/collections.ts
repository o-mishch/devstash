import { prisma } from '@/lib/infra/prisma'
import { withDataCache, CacheTags } from '@/lib/infra/cache'
import type { CollectionWithTypes, CollectionStats, SidebarCollection } from '@/types/collection'
import type { Prisma } from '@/generated/prisma/client'

// Used only for single-record mutation returns (create/update) where the items join on one row is acceptable
export const COLLECTION_SELECT = {
  id: true,
  name: true,
  description: true,
  isFavorite: true,
  createdAt: true,
  _count: { select: { items: true } },
  items: {
    take: 20,
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

type CollectionRow = Prisma.CollectionGetPayload<{ select: typeof COLLECTION_SELECT }>

// Slim base select for list/getById reads — type counts fetched via a separate groupBy raw query
const COLLECTION_BASE_SELECT = {
  id: true,
  name: true,
  description: true,
  isFavorite: true,
  createdAt: true,
  _count: { select: { items: true } },
} as const

type CollectionBaseRow = Prisma.CollectionGetPayload<{ select: typeof COLLECTION_BASE_SELECT }>

interface CollectionTypeCount {
  collectionId: string
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
  count: number
}

function groupTypeCountsByCollection(typeCounts: CollectionTypeCount[]): Map<string, CollectionTypeCount[]> {
  const map = new Map<string, CollectionTypeCount[]>()
  for (const tc of typeCounts) {
    const arr = map.get(tc.collectionId) ?? []
    arr.push(tc)
    map.set(tc.collectionId, arr)
  }
  return map
}

const TOP_TYPES_PER_COLLECTION = 4

// Raw SQL required: Prisma groupBy cannot group across relation fields (item.itemTypeId from ItemCollection)
async function getCollectionTypeCounts(collectionIds: string[]): Promise<CollectionTypeCount[]> {
  if (collectionIds.length === 0) return []
  return prisma.$queryRaw<CollectionTypeCount[]>`
    WITH type_counts AS (
      SELECT
        ic."collectionId",
        it.id,
        it.name,
        it.icon,
        it.color,
        it."isSystem",
        COUNT(*)::int AS count
      FROM item_collections ic
      JOIN items i ON ic."itemId" = i.id
      JOIN item_types it ON i."itemTypeId" = it.id
      WHERE ic."collectionId" = ANY(${collectionIds}::text[])
      GROUP BY ic."collectionId", it.id, it.name, it.icon, it.color, it."isSystem"
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY "collectionId" ORDER BY count DESC) AS rn
      FROM type_counts
    )
    SELECT "collectionId", id, name, icon, color, "isSystem", count
    FROM ranked
    WHERE rn <= ${TOP_TYPES_PER_COLLECTION}
    ORDER BY "collectionId", count DESC
  `
}

function mapCollectionBase(col: CollectionBaseRow, typeCounts: CollectionTypeCount[]): CollectionWithTypes {
  const types = typeCounts.map(tc => ({
    id: tc.id,
    name: tc.name,
    icon: tc.icon,
    color: tc.color,
    isSystem: tc.isSystem,
  }))
  return {
    id: col.id,
    name: col.name,
    description: col.description,
    isFavorite: col.isFavorite,
    createdAt: col.createdAt,
    itemCount: col._count.items,
    dominantColor: typeCounts[0]?.color ?? null,
    types,
  }
}

export const SIDEBAR_COLLECTION_SELECT = {
  id: true,
  name: true,
  description: true,
  isFavorite: true,
  _count: { select: { items: true } },
} as const

type SidebarCollectionRow = Prisma.CollectionGetPayload<{ select: typeof SIDEBAR_COLLECTION_SELECT }>

export function mapSidebarCollection(col: SidebarCollectionRow, dominantColor: string | null = null): SidebarCollection {
  return {
    id: col.id,
    name: col.name,
    description: col.description,
    isFavorite: col.isFavorite,
    itemCount: col._count.items,
    dominantColor,
  }
}

export function mapCollection(col: CollectionRow): CollectionWithTypes {
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
    createdAt: col.createdAt,
    itemCount: col._count.items,
    dominantColor: sortedTypes[0]?.type.color ?? null,
    types: sortedTypes.slice(0, 4).map(({ type }) => type),
  }
}

export const DASHBOARD_COLLECTIONS_PREVIEW_LIMIT = 6

interface FetchCollectionsWithTypesOptions {
  limit?: number
  favoritesOnly?: boolean
}

async function fetchCollectionsWithTypes(
  userId: string,
  options: FetchCollectionsWithTypesOptions = {},
): Promise<CollectionWithTypes[]> {
  const collections = await prisma.collection.findMany({
    where: {
      userId,
      ...(options.favoritesOnly ? { isFavorite: true } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    ...(options.limit ? { take: options.limit } : {}),
    select: COLLECTION_BASE_SELECT,
  })
  if (collections.length === 0) return []
  const ids = collections.map(c => c.id)
  const typeCounts = await getCollectionTypeCounts(ids)
  const countsByCollection = groupTypeCountsByCollection(typeCounts)
  return collections.map(col => mapCollectionBase(col, countsByCollection.get(col.id) ?? []))
}

export async function getSidebarCollections(userId: string): Promise<SidebarCollection[]> {
  return withDataCache(CacheTags.sidebarCollections(userId), async () => {
    const collections = await prisma.collection.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: SIDEBAR_COLLECTION_SELECT,
    })
    if (collections.length === 0) return []
    const typeCounts = await getCollectionTypeCounts(collections.map((c) => c.id))
    const countsByCollection = groupTypeCountsByCollection(typeCounts)
    return collections.map((col) => mapSidebarCollection(col, countsByCollection.get(col.id)?.[0]?.color ?? null))
  })
}

export async function getAllCollections(userId: string): Promise<CollectionWithTypes[]> {
  return withDataCache(CacheTags.allCollections(userId), () => fetchCollectionsWithTypes(userId))
}

export async function getCollectionsPreview(
  userId: string,
  limit = DASHBOARD_COLLECTIONS_PREVIEW_LIMIT,
): Promise<CollectionWithTypes[]> {
  return withDataCache(CacheTags.collectionsPreview(userId), () => fetchCollectionsWithTypes(userId, { limit }))
}

export async function getFavoriteCollections(userId: string): Promise<CollectionWithTypes[]> {
  return withDataCache(CacheTags.favoriteCollections(userId), () => fetchCollectionsWithTypes(userId, { favoritesOnly: true }))
}

export async function getCollectionById(userId: string, collectionId: string): Promise<CollectionWithTypes | null> {
  return withDataCache(CacheTags.collectionById(userId, collectionId), async () => {
    const col = await prisma.collection.findFirst({
      where: { id: collectionId, userId },
      select: COLLECTION_BASE_SELECT,
    })
    if (!col) return null
    const typeCounts = await getCollectionTypeCounts([col.id])
    return mapCollectionBase(col, typeCounts)
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
    select: COLLECTION_SELECT,
  })
  return mapCollection(col)
}

export async function getCollectionStats(userId: string): Promise<CollectionStats> {
  return withDataCache(CacheTags.collectionStats(userId), async () => {
    const rows = await prisma.collection.groupBy({
      by: ['isFavorite'],
      where: { userId },
      _count: true,
    })
    const totalCollections = rows.reduce((sum, r) => sum + r._count, 0)
    const favoriteCollections = rows.find((r) => r.isFavorite)?._count ?? 0
    return { totalCollections, favoriteCollections }
  })
}

export interface UpdateCollectionInput {
  name?: string
  description?: string | null
  isFavorite?: boolean
}

export async function updateCollection(userId: string, collectionId: string, input: UpdateCollectionInput): Promise<CollectionWithTypes> {
  const col = await prisma.collection.update({
    where: { id: collectionId, userId },
    data: input,
    select: COLLECTION_SELECT,
  })
  return mapCollection(col)
}

export async function deleteCollection(userId: string, collectionId: string): Promise<void> {
  await prisma.collection.delete({
    where: { id: collectionId, userId },
  })
}

export async function toggleCollectionFavorite(userId: string, collectionId: string, isFavorite: boolean): Promise<boolean> {
  const result = await prisma.collection.updateMany({
    where: { id: collectionId, userId },
    data: { isFavorite },
  })
  return result.count > 0
}
