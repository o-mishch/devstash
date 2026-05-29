import { prisma } from '@/lib/prisma'
import { withDataCache, CacheTags } from '@/lib/cache'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, SYSTEM_TYPE_ORDER } from '@/lib/utils/constants'
import type { Item, ItemStats, SidebarItemType } from '@/types/item'
import type { Prisma } from '@/generated/prisma/client'

type ItemWithRelations = Prisma.ItemGetPayload<{
  include: { itemType: true; tags: true; collections: { include: { collection: { select: { id: true, name: true } } } } }
}>

const ITEM_INCLUDE = { 
  itemType: true, 
  tags: true,
  collections: { include: { collection: { select: { id: true, name: true } } } }
} as const

const PINNED_LIMIT = 20
const RECENT_LIMIT = 100
const TYPE_LIST_LIMIT = 500

function clampLimit(value: number, min = 1, max = 100): number {
  return Math.min(Math.max(Math.floor(value), min), max)
}

export async function getPinnedItems(userId: string, limit = PINNED_LIMIT): Promise<Item[]> {
  return withDataCache(CacheTags.pinnedItems(userId), async () => {
    const items = await prisma.item.findMany({
      where: { userId, isPinned: true },
      orderBy: { updatedAt: 'desc' },
      take: clampLimit(limit, 1, PINNED_LIMIT),
      include: ITEM_INCLUDE,
    })
    return items.map(toItem)
  })
}

export async function getRecentItems(userId: string, limit = RECENT_LIMIT): Promise<Item[]> {
  return withDataCache(CacheTags.recentItems(userId), async () => {
    const items = await prisma.item.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: clampLimit(limit, 1, RECENT_LIMIT),
      include: ITEM_INCLUDE,
    })
    return items.map(toItem)
  })
}

export async function getItemsByType(userId: string, typeName: string): Promise<Item[]> {
  return withDataCache(CacheTags.itemsByType(userId, typeName), async () => {
    const items = await prisma.item.findMany({
      where: { userId, itemType: { name: typeName } },
      orderBy: { createdAt: 'desc' },
      take: TYPE_LIST_LIMIT,
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
  const item = await prisma.item.findFirst({
    where: { id: itemId, userId },
    include: ITEM_INCLUDE,
  })

  if (!item) return null

  return toItem(item)
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
    include: {
      ...ITEM_INCLUDE,
      collections: { include: { collection: { select: { id: true, name: true } } } },
    },
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
    include: {
      ...ITEM_INCLUDE,
      collections: { include: { collection: { select: { id: true, name: true } } } },
    },
  })

  return toItem(updated)
}

export async function deleteItem(userId: string, itemId: string): Promise<boolean> {
  const result = await prisma.item.deleteMany({
    where: { id: itemId, userId },
  })
  return result.count > 0
}

export async function getItemsByCollection(userId: string, collectionId: string): Promise<Item[]> {
  return withDataCache(CacheTags.itemsByCollection(userId, collectionId), async () => {
    const items = await prisma.item.findMany({
      where: { userId, collections: { some: { collectionId } } },
      orderBy: { createdAt: 'desc' },
      take: TYPE_LIST_LIMIT,
      include: ITEM_INCLUDE,
    })
    return items.map(toItem)
  })
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

export function compareBySystemTypeOrder(a: { name: string }, b: { name: string }): number {
  return SYSTEM_TYPE_ORDER.indexOf(a.name) - SYSTEM_TYPE_ORDER.indexOf(b.name)
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
