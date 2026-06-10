import { prisma } from '@/lib/infra/prisma'
import { withDataCache, CacheTags } from '@/lib/infra/cache'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, ITEMS_PAGE_SIZE, compareBySystemTypeOrder } from '@/lib/utils/constants'
import type { FullItem, ItemDetails, ItemSavedDetails, ItemContent, ItemStats, SidebarItemType, LightItem, ItemsPage } from '@/types/item'
import { Prisma, ContentType } from '@/generated/prisma/client'

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

const LIGHT_ITEM_TYPE_SELECT = { select: { name: true } } as const

/** Mixed pages (recent, pinned, favorites, collections with text): tags, no text/file fields — text fetched separately as LEFT(col,150) */
export const LIGHT_ITEM_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  url: true,
  isFavorite: true,
  isPinned: true,
  itemType: LIGHT_ITEM_TYPE_SELECT,
  tags: { select: { name: true } },
} as const

/** File type page: fileName + fileSize only, no text preview fields */
export const LIGHT_ITEM_SELECT_FILE = {
  id: true,
  title: true,
  createdAt: true,
  fileName: true,
  fileSize: true,
  isFavorite: true,
  isPinned: true,
  itemType: LIGHT_ITEM_TYPE_SELECT,
} as const

/** Image type page: minimal — title + status only, no text or file fields */
export const LIGHT_ITEM_SELECT_IMAGE = {
  id: true,
  title: true,
  createdAt: true,
  isFavorite: true,
  isPinned: true,
  itemType: LIGHT_ITEM_TYPE_SELECT,
} as const

/** Collection pages: need file fields for FileRow + tags for ItemCard — text fetched separately as LEFT(col,150) */
export const LIGHT_ITEM_SELECT_COLLECTION = {
  id: true,
  title: true,
  createdAt: true,
  url: true,
  fileName: true,
  fileSize: true,
  isFavorite: true,
  isPinned: true,
  itemType: LIGHT_ITEM_TYPE_SELECT,
  tags: { select: { name: true } },
} as const

// Keep old export alias for callers that imported it
export interface DownloadItem {
  id: string
  fileUrl: string | null
  fileName: string | null
  updatedAt: Date
  itemType: {
    name: string
  }
}

export interface ItemAiMetadata {
  imageWidth: number | null
  imageHeight: number | null
}

function resolveLightItemSelect(typeName?: string) {
  if (typeName === 'image') return LIGHT_ITEM_SELECT_IMAGE
  if (typeName === 'file') return LIGHT_ITEM_SELECT_FILE
  return LIGHT_ITEM_SELECT
}

type AnyLightRow =
  | Prisma.ItemGetPayload<{ select: typeof LIGHT_ITEM_SELECT }>
  | Prisma.ItemGetPayload<{ select: typeof LIGHT_ITEM_SELECT_FILE }>
  | Prisma.ItemGetPayload<{ select: typeof LIGHT_ITEM_SELECT_IMAGE }>
  | Prisma.ItemGetPayload<{ select: typeof LIGHT_ITEM_SELECT_COLLECTION }>

interface TextPreview {
  dp: string | null
  cp: string | null
}

// $queryRaw needed: Prisma has no equivalent for LEFT() in SELECT;
// prevents full description/content text travelling Neon→Vercel on every list page.
async function fetchTextPreviews(ids: string[]): Promise<Map<string, TextPreview>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.$queryRaw<Array<{ id: string; dp: string | null; cp: string | null }>>`
    SELECT id, LEFT(description, 150) AS dp, LEFT(content, 150) AS cp
    FROM items WHERE id = ANY(${ids}::text[])`
  return new Map(rows.map((r) => [r.id, { dp: r.dp, cp: r.cp }]))
}

