import { prisma } from '@/lib/prisma'
import { withDataCache, CacheTags } from '@/lib/cache'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, ITEMS_PAGE_SIZE, compareBySystemTypeOrder } from '@/lib/utils/constants'
import type { Item, ItemStats, SidebarItemType, LightItem, ItemsPage } from '@/types/item'
import type { Prisma } from '@/generated/prisma/client'

type ItemWithRelations = Prisma.ItemGetPayload<{
  include: { itemType: true; tags: true; collections: { include: { collection: { select: { id: true, name: true } } } } }
}>

const ITEM_INCLUDE = {
  itemType: true,
  tags: true,
  collections: { include: { collection: { select: { id: true, name: true } } } }
} as const

export const LIGHT_ITEM_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  description: true,
  content: true,
  url: true,
  fileName: true,
  fileSize: true,
  fileUrl: true,
  isFavorite: true,
  isPinned: true,
  itemType: { select: { id: true, name: true, icon: true, color: true, isSystem: true } },
  tags: { select: { name: true } },
} as const

type LightItemWithRelations = Prisma.ItemGetPayload<{ select: typeof LIGHT_ITEM_SELECT }>

export function toLightItem(item: LightItemWithRelations): LightItem {
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    itemType: item.itemType,
    descriptionPreview: item.description ? item.description.slice(0, 150) : null,
    contentPreview: item.content ? item.content.slice(0, 150) : null,
    url: item.url,
    tags: item.tags.map((t) => t.name),
    fileUrl: item.fileUrl,
    fileName: item.fileName,
    fileSize: item.fileSize,
    isFavorite: item.isFavorite,
    isPinned: item.isPinned,
  }
}

const PINNED_LIMIT = 20

export async function getPinnedItems(userId: string, limit = PINNED_LIMIT): Promise<Item[]> {
  return withDataCache(CacheTags.pinnedItems(userId), async () => {
    const items = await prisma.item.findMany({
      where: { userId, isPinned: true },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(Math.floor(limit), 1), PINNED_LIMIT),
      include: ITEM_INCLUDE,
    })
    return items.map(toItem)
  })
}


export async function getItemStats(userId: string): Promise<ItemStats> {
  return withDataCache(CacheTags.itemStats(userId), async () => {
    const [totalItems, favoriteItems] = await Promise.all([
      prisma.item.count({ where: { userId } }),
      prisma.item.count({ where: { userId, isFavorite: true } }),
    ])
    return { totalItems, favoriteItems }
  })
}

export async function getItemById(userId: string, itemId: string): Promise<Item | null> {
  return withDataCache(CacheTags.itemById(userId, itemId), async () => {
    const item = await prisma.item.findFirst({
      where: { id: itemId, userId },
      include: ITEM_INCLUDE,
    })
    if (!item) return null
    return toItem(item)
  })
}

export interface CreateItemInput {
  title: string
  description: string | null
  content: string | null
  url: string | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  language: string | null
  tags: string[]
  itemTypeName: string
  collectionIds: string[]
}

export async function createItem(userId: string, data: CreateItemInput): Promise<Item | null> {
  const itemType = await prisma.itemType.findFirst({
    where: { name: data.itemTypeName, OR: [{ userId }, { userId: null }] },
  })
  
  if (!itemType) return null

  let contentType: 'TEXT' | 'FILE' | 'URL' = 'TEXT'
  if (ITEM_TYPES_WITH_URL.has(data.itemTypeName)) contentType = 'URL'
  else if (ITEM_TYPES_WITH_FILE.has(data.itemTypeName)) contentType = 'FILE'

  const validCollectionIds = data.collectionIds.length > 0
    ? await prisma.collection.findMany({ where: { id: { in: data.collectionIds }, userId }, select: { id: true } }).then(rows => rows.map(r => r.id))
    : []

  const created = await prisma.item.create({
    data: {
      userId,
      itemTypeId: itemType.id,
      title: data.title,
      contentType,
      description: data.description,
      content: data.content,
      url: data.url,
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      fileSize: data.fileSize,
      language: data.language,
      tags: {
        connectOrCreate: buildTagsConnectOrCreate(data.tags),
      },
      collections: {
        create: validCollectionIds.map(id => ({
          collection: { connect: { id } }
        }))
      }
    },
    include: ITEM_INCLUDE,
  })

  return toItem(created)
}

export interface UpdateItemInput {
  title: string
  description: string | null
  content: string | null
  url: string | null
  language: string | null
  tags: string[]
  collectionIds: string[]
}

export async function updateItem(userId: string, itemId: string, data: UpdateItemInput): Promise<Item | null> {
  const ownership = await prisma.item.findFirst({ where: { id: itemId, userId }, select: { id: true } })
  if (!ownership) return null

  const validCollectionIds = data.collectionIds.length > 0
    ? await prisma.collection.findMany({ where: { id: { in: data.collectionIds }, userId }, select: { id: true } }).then(rows => rows.map(r => r.id))
    : []

  const updated = await prisma.item.update({
    where: { id: itemId, userId },
    data: {
      title: data.title,
      description: data.description,
      content: data.content,
      url: data.url,
      language: data.language,
      tags: {
        set: [],
        connectOrCreate: buildTagsConnectOrCreate(data.tags),
      },
      collections: {
        deleteMany: {},
        create: validCollectionIds.map(id => ({
          collection: { connect: { id } }
        }))
      }
    },
    include: ITEM_INCLUDE,
  })

  return toItem(updated)
}

