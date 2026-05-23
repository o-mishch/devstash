import { prisma } from '@/lib/prisma'
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


export async function getPinnedItems(userId: string): Promise<DashboardItem[]> {
  const items = await prisma.item.findMany({
    where: { userId, isPinned: true },
    orderBy: { updatedAt: 'desc' },
    include: ITEM_INCLUDE,
  })
  return items.map(toDashboardItem)
}

export async function getRecentItems(userId: string, limit = 10): Promise<DashboardItem[]> {
  const items = await prisma.item.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: ITEM_INCLUDE,
  })
  return items.map(toDashboardItem)
}

export interface SidebarItemType {
  id: string
  name: string
  icon: string
  color: string
  count: number
}

const SYSTEM_TYPE_ORDER = ['snippet', 'prompt', 'command', 'note', 'file', 'image', 'link']

export async function getSidebarItemTypes(userId: string): Promise<SidebarItemType[]> {
  const types = await prisma.itemType.findMany({
    where: { isSystem: true, userId: null },
    include: {
      _count: {
        select: { items: { where: { userId } } },
      },
    },
  })
  const mapped = types.map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    color: t.color,
    count: t._count.items,
  }))
  return mapped.sort(
    (a, b) => SYSTEM_TYPE_ORDER.indexOf(a.name) - SYSTEM_TYPE_ORDER.indexOf(b.name)
  )
}

export async function getItemStats(userId: string): Promise<ItemStats> {
  const [totalItems, favoriteItems] = await Promise.all([
    prisma.item.count({ where: { userId } }),
    prisma.item.count({ where: { userId, isFavorite: true } }),
  ])
  return { totalItems, favoriteItems }
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
