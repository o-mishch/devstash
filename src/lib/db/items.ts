import { prisma } from '@/lib/prisma'
import { withDataCache, CacheTags } from '@/lib/cache'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, ITEMS_PAGE_SIZE, compareBySystemTypeOrder } from '@/lib/utils/constants'
import type { FullItem, ItemDetails, ItemStats, SidebarItemType, LightItem, ItemsPage } from '@/types/item'
import { Prisma } from '@/generated/prisma/client'

const ITEM_SELECT = {
  id: true,
  title: true,
  content: true,
  fileUrl: true,
  fileName: true,
  fileSize: true,
  url: true,
  description: true,
  isFavorite: true,
  isPinned: true,
  language: true,
  createdAt: true,
  updatedAt: true,
  itemType: { select: { id: true, name: true, icon: true, color: true, isSystem: true } },
  tags: { select: { name: true } },
  collections: { select: { collection: { select: { id: true, name: true } } } },
} as const

type ItemWithRelations = Prisma.ItemGetPayload<{ select: typeof ITEM_SELECT }>

export const LIGHT_ITEM_SELECT = {
  id: true,
  title: true,
  createdAt: true,
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

interface ItemPreview {
  id: string
  descriptionPreview: string | null
  contentPreview: string | null
}

interface RawItemPreviewRow {
  id: string
  description_preview?: string
  content_preview?: string
}

export async function fetchItemPreviews(ids: string[]): Promise<Map<string, ItemPreview>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.$queryRaw<RawItemPreviewRow[]>`
    SELECT id, LEFT(description, 150) AS description_preview, LEFT(content, 150) AS content_preview
    FROM items
    WHERE id IN (${Prisma.join(ids)})
  `
  return new Map(rows.map((r) => [
    r.id,
    {
      id: r.id,
      descriptionPreview: r.description_preview || null,
      contentPreview: r.content_preview || null,
    }
  ]))
}

function mapBaseItemFields(item: LightItemWithRelations) {
  return {
    url: item.url,
    tags: item.tags.map((t) => t.name),
    fileUrl: item.fileUrl,
    fileName: item.fileName,
    fileSize: item.fileSize,
    isFavorite: item.isFavorite,
    isPinned: item.isPinned,
  }
}

export function toLightItem(item: LightItemWithRelations, preview?: ItemPreview): LightItem {
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    itemType: item.itemType,
    descriptionPreview: preview?.descriptionPreview ?? null,
    contentPreview: preview?.contentPreview ?? null,
    ...mapBaseItemFields(item),
  }
}

const PINNED_LIMIT = 20

export async function getPinnedItems(userId: string, limit = PINNED_LIMIT): Promise<LightItem[]> {
  return withDataCache(CacheTags.pinnedItems(userId), async () => {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), PINNED_LIMIT)
    const [items, previewRows] = await Promise.all([
      prisma.item.findMany({
        where: { userId, isPinned: true },
        orderBy: { updatedAt: 'desc' },
        take: safeLimit,
        select: LIGHT_ITEM_SELECT,
      }),
      prisma.$queryRaw<RawItemPreviewRow[]>`
        SELECT id, LEFT(description, 150) AS description_preview
        FROM items WHERE "userId" = ${userId} AND "isPinned" = true
        ORDER BY "updatedAt" DESC
        LIMIT ${safeLimit}
      `,
    ])
    const previews = new Map(previewRows.map((r) => [
      r.id,
      {
        id: r.id,
        descriptionPreview: r.description_preview || null,
        contentPreview: null,
      }
    ]))
    return items.map((i) => toLightItem(i, previews.get(i.id)))
  })
}


export async function getItemStats(userId: string): Promise<ItemStats> {
  return withDataCache(CacheTags.itemStats(userId), async () => {
    const rows = await prisma.item.groupBy({
      by: ['isFavorite'],
      where: { userId },
      _count: true,
    })
    const totalItems = rows.reduce((sum, r) => sum + r._count, 0)
    const favoriteItems = rows.find((r) => r.isFavorite)?._count ?? 0
    return { totalItems, favoriteItems }
  })
}

