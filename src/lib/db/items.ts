import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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

const itemInclude = { itemType: true, tags: true } as const

export function getItemIcon(iconName: string): LucideIcon | null {
  const icon = Icons[iconName as keyof typeof Icons]
  return icon != null ? (icon as unknown as LucideIcon) : null
}

export async function getPinnedItems(userId: string): Promise<DashboardItem[]> {
  const items = await prisma.item.findMany({
    where: { userId, isPinned: true },
    orderBy: { updatedAt: 'desc' },
    include: itemInclude,
  })
  return items.map(toDBItem)
}

export async function getRecentItems(userId: string, limit = 10): Promise<DashboardItem[]> {
  const items = await prisma.item.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: itemInclude,
  })
  return items.map(toDBItem)
}

export async function getItemTypeCounts(userId: string): Promise<Record<string, number>> {
  const types = await prisma.itemType.findMany({
    where: { isSystem: true },
    include: {
      _count: {
        select: { items: { where: { userId } } },
      },
    },
  })
  return Object.fromEntries(types.map((t) => [t.name, t._count.items]))
}

export async function getItemStats(userId: string): Promise<ItemStats> {
  const [totalItems, favoriteItems] = await Promise.all([
    prisma.item.count({ where: { userId } }),
    prisma.item.count({ where: { userId, isFavorite: true } }),
  ])
  return { totalItems, favoriteItems }
}

function toDBItem(item: ItemWithRelations): DashboardItem {
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