export function toLightItem(item: AnyLightRow, textPreviews = new Map<string, TextPreview>()): LightItem {
  const url = 'url' in item ? item.url : null
  const tags = 'tags' in item ? item.tags.map((t: { name: string }) => t.name) : []
  const fileName = 'fileName' in item ? item.fileName : null
  const fileSize = 'fileSize' in item ? item.fileSize : null
  const preview = textPreviews.get(item.id)

  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    itemType: item.itemType,
    descriptionPreview: preview?.dp ?? null,
    contentPreview: preview?.cp ?? null,
    url,
    tags,
    fileName,
    fileSize,
    isFavorite: item.isFavorite,
    isPinned: item.isPinned,
  }
}

const PINNED_LIMIT = 20

export async function getPinnedItems(userId: string, limit = PINNED_LIMIT): Promise<LightItem[]> {
  return withDataCache(CacheTags.pinnedItems(userId), async () => {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), PINNED_LIMIT)
    const items = await prisma.item.findMany({
      where: { userId, isPinned: true },
      orderBy: { updatedAt: 'desc' },
      take: safeLimit,
      select: LIGHT_ITEM_SELECT,
    })
    const textPreviews = await fetchTextPreviews(items.map((r) => r.id))
    return items.map((r) => toLightItem(r, textPreviews))
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

export const DOWNLOAD_ITEM_SELECT = {
  id: true,
  fileUrl: true,
  fileName: true,
  updatedAt: true,
  itemType: { select: { name: true } },
} as const

export async function getDownloadItem(userId: string, itemId: string): Promise<DownloadItem | null> {
  return withDataCache(CacheTags.downloadItem(userId, itemId), () =>
    prisma.item.findFirst({
      where: { id: itemId, userId },
      select: DOWNLOAD_ITEM_SELECT,
    })
  )
}

/** GET /details — only fields LightItem doesn't carry */
export const ITEM_DETAILS_SELECT = {
  description: true,
  updatedAt: true,
  collections: { select: { collection: { select: { id: true, name: true } } } },
} as const

/** Returned after a save — all mutable fields the client needs to patch its store */
export const ITEM_UPDATE_SELECT = {
  description: true,
  updatedAt: true,
  url: true,
  tags: { select: { name: true } },
  isFavorite: true,
  isPinned: true,
  collections: { select: { collection: { select: { id: true, name: true } } } },
} as const

/** Server-only select for mutation auth guards — never sent to the client */
export const ITEM_AUTH_SELECT = {
  id: true,
  fileUrl: true,
  fileName: true,
  itemType: { select: { name: true } },
} as const

export interface ItemAuthData {
  id: string
  fileUrl: string | null
  fileName: string | null
  itemType: { name: string }
}

export async function getItemForAuth(userId: string, itemId: string): Promise<ItemAuthData | null> {
  return prisma.item.findFirst({
    where: { id: itemId, userId },
    select: ITEM_AUTH_SELECT,
  })
}

export async function getItemAiMetadata(
  userId: string,
  itemId: string,
): Promise<ItemAiMetadata | null> {
  const row = await prisma.item.findFirst({
    where: { id: itemId, userId },
    select: { imageWidth: true, imageHeight: true },
  })
  return row ?? null
}

export const ITEM_CONTENT_SELECT = {
  content: true,
  language: true,
} as const

export async function getItemDetails(userId: string, itemId: string): Promise<ItemDetails | null> {
  return withDataCache(CacheTags.itemDetails(userId, itemId), async () => {
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

export async function getItemContent(userId: string, itemId: string): Promise<ItemContent | null> {
  return withDataCache(CacheTags.itemContent(userId, itemId), async () => {
    const row = await prisma.item.findUnique({
      where: { id: itemId, userId },
      select: ITEM_CONTENT_SELECT,
    })
    if (!row) return null
    return row
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
  imageWidth?: number | null
  imageHeight?: number | null
}

export async function createItem(userId: string, data: CreateItemInput): Promise<LightItem | null> {
  // system types are cached for 1h — avoids a DB round trip on every item creation
  const systemTypes = await getSystemItemTypes()
  const itemType =
    systemTypes.find((t) => t.name === data.itemTypeName) ??
    (await prisma.itemType.findFirst({ where: { name: data.itemTypeName, userId } }))

  if (!itemType) return null

  let contentType: ContentType = ContentType.TEXT
  if (ITEM_TYPES_WITH_URL.has(data.itemTypeName)) contentType = ContentType.URL
  else if (ITEM_TYPES_WITH_FILE.has(data.itemTypeName)) contentType = ContentType.FILE

  const validCollectionIds = await getValidCollectionIds(userId, data.collectionIds)

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
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
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

  return toLightItem(created)
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

export async function updateItem(userId: string, itemId: string, data: UpdateItemInput): Promise<ItemSavedDetails | null> {
  const validCollectionIds = await getValidCollectionIds(userId, data.collectionIds)

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
      select: ITEM_UPDATE_SELECT,
    })
    return {
      ...updated,
      tags: updated.tags.map((t: { name: string }) => t.name),
      collections: updated.collections.map((ic) => ic.collection),
    }
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
  cacheKey: import('@/lib/infra/cache').DataCacheConfig,
  cursor?: string,
  orderBy: Prisma.ItemOrderByWithRelationInput[] = [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  typeName?: string,
  selectOverride?: typeof LIGHT_ITEM_SELECT_COLLECTION,
): Promise<ItemsPage> {
  const take = ITEMS_PAGE_SIZE + 1
  const select = selectOverride ?? resolveLightItemSelect(typeName)
  const query = { where, orderBy, take, select }

  const needsTextPreviews = typeName !== 'image' && typeName !== 'file'

  async function loadPage(c?: string): Promise<ItemsPage> {
    const rows = c
      ? await prisma.item.findMany({ ...query, skip: 1, cursor: { id: c } })
      : await prisma.item.findMany(query)
    const hasMore = rows.length > ITEMS_PAGE_SIZE
    const page = rows.slice(0, ITEMS_PAGE_SIZE)
    const textPreviews = needsTextPreviews
      ? await fetchTextPreviews(page.map((r) => r.id))
      : new Map<string, TextPreview>()
    return {
      items: page.map((r) => toLightItem(r, textPreviews)),
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
  return getPaginatedItems(
    { userId, itemType: { name: typeName } },
    CacheTags.itemsByType(userId, typeName),
    cursor,
    undefined,
    typeName,
  )
}

export async function getItemCountByType(userId: string, itemTypeId: string): Promise<number> {
  return withDataCache(CacheTags.itemsByType(userId, `${itemTypeId}:count`), () =>
    prisma.item.count({ where: { userId, itemTypeId } })
  )
}

export async function getItemsByCollectionPage(userId: string, collectionId: string, cursor?: string): Promise<ItemsPage> {
  return getPaginatedItems(
    { userId, collections: { some: { collectionId } } },
    CacheTags.itemsByCollection(userId, collectionId),
    cursor,
    undefined,
    undefined,
    LIGHT_ITEM_SELECT_COLLECTION,
  )
}

export async function getFavoriteItemTypeCounts(userId: string): Promise<Record<string, number>> {
  return withDataCache(CacheTags.favoriteItemTypeCounts(userId), async () => {
    // $queryRaw needed: Prisma groupBy doesn't support grouping by relation field (item_types.name)
    const rows = await prisma.$queryRaw<Array<{ name: string; count: bigint }>>`
      SELECT it.name, COUNT(i.id)::int AS count
      FROM items i
      JOIN item_types it ON i."itemTypeId" = it.id
      WHERE i."userId" = ${userId} AND i."isFavorite" = true
      GROUP BY it.name`
    return Object.fromEntries(rows.map((r) => [r.name, Number(r.count)]))
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
    descriptionPreview: item.description ? item.description.slice(0, 150) : null,
    contentPreview: item.content ? item.content.slice(0, 150) : null,
    url: item.url,
    tags: item.tags.map((t) => t.name),
    fileName: item.fileName,
    fileSize: item.fileSize,
    isFavorite: item.isFavorite,
    isPinned: item.isPinned,
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

async function getValidCollectionIds(userId: string, collectionIds: string[]) {
  if (collectionIds.length === 0) return []
  const rows = await prisma.collection.findMany({
    where: { id: { in: collectionIds }, userId },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}
