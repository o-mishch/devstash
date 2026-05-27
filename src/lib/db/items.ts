import { prisma } from '@/lib/prisma'
import { withDataCache, CacheTags } from '@/lib/cache'
import type { Item, ItemStats, SidebarItemType } from '@/types/item'
import type { Prisma } from '@/generated/prisma/client'

type ItemWithRelations = Prisma.ItemGetPayload<{
  include: { itemType: true; tags: true }
}>

const ITEM_INCLUDE = { itemType: true, tags: true } as const

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

const SYSTEM_TYPE_ORDER: string[] = ['snippet', 'prompt', 'command', 'note', 'file', 'image', 'link']

export function compareBySystemTypeOrder(a: { name: string }, b: { name: string }): number {
  return SYSTEM_TYPE_ORDER.indexOf(a.name) - SYSTEM_TYPE_ORDER.indexOf(b.name)
}

export async function getSystemItemTypes() {
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
    description: item.description,
    language: item.language,
    isFavorite: item.isFavorite,
    isPinned: item.isPinned,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    itemType: item.itemType,
    tags: item.tags.map((t) => t.name),
  }
}
