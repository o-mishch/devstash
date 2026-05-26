import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cache'
import type { Prisma } from '@/generated/prisma/client'

export interface DashboardItem {
  id: string
  title: string
  contentType: string
  description: string | null
  language: string | null
  isFavorite: boolean
  isPinned: boolean
  createdAt: Date
  updatedAt: Date
  itemType: { id: string; name: string; icon: string; color: string; isSystem: boolean }
  tags: string[]
}

export interface ItemStats {
  totalItems: number
  favoriteItems: number
}

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

export const getPinnedItems = unstable_cache(
  async (userId: string, limit: number = PINNED_LIMIT): Promise<DashboardItem[]> => {
    const items = await prisma.item.findMany({
      where: { userId, isPinned: true },
      orderBy: { updatedAt: 'desc' },
      take: clampLimit(limit, 1, PINNED_LIMIT),
      include: ITEM_INCLUDE,
    })
    return items.map(toDashboardItem)
  },
  ['pinned-items'],
  { revalidate: 60, tags: [CACHE_TAGS.items] }
)

export const getRecentItems = unstable_cache(
  async (userId: string, limit: number = RECENT_LIMIT): Promise<DashboardItem[]> => {
    const items = await prisma.item.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: clampLimit(limit, 1, RECENT_LIMIT),
      include: ITEM_INCLUDE,
    })
    return items.map(toDashboardItem)
  },
  ['recent-items'],
  { revalidate: 60, tags: [CACHE_TAGS.items] }
)

export const getItemsByType = unstable_cache(
  async (userId: string, typeName: string): Promise<DashboardItem[]> => {
    const items = await prisma.item.findMany({
      where: { userId, itemType: { name: typeName } },
      orderBy: { createdAt: 'desc' },
      take: TYPE_LIST_LIMIT,
      include: ITEM_INCLUDE,
    })
    return items.map(toDashboardItem)
  },
  ['items-by-type'],
  { revalidate: 60, tags: [CACHE_TAGS.items] }
)

export const getItemStats = unstable_cache(
  async (userId: string): Promise<ItemStats> => {
    const [totalItems, favoriteItems] = await Promise.all([
      prisma.item.count({ where: { userId } }),
      prisma.item.count({ where: { userId, isFavorite: true } }),
    ])
    return { totalItems, favoriteItems }
  },
  ['item-stats'],
  { revalidate: 60, tags: [CACHE_TAGS.items] }
)

export const getItemTypeBySlug = unstable_cache(
  async (slug: string) => {
    return prisma.itemType.findFirst({
      where: {
        OR: [
          { name: slug },
          { name: slug.endsWith('s') ? slug.slice(0, -1) : slug },
        ],
      },
    })
  },
  ['item-type-by-slug'],
  { revalidate: 3600, tags: [CACHE_TAGS.itemTypes] }
)

export interface SidebarItemType {
  id: string
  name: string
  icon: string
  color: string
  count: number
}

export const SYSTEM_TYPE_ORDER: string[] = ['snippet', 'prompt', 'command', 'note', 'file', 'image', 'link']

export async function getSidebarItemTypes(userId: string | null): Promise<SidebarItemType[]> {
  const types = await prisma.itemType.findMany({
    where: { isSystem: true, userId: null },
    include: userId
      ? { _count: { select: { items: { where: { userId } } } } }
      : { _count: { select: { items: true } } },
  })
  const mapped = types.map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    color: t.color,
    count: userId ? t._count.items : 0,
  }))
  return mapped.sort(
    (a, b) => SYSTEM_TYPE_ORDER.indexOf(a.name) - SYSTEM_TYPE_ORDER.indexOf(b.name)
  )
}

function toDashboardItem(item: ItemWithRelations): DashboardItem {
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