export async function deleteItem(userId: string, itemId: string): Promise<boolean> {
  const result = await prisma.item.deleteMany({
    where: { id: itemId, userId },
  })
  return result.count > 0
}

export async function toggleItemFavorite(userId: string, itemId: string, isFavorite: boolean): Promise<boolean> {
  const result = await prisma.item.updateMany({
    where: { id: itemId, userId },
    data: { isFavorite },
  })
  return result.count > 0
}

export async function toggleItemPinned(userId: string, itemId: string, isPinned: boolean): Promise<boolean> {
  const result = await prisma.item.updateMany({
    where: { id: itemId, userId },
    data: { isPinned },
  })
  return result.count > 0
}

async function getPaginatedItems(
  where: Prisma.ItemWhereInput,
  cacheKey: import('@/lib/cache').DataCacheConfig,
  cursor?: string,
  orderBy: Prisma.ItemOrderByWithRelationInput[] = [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
): Promise<ItemsPage> {
  const take = ITEMS_PAGE_SIZE + 1
  const query = { where, orderBy, take, select: LIGHT_ITEM_SELECT }

  const rows = cursor
    ? await prisma.item.findMany({ ...query, skip: 1, cursor: { id: cursor } })
    : await withDataCache(cacheKey, () => prisma.item.findMany(query))

  const hasMore = rows.length > ITEMS_PAGE_SIZE
  const page = rows.slice(0, ITEMS_PAGE_SIZE)
  return { items: page.map(toLightItem), nextCursor: hasMore ? page[page.length - 1].id : null, hasMore }
}

export async function getRecentItemsPage(userId: string, cursor?: string): Promise<ItemsPage> {
  return getPaginatedItems({ userId }, CacheTags.recentItems(userId), cursor)
}

export async function getItemsByTypePage(userId: string, typeName: string, cursor?: string): Promise<ItemsPage> {
  return getPaginatedItems({ userId, itemType: { name: typeName } }, CacheTags.itemsByType(userId, typeName), cursor)
}

export async function getItemsByCollectionPage(userId: string, collectionId: string, cursor?: string): Promise<ItemsPage> {
  return getPaginatedItems({ userId, collections: { some: { collectionId } } }, CacheTags.itemsByCollection(userId, collectionId), cursor)
}

export async function getFavoriteItemTypeCounts(userId: string): Promise<Record<string, number>> {
  return withDataCache(CacheTags.favoriteItemTypeCounts(userId), async () => {
    const rows = await prisma.item.groupBy({
      by: ['itemTypeId'],
      where: { userId, isFavorite: true },
      _count: true,
    })
    return Object.fromEntries(rows.map((r) => [r.itemTypeId, r._count]))
  })
}

export async function getFavoriteItemsPage(userId: string, cursor?: string): Promise<ItemsPage> {
  return getPaginatedItems(
    { userId, isFavorite: true },
    CacheTags.favoriteItems(userId),
    cursor,
    [{ updatedAt: 'desc' }, { id: 'desc' }]
  )
}

export async function getItemTypeBySlug(slug: string) {
  return withDataCache(CacheTags.itemTypeBySlug(slug), () => {
    const candidates = [slug]
    if (slug.endsWith('ies')) candidates.push(slug.slice(0, -3) + 'y')
    if (slug.endsWith('es')) candidates.push(slug.slice(0, -2))
    if (slug.endsWith('s')) candidates.push(slug.slice(0, -1))

    return prisma.itemType.findFirst({
      where: { name: { in: candidates } },
    })
  })
}

async function getSystemItemTypes() {
  return withDataCache(CacheTags.systemItemTypes(), async () => {
    const types = await prisma.itemType.findMany({
      where: { isSystem: true, userId: null }
    })
    return types.sort(compareBySystemTypeOrder)
  })
}

export async function getSidebarItemTypes(userId: string | null): Promise<SidebarItemType[]> {
  const types = await getSystemItemTypes()

  if (!userId) {
    return types.map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      color: t.color,
      count: 0,
    }))
  }

  return withDataCache(CacheTags.sidebarTypes(userId), async () => {
    const typeCounts = await prisma.item.groupBy({
      by: ['itemTypeId'],
      where: { userId },
      _count: true,
    })

    const countMap = new Map(typeCounts.map((tc) => [tc.itemTypeId, tc._count]))

    return types.map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      color: t.color,
      count: countMap.get(t.id) || 0,
    }))
  })
}

function toItem(item: ItemWithRelations): Item {
  return {
    id: item.id,
    title: item.title,
    contentType: item.contentType,
    content: item.content,
    url: item.url,
    description: item.description,
    language: item.language,
    fileName: item.fileName,
    fileSize: item.fileSize,
    isFavorite: item.isFavorite,
    isPinned: item.isPinned,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    itemType: item.itemType,
    fileUrl: item.fileUrl,
    tags: item.tags.map((t) => t.name),
    collections: item.collections.map((ic) => ic.collection),
  }
}

function buildTagsConnectOrCreate(tags: string[]) {
  return tags.map((name) => ({
    where: { name },
    create: { name },
  }))
}