export async function getItemById(userId: string, itemId: string): Promise<FullItem | null> {
  return withDataCache(CacheTags.itemById(userId, itemId), async () => {
    const item = await prisma.item.findFirst({
      where: { id: itemId, userId },
      select: ITEM_SELECT,
    })
    if (!item) return null
    return toFullItem(item)
  })
}

export const ITEM_DETAILS_SELECT = {
  id: true,
  content: true,
  description: true,
  language: true,
  updatedAt: true,
  collections: { select: { collection: { select: { id: true, name: true } } } },
} as const

export async function getItemDetails(userId: string, itemId: string): Promise<ItemDetails | null> {
  return withDataCache(CacheTags.itemById(userId, itemId), async () => {
    const row = await prisma.item.findUnique({
      where: { id: itemId, userId },
      select: ITEM_DETAILS_SELECT,
    })
    if (!row) return null

    return {
      ...row,
      collections: row.collections.map((ic) => ic.collection),
    }
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

export async function createItem(userId: string, data: CreateItemInput): Promise<LightItem | null> {
  // system types are cached for 1h — avoids a DB round trip on every item creation
  const systemTypes = await getSystemItemTypes()
  const itemType =
    systemTypes.find((t) => t.name === data.itemTypeName) ??
    (await prisma.itemType.findFirst({ where: { name: data.itemTypeName, userId } }))

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
    select: LIGHT_ITEM_SELECT,
  })

  const preview = {
    id: created.id,
    contentPreview: data.content ? data.content.slice(0, 150) : null,
    descriptionPreview: data.description ? data.description.slice(0, 150) : null,
  }
  return toLightItem(created, preview)
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

export async function updateItem(userId: string, itemId: string, data: UpdateItemInput): Promise<FullItem | null> {
  const validCollectionIds = data.collectionIds.length > 0
    ? await prisma.collection.findMany({ where: { id: { in: data.collectionIds }, userId }, select: { id: true } }).then(rows => rows.map(r => r.id))
    : []

  try {
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
      select: ITEM_SELECT,
    })
    return toFullItem(updated)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return null
    throw error
  }
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

  async function loadPage(c?: string): Promise<ItemsPage> {
    const rows = c
      ? await prisma.item.findMany({ ...query, skip: 1, cursor: { id: c } })
      : await prisma.item.findMany(query)
    const hasMore = rows.length > ITEMS_PAGE_SIZE
    const page = rows.slice(0, ITEMS_PAGE_SIZE)
    const previews = await fetchItemPreviews(page.map((r) => r.id))
    return {
      items: page.map((r) => toLightItem(r, previews.get(r.id))),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    }
  }

  return cursor ? loadPage(cursor) : withDataCache(cacheKey, () => loadPage())
}

export async function getRecentItemsPage(userId: string, cursor?: string): Promise<ItemsPage> {
  return getPaginatedItems({ userId }, CacheTags.recentItems(userId), cursor)
}

export async function getItemsByTypePage(userId: string, typeName: string, cursor?: string): Promise<ItemsPage> {
  return getPaginatedItems({ userId, itemType: { name: typeName } }, CacheTags.itemsByType(userId, typeName), cursor)
}

export async function getItemCountByType(userId: string, itemTypeId: string): Promise<number> {
  return withDataCache(CacheTags.itemsByType(userId, `${itemTypeId}:count`), () =>
    prisma.item.count({ where: { userId, itemTypeId } })
  )
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
      select: { id: true, name: true, icon: true, color: true, isSystem: true },
    })
  })
}

async function getSystemItemTypes() {
  return withDataCache(CacheTags.systemItemTypes(), async () => {
    const types = await prisma.itemType.findMany({
      where: { isSystem: true, userId: null },
      select: { id: true, name: true, icon: true, color: true, isSystem: true },
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

function toFullItem(item: ItemWithRelations): FullItem {
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    itemType: item.itemType,
    contentPreview: item.content ? item.content.slice(0, 150) : null,
    descriptionPreview: item.description ? item.description.slice(0, 150) : null,
    ...mapBaseItemFields(item),
    content: item.content,
    description: item.description,
    language: item.language,
    collections: item.collections.map((ic) => ic.collection),
  }
}

function buildTagsConnectOrCreate(tags: string[]) {
  return tags.map((name) => ({
    where: { name },
    create: { name },
  }))
}
