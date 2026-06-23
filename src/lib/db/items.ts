import 'server-only'

import { cacheTag, cacheLife } from 'next/cache'
import { prisma, type PrismaTransactionClient } from '@/lib/infra/prisma'
import { CacheTags } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, ITEMS_PAGE_SIZE, compareBySystemTypeOrder, remapLanguageForType } from '@/lib/utils/constants'
import type { UpdateItemInput } from '@/lib/utils/validators'
import type { FullItem, ItemDetails, ItemSavedDetails, ItemContent, ItemStats, ItemTypeDistribution, DashboardActivityDay, SidebarItemType, LightItem, ItemsPage } from '@/types/item'
import { Prisma, ContentType } from '@/generated/prisma/client'

const log = logger.child({ tag: 'db:items' })

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

/** Mixed pages (recent, pinned, favorites): tags + url + file fields (so the drawer has a file item's name/size regardless of source list), no text — text fetched separately as LEFT(col,150) */
export const LIGHT_ITEM_SELECT = {
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

/** Image type page: title + status + tags + fileName (drawer uses it as the <img> alt), no text or fileSize */
export const LIGHT_ITEM_SELECT_IMAGE = {
  id: true,
  title: true,
  createdAt: true,
  fileName: true,
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

interface LightItemRow {
  id: string
  title: string
  createdAt: Date
  url?: string | null
  fileName?: string | null
  fileSize?: number | null
  isFavorite: boolean
  isPinned: boolean
  itemType: { name: string }
  tags?: { name: string }[]
}

interface TextPreview {
  dp: string | null
  cp: string | null
}

// $queryRaw needed: Prisma has no equivalent for LEFT() in SELECT;
// prevents full description/content text travelling Neon→Vercel on every list page.
export async function fetchTextPreviews(ids: string[]): Promise<Map<string, TextPreview>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.$queryRaw<Array<{ id: string; dp: string | null; cp: string | null }>>`
    SELECT id, LEFT(description, 150) AS dp, LEFT(content, 150) AS cp
    FROM items WHERE id = ANY(${ids}::text[])`
  return new Map(rows.map((r) => [r.id, { dp: r.dp, cp: r.cp }]))
}

export function toLightItem(item: LightItemRow, textPreviews = new Map<string, TextPreview>()): LightItem {
  const url = item.url ?? null
  const tags = item.tags?.map((t) => t.name) ?? []
  const fileName = item.fileName ?? null
  const fileSize = item.fileSize ?? null
  const preview = textPreviews.get(item.id)

  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt.toISOString(),
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
  'use cache'
  const cacheKey = CacheTags.pinnedItems(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), PINNED_LIMIT)
  const items = await prisma.item.findMany({
    where: { userId, isPinned: true },
    orderBy: { updatedAt: 'desc' },
    take: safeLimit,
    select: LIGHT_ITEM_SELECT,
  })
  log.info({ userId, cacheKey, count: items.length, duration: Date.now() - start }, 'DB: getPinnedItems')
  const textPreviews = await fetchTextPreviews(items.map((r) => r.id))
  return items.map((r) => toLightItem(r, textPreviews))
}

export async function getItemStats(userId: string): Promise<ItemStats> {
  'use cache'
  const cacheKey = CacheTags.itemStats(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const rows = await prisma.item.groupBy({
    by: ['isFavorite'],
    where: { userId },
    _count: true,
  })
  const totalItems = rows.reduce((sum, r) => sum + r._count, 0)
  const favoriteItems = rows.find((r) => r.isFavorite)?._count ?? 0
  log.info({ userId, cacheKey, totalItems, favoriteItems, duration: Date.now() - start }, 'DB: getItemStats')
  return { totalItems, favoriteItems }
}

// Per-type counts for the dashboard skins' type-distribution viz. Returns every system type
// (count 0 when none) in SYSTEM_TYPE_ORDER, so callers can render a stable, ordered bar/legend.
export async function getItemTypeDistribution(userId: string): Promise<ItemTypeDistribution[]> {
  'use cache'
  const cacheKey = CacheTags.itemTypeDistribution(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const [rows, types] = await Promise.all([
    prisma.item.groupBy({ by: ['itemTypeId'], where: { userId }, _count: true }),
    getSystemItemTypes(),
  ])
  const countById = new Map(rows.map((r) => [r.itemTypeId, r._count]))
  const distribution = types.map((t) => ({ name: t.name, count: countById.get(t.id) ?? 0 }))
  log.info({ userId, cacheKey, typeCount: distribution.length, duration: Date.now() - start }, 'DB: getItemTypeDistribution')
  return distribution
}

const ACTIVITY_WINDOW_DAYS = 84 // ~12 weeks for the mission-control contribution heatmap

// Per-day item-creation counts for the last ~12 weeks, shaped for react-activity-calendar
// (contiguous days, level 0–4). Consumed only by the mission-control skin.
export async function getDashboardActivity(userId: string): Promise<DashboardActivityDay[]> {
  'use cache'
  const cacheKey = CacheTags.dashboardActivity(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  // Anchor both the SQL lower bound and the JS series to one clock (this server's `today`, as a UTC
  // calendar date) so a DB-vs-app clock skew across a UTC midnight can't drop the most-recent day.
  const today = new Date()
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const windowStart = new Date(todayUtc)
  windowStart.setUTCDate(windowStart.getUTCDate() - (ACTIVITY_WINDOW_DAYS - 1))
  const windowStartDate = toIsoDate(windowStart)
  // $queryRaw needed: Prisma groupBy cannot truncate a timestamp to a calendar day
  // (no date_trunc / ::date projection in the query builder).
  const rows = await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
    SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS count
    FROM items
    WHERE "userId" = ${userId}
      AND ("createdAt" AT TIME ZONE 'UTC')::date >= ${windowStartDate}::date
    GROUP BY day`
  const countByDate = new Map(rows.map((r) => [toIsoDate(r.day), Number(r.count)]))
  const maxCount = Math.max(0, ...countByDate.values())

  // Build a contiguous series ending today so the calendar has no gaps.
  const series: DashboardActivityDay[] = Array.from({ length: ACTIVITY_WINDOW_DAYS }, (_, i) => {
    const d = new Date(todayUtc)
    d.setUTCDate(d.getUTCDate() - (ACTIVITY_WINDOW_DAYS - 1 - i))
    const date = toIsoDate(d)
    const count = countByDate.get(date) ?? 0
    return { date, count, level: activityLevel(count, maxCount) }
  })
  log.info({ userId, cacheKey, days: series.length, maxCount, duration: Date.now() - start }, 'DB: getDashboardActivity')
  return series
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Bucket a day's count into a 0–4 intensity level relative to the busiest day in the window.
function activityLevel(count: number, maxCount: number): number {
  if (count === 0 || maxCount === 0) return 0
  return Math.min(4, Math.ceil((count / maxCount) * 4))
}

export async function getItemById(userId: string, itemId: string): Promise<FullItem | null> {
  'use cache'
  const cacheKey = CacheTags.itemById(userId, itemId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const item = await prisma.item.findFirst({
    where: { id: itemId, userId },
    select: ITEM_SELECT,
  })
  log.info({ userId, itemId, cacheKey, found: Boolean(item), duration: Date.now() - start }, 'DB: getItemById')
  if (!item) return null
  return toFullItem(item)
}

export const DOWNLOAD_ITEM_SELECT = {
  id: true,
  fileUrl: true,
  fileName: true,
  updatedAt: true,
  itemType: { select: { name: true } },
} as const

export async function getDownloadItem(userId: string, itemId: string): Promise<DownloadItem | null> {
  'use cache'
  const cacheKey = CacheTags.downloadItem(userId, itemId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const result = await prisma.item.findFirst({
    where: { id: itemId, userId },
    select: DOWNLOAD_ITEM_SELECT,
  })
  log.info({ userId, itemId, cacheKey, found: Boolean(result), duration: Date.now() - start }, 'DB: getDownloadItem')
  return result
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
  const start = Date.now()
  const result = await prisma.item.findFirst({
    where: { id: itemId, userId },
    select: ITEM_AUTH_SELECT,
  })
  log.info({ userId, itemId, found: Boolean(result), duration: Date.now() - start }, 'DB: getItemForAuth')
  return result
}

export async function getItemAiMetadata(
  userId: string,
  itemId: string,
): Promise<ItemAiMetadata | null> {
  const start = Date.now()
  const row = await prisma.item.findFirst({
    where: { id: itemId, userId },
    select: { imageWidth: true, imageHeight: true },
  })
  log.info({ userId, itemId, found: Boolean(row), duration: Date.now() - start }, 'DB: getItemAiMetadata')
  return row ?? null
}

export const ITEM_CONTENT_SELECT = {
  content: true,
  language: true,
} as const

export interface ItemExplainContext {
  itemType: string
  content: string | null
  language: string | null
}

/** Canonical content/language/type for the AI explain route — read server-side so the code is never
 * re-uploaded by the client and is always scoped to the session userId. */
export async function getItemExplainContext(userId: string, itemId: string): Promise<ItemExplainContext | null> {
  'use cache'
  cacheTag(CacheTags.itemContent(userId, itemId), CacheTags.itemGroup(userId))
  cacheLife('max')
  const row = await prisma.item.findUnique({
    where: { id: itemId, userId },
    select: { content: true, language: true, itemType: { select: { name: true } } },
  })
  if (!row) return null
  return { itemType: row.itemType.name, content: row.content, language: row.language }
}

export async function getItemDetails(userId: string, itemId: string): Promise<ItemDetails | null> {
  'use cache'
  const cacheKey = CacheTags.itemDetails(userId, itemId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const row = await prisma.item.findUnique({
    where: { id: itemId, userId },
    select: ITEM_DETAILS_SELECT,
  })
  log.info({ userId, itemId, cacheKey, found: Boolean(row), duration: Date.now() - start }, 'DB: getItemDetails')
  if (!row) return null
  return {
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    collections: row.collections.map((ic) => ic.collection),
  }
}

export async function getItemContent(userId: string, itemId: string): Promise<ItemContent | null> {
  'use cache'
  const cacheKey = CacheTags.itemContent(userId, itemId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const row = await prisma.item.findUnique({
    where: { id: itemId, userId },
    select: ITEM_CONTENT_SELECT,
  })
  log.info({ userId, itemId, cacheKey, found: Boolean(row), duration: Date.now() - start }, 'DB: getItemContent')
  if (!row) return null
  return row
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

export async function createItem(
  userId: string,
  data: CreateItemInput,
  // v2.5 atomic commit: when a caller (e.g. `commitDrafts`) needs the item creation to run inside its
  // own interactive `$transaction`, it passes that transaction client. Writes run on `tx`; the cached
  // type/collection reads stay on the module client (they don't need transactional isolation and a
  // cached `'use cache'` read can't run on `tx`). Defaults to the module `prisma` so all other callers
  // are untouched. `PrismaTransactionClient` is derived from the extended client, so both the module
  // `prisma` default and a `tx` from `prisma.$transaction(async (tx) => …)` satisfy it.
  tx: PrismaTransactionClient = prisma,
): Promise<LightItem | null> {
  const start = Date.now()
  // system types are cached for 1 day — avoids a DB round trip on every item creation
  const systemTypes = await getSystemItemTypes()
  const itemType =
    systemTypes.find((t) => t.name === data.itemTypeName) ??
    // Read on `tx` so a custom-typed create inside an interactive transaction sees its own writes and
    // stays consistent (defaults to the module client for all non-tx callers).
    (await tx.itemType.findFirst({ where: { name: data.itemTypeName, userId } }))

  if (!itemType) {
    log.warn({ userId, itemTypeName: data.itemTypeName }, 'DB: createItem: itemType not found')
    return null
  }

  let contentType: ContentType = ContentType.TEXT
  if (ITEM_TYPES_WITH_URL.has(data.itemTypeName)) contentType = ContentType.URL
  else if (ITEM_TYPES_WITH_FILE.has(data.itemTypeName)) contentType = ContentType.FILE

  const validCollectionIds = await getValidCollectionIds(userId, data.collectionIds)

  const created = await tx.item.create({
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
    select: resolveLightItemSelect(data.itemTypeName),
  })

  log.info({ userId, itemId: created.id, itemTypeName: data.itemTypeName, duration: Date.now() - start }, 'DB: createItem')
  return toLightItem(created)
}

// `UpdateItemInput` is the inferred shape of `itemMutationSchema` (the PATCH /items/{id} body) — reused
// from validators rather than re-declared so the schema stays the single source of truth (it already
// carries the v3 `itemTypeName` allow-list). Imported at the top of this module.
// Resolved target of a v3 live type change: the system ItemType id to connect + the remapped language.
interface ItemTypeChange {
  itemTypeId: string
  language: string | null
}

export async function updateItem(userId: string, itemId: string, data: UpdateItemInput): Promise<ItemSavedDetails | null> {
  const start = Date.now()
  const validCollectionIds = await getValidCollectionIds(userId, data.collectionIds)

  // v3 live type change: when a new (text) type is requested, resolve its system ItemType and patch
  // `itemTypeId`; `contentType` stays TEXT (all four are text types). The schema already allow-lists
  // itemTypeName to {snippet,prompt,command,note}; resolving against system types is the final guard.
  // Language is best-effort remapped for the new type (e.g. shell→bash on →command, cleared on →note).
  let typeChange: ItemTypeChange | null = null
  if (data.itemTypeName !== undefined) {
    const systemTypes = await getSystemItemTypes()
    const target = systemTypes.find((t) => t.name === data.itemTypeName)
    if (!target) {
      log.warn({ userId, itemId, itemTypeName: data.itemTypeName }, 'DB: updateItem: target type not found')
      return null
    }
    typeChange = { itemTypeId: target.id, language: remapLanguageForType(data.language, data.itemTypeName) }
  }

  try {
    const updated = await prisma.item.update({
      where: { id: itemId, userId },
      data: {
        title: data.title,
        description: data.description,
        content: data.content,
        url: data.url,
        // On a type change the remapped language wins over the raw client value.
        language: typeChange ? typeChange.language : data.language,
        ...(typeChange ? { itemType: { connect: { id: typeChange.itemTypeId } } } : {}),
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
    log.info({ userId, itemId, duration: Date.now() - start }, 'DB: updateItem')
    return {
      ...updated,
      updatedAt: updated.updatedAt.toISOString(),
      tags: updated.tags.map((t: { name: string }) => t.name),
      collections: updated.collections.map((ic) => ic.collection),
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      log.warn({ userId, itemId, duration: Date.now() - start }, 'DB: updateItem: not found')
      return null
    }
    throw error
  }
}

export async function deleteItem(userId: string, itemId: string): Promise<boolean> {
  const start = Date.now()
  const result = await prisma.item.deleteMany({
    where: { id: itemId, userId },
  })
  log.info({ userId, itemId, deleted: result.count > 0, duration: Date.now() - start }, 'DB: deleteItem')
  return result.count > 0
}

export async function toggleItemFavorite(userId: string, itemId: string, isFavorite: boolean): Promise<boolean> {
  const start = Date.now()
  const result = await prisma.item.updateMany({
    where: { id: itemId, userId },
    data: { isFavorite },
  })
  log.info({ userId, itemId, isFavorite, updated: result.count > 0, duration: Date.now() - start }, 'DB: toggleItemFavorite')
  return result.count > 0
}

export async function toggleItemPinned(userId: string, itemId: string, isPinned: boolean): Promise<boolean> {
  const start = Date.now()
  const result = await prisma.item.updateMany({
    where: { id: itemId, userId },
    data: { isPinned },
  })
  log.info({ userId, itemId, isPinned, updated: result.count > 0, duration: Date.now() - start }, 'DB: toggleItemPinned')
  return result.count > 0
}

const DEFAULT_ITEMS_ORDER: Prisma.ItemOrderByWithRelationInput[] = [
  { isPinned: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
]

// Pure DB loader — no caching. Used directly for cursor-based pagination and
// internally from cached first-page wrappers.
async function runPaginatedQuery(
  where: Prisma.ItemWhereInput,
  cursor?: string,
  orderBy: Prisma.ItemOrderByWithRelationInput[] = DEFAULT_ITEMS_ORDER,
  typeName?: string,
): Promise<ItemsPage> {
  const take = ITEMS_PAGE_SIZE + 1
  const select = resolveLightItemSelect(typeName)
  const needsTextPreviews = typeName !== 'image' && typeName !== 'file'
  const query = { where, orderBy, take, select }

  const start = Date.now()
  const rows = cursor
    ? await prisma.item.findMany({ ...query, skip: 1, cursor: { id: cursor } })
    : await prisma.item.findMany(query)
  const hasMore = rows.length > ITEMS_PAGE_SIZE
  const page = rows.slice(0, ITEMS_PAGE_SIZE)
  log.info({ typeName: typeName ?? 'mixed', cursor: Boolean(cursor), count: page.length, hasMore, duration: Date.now() - start }, 'DB: runPaginatedQuery')
  const textPreviews = needsTextPreviews
    ? await fetchTextPreviews(page.map((r) => r.id))
    : new Map<string, TextPreview>()
  return {
    items: page.map((r) => toLightItem(r, textPreviews)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    hasMore,
  }
}

// Cached first-page fetchers — only page 1 (no cursor) is cached.
// Cursor pages always hit DB directly via runPaginatedQuery.

async function fetchRecentItemsFirstPage(userId: string): Promise<ItemsPage> {
  'use cache'
  const cacheKey = CacheTags.recentItems(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  return runPaginatedQuery({ userId })
}

export async function getRecentItemsPage(userId: string, cursor?: string): Promise<ItemsPage> {
  if (cursor) return runPaginatedQuery({ userId }, cursor)
  return fetchRecentItemsFirstPage(userId)
}

async function fetchItemsByTypeFirstPage(userId: string, typeName: string): Promise<ItemsPage> {
  'use cache'
  const cacheKey = CacheTags.itemsByType(userId, typeName)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  return runPaginatedQuery({ userId, itemType: { name: typeName } }, undefined, undefined, typeName)
}

export async function getItemsByTypePage(userId: string, typeName: string, cursor?: string): Promise<ItemsPage> {
  if (cursor) return runPaginatedQuery({ userId, itemType: { name: typeName } }, cursor, undefined, typeName)
  return fetchItemsByTypeFirstPage(userId, typeName)
}

export async function getItemCountByType(userId: string, itemTypeId: string): Promise<number> {
  'use cache'
  const cacheKey = CacheTags.itemsByType(userId, `${itemTypeId}:count`)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const count = await prisma.item.count({ where: { userId, itemTypeId } })
  log.info({ userId, itemTypeId, cacheKey, count, duration: Date.now() - start }, 'DB: getItemCountByType')
  return count
}

async function fetchItemsByCollectionFirstPage(userId: string, collectionId: string): Promise<ItemsPage> {
  'use cache'
  const cacheKey = CacheTags.itemsByCollection(userId, collectionId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  return runPaginatedQuery({ userId, collections: { some: { collectionId } } })
}

export async function getItemsByCollectionPage(userId: string, collectionId: string, cursor?: string): Promise<ItemsPage> {
  if (cursor) return runPaginatedQuery({ userId, collections: { some: { collectionId } } }, cursor)
  return fetchItemsByCollectionFirstPage(userId, collectionId)
}

export async function getFavoriteItemTypeCounts(userId: string): Promise<Record<string, number>> {
  'use cache'
  const cacheKey = CacheTags.favoriteItemTypeCounts(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  // $queryRaw needed: Prisma groupBy doesn't support grouping by relation field (item_types.name)
  const rows = await prisma.$queryRaw<Array<{ name: string; count: bigint }>>`
    SELECT it.name, COUNT(i.id)::int AS count
    FROM items i
    JOIN item_types it ON i."itemTypeId" = it.id
    WHERE i."userId" = ${userId} AND i."isFavorite" = true
    GROUP BY it.name`
  log.info({ userId, cacheKey, typeCount: rows.length, duration: Date.now() - start }, 'DB: getFavoriteItemTypeCounts')
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.count)]))
}

async function fetchFavoriteItemsFirstPage(userId: string): Promise<ItemsPage> {
  'use cache'
  const cacheKey = CacheTags.favoriteItems(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  return runPaginatedQuery({ userId, isFavorite: true }, undefined, [{ updatedAt: 'desc' }, { id: 'desc' }])
}

export async function getFavoriteItemsPage(userId: string, cursor?: string): Promise<ItemsPage> {
  if (cursor) return runPaginatedQuery({ userId, isFavorite: true }, cursor, [{ updatedAt: 'desc' }, { id: 'desc' }])
  return fetchFavoriteItemsFirstPage(userId)
}

async function getSystemItemTypes() {
  'use cache'
  const cacheKey = CacheTags.systemItemTypes()
  cacheTag(cacheKey)
  cacheLife('days')
  const start = Date.now()
  const types = await prisma.itemType.findMany({
    where: { isSystem: true, userId: null },
    select: { id: true, name: true, icon: true, color: true, isSystem: true },
  })
  log.info({ cacheKey, count: types.length, duration: Date.now() - start }, 'DB: getSystemItemTypes')
  return types.sort(compareBySystemTypeOrder)
}

async function fetchSidebarItemTypesForUser(userId: string): Promise<SidebarItemType[]> {
  'use cache'
  const cacheKey = CacheTags.sidebarTypes(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId), CacheTags.systemItemTypes())
  cacheLife('max')
  const types = await getSystemItemTypes()
  const start = Date.now()
  const typeCounts = await prisma.item.groupBy({
    by: ['itemTypeId'],
    where: { userId },
    _count: true,
  })
  const duration = Date.now() - start
  log.info({ userId, cacheKey, typeCount: typeCounts.length, duration }, 'DB: getSidebarItemTypes')
  const countMap = new Map(typeCounts.map((tc) => [tc.itemTypeId, tc._count]))
  return types.map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    color: t.color,
    count: countMap.get(t.id) || 0,
  }))
}

export async function getSidebarItemTypes(userId: string | null): Promise<SidebarItemType[]> {
  if (!userId) {
    const types = await getSystemItemTypes()
    return types.map((t) => ({ id: t.id, name: t.name, icon: t.icon, color: t.color, count: 0 }))
  }
  return fetchSidebarItemTypesForUser(userId)
}

function toFullItem(item: ItemWithRelations): FullItem {
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
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
