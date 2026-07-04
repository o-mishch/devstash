import { vi, describe, it, expect, beforeEach } from 'vitest'
import { mockReset } from 'vitest-mock-extended'

// `mock.calls[0][0]` is Prisma's deep input union (via mockDeep); this narrows it to
// the handful of fields we assert on without pulling that whole union into each test.
interface PrismaCallArg {
  skip?: unknown
  cursor?: unknown
  where?: unknown
  select?: Record<string, unknown>
  data: Record<string, unknown>
}

vi.mock('@/lib/infra/prisma', async () => (await import('@/test/prisma-mock')).createPrismaMockModule())

vi.mock('@/lib/infra/cache', () => ({
  CacheTags: {
    itemGroup: (userId: string) => `items-${userId}`,
    collectionGroup: (userId: string) => `collections-${userId}`,
    systemItemTypes: () => 'system-item-types',
    sidebarTypes: (userId: string) => `user:${userId}:sidebar-types`,
    pinnedItems: (userId: string) => `user:${userId}:pinned-items`,
    recentItems: (userId: string) => `user:${userId}:recent-items`,
    itemsByType: (userId: string, type: string) => `user:${userId}:items:${type}`,
    itemsByCollection: (userId: string, id: string) => `user:${userId}:collection:${id}:items`,
    itemStats: (userId: string) => `user:${userId}:item-stats`,
    itemTypeDistribution: (userId: string) => `user:${userId}:item-type-distribution`,
    dashboardActivity: (userId: string) => `user:${userId}:dashboard-activity`,
    downloadItem: (userId: string, itemId: string) => `user:${userId}:download-item:${itemId}`,
  },
}))

import { prisma } from '@/lib/infra/prisma'
import { asPrismaMock } from '@/test/prisma-mock'
import { compareBySystemTypeOrder } from '@/lib/utils/constants'
import { createItem, getSidebarItemTypes, deleteItem, getRecentItemsPage, getItemsByTypePage, getItemsByCollectionPage, getDownloadItem, getItemTypeDistribution, getDashboardActivity, updateItem } from './items'

const prismaMock = asPrismaMock(prisma)

const mockFindMany = prismaMock.itemType.findMany
const mockItemFindFirst = prismaMock.item.findFirst
const mockItemFindMany = prismaMock.item.findMany
const mockItemCreate = prismaMock.item.create
const mockGroupBy = prismaMock.item.groupBy
const mockDeleteMany = prismaMock.item.deleteMany
const mockItemUpdate = prismaMock.item.update
const mockQueryRaw = prismaMock.$queryRaw

beforeEach(() => {
  mockReset(prismaMock)
  // Default: no text previews (non-text pages skip this call; text pages get empty map)
  prismaMock.$queryRaw.mockResolvedValue([])
})

// ── compareBySystemTypeOrder ─────────────────────────────────────────────────

describe('compareBySystemTypeOrder', () => {
  it('sorts known types in the defined order', () => {
    const types = [
      { name: 'link' },
      { name: 'snippet' },
      { name: 'command' },
    ]
    const sorted = [...types].sort(compareBySystemTypeOrder)
    expect(sorted.map((t) => t.name)).toEqual(['snippet', 'command', 'link'])
  })

  it('places unknown types before known ones (indexOf returns -1, sorts first)', () => {
    const types = [{ name: 'snippet' }, { name: 'custom' }]
    const sorted = [...types].sort(compareBySystemTypeOrder)
    expect(sorted[0].name).toBe('custom')
    expect(sorted[1].name).toBe('snippet')
  })

  it('returns 0 for two types at the same position', () => {
    expect(compareBySystemTypeOrder({ name: 'note' }, { name: 'note' })).toBe(0)
  })
})

// ── getSidebarItemTypes (null userId) ────────────────────────────────────────

describe('getSidebarItemTypes', () => {
  const systemTypes = [
    { id: '1', name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true, userId: null },
    { id: '2', name: 'prompt', icon: 'Sparkles', color: '#8b5cf6', isSystem: true, userId: null },
  ]

  it('returns count: 0 for all types when userId is null (no DB user query)', async () => {
    mockFindMany.mockResolvedValue(systemTypes)
    const result = await getSidebarItemTypes(null)
    expect(result.every((t) => t.count === 0)).toBe(true)
    expect(mockGroupBy).not.toHaveBeenCalled()
  })

  it('merges live counts when userId is provided', async () => {
    mockFindMany.mockResolvedValue(systemTypes)
    mockGroupBy.mockResolvedValue([{ itemTypeId: '1', _count: 5 }])
    const result = await getSidebarItemTypes('user-1')
    const snippet = result.find((t) => t.name === 'snippet')
    const prompt = result.find((t) => t.name === 'prompt')
    expect(snippet?.count).toBe(5)
    expect(prompt?.count).toBe(0)
  })
})

// ── getItemTypeDistribution ──────────────────────────────────────────────────

describe('getItemTypeDistribution', () => {
  const systemTypes = [
    { id: '1', name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true, userId: null },
    { id: '2', name: 'prompt', icon: 'Sparkles', color: '#8b5cf6', isSystem: true, userId: null },
    { id: '3', name: 'command', icon: 'Terminal', color: '#f97316', isSystem: true, userId: null },
  ]

  it('maps groupBy counts onto every system type, defaulting missing types to 0', async () => {
    mockFindMany.mockResolvedValue(systemTypes)
    mockGroupBy.mockResolvedValue([
      { itemTypeId: '1', _count: 7 },
      { itemTypeId: '3', _count: 1 },
    ])
    const result = await getItemTypeDistribution('user-1')
    expect(result).toEqual([
      { name: 'snippet', count: 7 },
      { name: 'prompt', count: 0 },
      { name: 'command', count: 1 },
    ])
    // IDOR: the aggregation is scoped to the session userId
    expect(mockGroupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }))
  })
})

// ── getDashboardActivity ─────────────────────────────────────────────────────

describe('getDashboardActivity', () => {
  it('returns a contiguous 84-day series ending today with levels bucketed against the busiest day', async () => {
    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)
    mockQueryRaw.mockResolvedValue([{ day: new Date(`${todayIso}T00:00:00Z`), count: 4n }])

    const result = await getDashboardActivity('user-1')

    expect(result).toHaveLength(84)
    expect(result[result.length - 1].date).toBe(todayIso)
    // every entry is a valid ISO date and a 0–4 level
    expect(result.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.level >= 0 && d.level <= 4)).toBe(true)
    // the only non-zero day is today, and being the max it lands at level 4
    const todayEntry = result[result.length - 1]
    expect(todayEntry.count).toBe(4)
    expect(todayEntry.level).toBe(4)
    expect(result.slice(0, -1).every((d) => d.count === 0 && d.level === 0)).toBe(true)
    // IDOR: the raw aggregation interpolates the session userId into the WHERE clause
    expect(mockQueryRaw.mock.calls[0]).toContain('user-1')
  })

  it('returns all-zero levels when there is no activity', async () => {
    mockQueryRaw.mockResolvedValue([])
    const result = await getDashboardActivity('user-1')
    expect(result).toHaveLength(84)
    expect(result.every((d) => d.count === 0 && d.level === 0)).toBe(true)
  })
})

// ── *Page cursor pagination ──────────────────────────────────────────────────

function makeLightRow(id: string) {
  return {
    id,
    title: `Item ${id}`,
    createdAt: new Date('2024-01-01'),
    url: null,
    fileName: null,
    fileSize: null,
    isFavorite: false,
    isPinned: false,
    itemType: { name: 'snippet' },
    tags: [{ name: 'react' }],
  }
}

function makeRows(count: number) {
  return Array.from({ length: count }, (_, i) => makeLightRow(`item-${i + 1}`))
}

describe('getRecentItemsPage', () => {
  it('returns first page using cache when no cursor', async () => {
    mockItemFindMany.mockResolvedValue(makeRows(5))
    const result = await getRecentItemsPage('user-1')
    expect(result.items).toHaveLength(5)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('detects hasMore and sets nextCursor when 21 rows returned', async () => {
    mockItemFindMany.mockResolvedValue(makeRows(21))
    const result = await getRecentItemsPage('user-1')
    expect(result.items).toHaveLength(20)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('item-20')
  })

  it('queries with skip+cursor when cursor provided (bypasses cache)', async () => {
    mockItemFindMany.mockResolvedValue(makeRows(3))
    const result = await getRecentItemsPage('user-1', 'cursor-id')
    const call = mockItemFindMany.mock.calls[0][0] as PrismaCallArg
    expect(call.skip).toBe(1)
    expect(call.cursor).toEqual({ id: 'cursor-id' })
    expect(result.hasMore).toBe(false)
  })

  it('derives descriptionPreview from DB-side LEFT() truncation via $queryRaw', async () => {
    mockItemFindMany.mockResolvedValue([makeLightRow('x')])
    mockQueryRaw.mockResolvedValue([{ id: 'x', dp: 'preview desc', cp: null }])
    const result = await getRecentItemsPage('user-1')
    expect(result.items[0].descriptionPreview).toBe('preview desc')
  })

  it('maps toLightItem: tags extracted from relation', async () => {
    mockItemFindMany.mockResolvedValue([makeLightRow('x')])
    const result = await getRecentItemsPage('user-1')
    expect(result.items[0].tags).toEqual(['react'])
  })
})

describe('getItemsByTypePage', () => {
  it('filters by type name and returns first page via cache', async () => {
    mockItemFindMany.mockResolvedValue(makeRows(2))
    const result = await getItemsByTypePage('user-1', 'snippet')
    const call = mockItemFindMany.mock.calls[0][0] as PrismaCallArg
    expect(call.where).toMatchObject({ userId: 'user-1', itemType: { name: 'snippet' } })
    expect(result.items).toHaveLength(2)
  })

  it('detects hasMore when cursor page has 21 rows', async () => {
    mockItemFindMany.mockResolvedValue(makeRows(21))
    const result = await getItemsByTypePage('user-1', 'snippet', 'cursor-id')
    expect(result.hasMore).toBe(true)
    expect(result.items).toHaveLength(20)
  })
})

describe('getItemsByCollectionPage', () => {
  it('filters by collectionId and returns first page via cache', async () => {
    mockItemFindMany.mockResolvedValue(makeRows(4))
    const result = await getItemsByCollectionPage('user-1', 'col-1')
    const call = mockItemFindMany.mock.calls[0][0] as PrismaCallArg
    expect(call.where).toMatchObject({ userId: 'user-1', collections: { some: { collectionId: 'col-1' } } })
    expect(result.items).toHaveLength(4)
  })

  it('uses skip+cursor on page 2', async () => {
    mockItemFindMany.mockResolvedValue(makeRows(1))
    await getItemsByCollectionPage('user-1', 'col-1', 'cursor-id')
    const call = mockItemFindMany.mock.calls[0][0] as PrismaCallArg
    expect(call.skip).toBe(1)
    expect(call.cursor).toEqual({ id: 'cursor-id' })
  })
})

describe('createItem', () => {
  it('returns image items with tags after creation', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'type-image', name: 'image', icon: 'Image', color: '#ec4899', isSystem: true, userId: null },
    ])
    mockItemCreate.mockResolvedValue({
      id: 'item-1',
      title: 'Screenshot',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      isFavorite: false,
      isPinned: false,
      itemType: { name: 'image' },
      tags: [{ name: 'ui' }, { name: 'screenshot' }],
    })

    const result = await createItem('user-1', {
      title: 'Screenshot',
      description: null,
      content: null,
      url: null,
      fileUrl: 'user-1/screenshot.png',
      fileName: 'screenshot.png',
      fileSize: 1024,
      language: null,
      tags: ['ui', 'screenshot'],
      itemTypeName: 'image',
      collectionIds: [],
      imageWidth: 1280,
      imageHeight: 720,
    })

    const call = mockItemCreate.mock.calls[0][0] as {
      data: { tags: { connectOrCreate: unknown } }
      select: { tags: unknown }
    }
    expect(call.data.tags.connectOrCreate).toEqual([
      { where: { name: 'ui' }, create: { name: 'ui' } },
      { where: { name: 'screenshot' }, create: { name: 'screenshot' } },
    ])
    expect(call.select.tags).toEqual({ select: { name: true } })
    expect(result?.tags).toEqual(['ui', 'screenshot'])
  })

  it('runs the write on the passed transaction client, keeping cached reads on the module client', async () => {
    // System type resolves via the cached getSystemItemTypes() read (module client).
    mockFindMany.mockResolvedValue([
      { id: 'type-snippet', name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true, userId: null },
    ])
    const txCreate = vi.fn().mockResolvedValue({
      id: 'item-tx',
      title: 'In tx',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      isFavorite: false,
      isPinned: false,
      itemType: { name: 'snippet' },
      tags: [],
    })
    const txFindFirst = vi.fn()
    const tx = { item: { create: txCreate }, itemType: { findFirst: txFindFirst } } as never

    const result = await createItem(
      'user-1',
      {
        title: 'In tx',
        description: null,
        content: 'const x = 1',
        url: null,
        fileUrl: null,
        fileName: null,
        fileSize: null,
        language: 'ts',
        tags: [],
        itemTypeName: 'snippet',
        collectionIds: [],
      },
      tx,
    )

    // The write must go to the transaction client — never the module prisma client, which would break
    // commitDrafts' delete-guards-create atomicity.
    expect(txCreate).toHaveBeenCalledTimes(1)
    expect(mockItemCreate).not.toHaveBeenCalled()
    // The cached system-type read stays on the module client (a 'use cache' read can't run on tx), and
    // since the type resolved there the tx fallback findFirst is never hit.
    expect(mockFindMany).toHaveBeenCalled()
    expect(txFindFirst).not.toHaveBeenCalled()
    expect(result?.title).toBe('In tx')
  })
})

describe('getDownloadItem', () => {
  it('scopes the download lookup by userId and itemId with a narrow select', async () => {
    const row = {
      id: 'item-1',
      fileUrl: 'uploads/user-1/file.png',
      fileName: 'file.png',
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      itemType: { name: 'image' },
    }
    mockItemFindFirst.mockResolvedValue(row)

    const result = await getDownloadItem('user-1', 'item-1')

    expect(mockItemFindFirst).toHaveBeenCalledWith({
      where: { id: 'item-1', userId: 'user-1' },
      select: {
        id: true,
        fileUrl: true,
        fileName: true,
        updatedAt: true,
        itemType: { select: { name: true } },
      },
    })
    expect(result).toEqual(row)
  })
})

// ── updateItem live type change (v3) ─────────────────────────────────────────

describe('updateItem — live type change', () => {
  const systemTypes = [
    { id: 'type-snippet', name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true, userId: null },
    { id: 'type-command', name: 'command', icon: 'Terminal', color: '#f97316', isSystem: true, userId: null },
    { id: 'type-note', name: 'note', icon: 'StickyNote', color: '#fde047', isSystem: true, userId: null },
  ]
  const updatedRow = { id: 'item-1', updatedAt: new Date('2024-01-01T00:00:00.000Z'), tags: [], collections: [] }

  const baseInput = {
    title: 'T',
    description: null,
    content: null,
    url: null,
    tags: [],
    collectionIds: [],
  }

  it('connects the resolved system itemTypeId and remaps the language (snippet→command keeps a shell lang)', async () => {
    mockFindMany.mockResolvedValue(systemTypes)
    mockItemUpdate.mockResolvedValue(updatedRow)

    await updateItem('user-1', 'item-1', { ...baseInput, language: 'zsh', itemTypeName: 'command' })

    const call = mockItemUpdate.mock.calls[0][0] as PrismaCallArg
    expect(call.where).toEqual({ id: 'item-1', userId: 'user-1' })
    expect(call.data.itemType).toEqual({ connect: { id: 'type-command' } })
    // shell synonym normalizes to bash for a command
    expect(call.data.language).toBe('bash')
  })

  it('clears the language when remapping has no sensible target (→note)', async () => {
    mockFindMany.mockResolvedValue(systemTypes)
    mockItemUpdate.mockResolvedValue(updatedRow)

    await updateItem('user-1', 'item-1', { ...baseInput, language: 'python', itemTypeName: 'note' })

    const call = mockItemUpdate.mock.calls[0][0] as PrismaCallArg
    expect(call.data.itemType).toEqual({ connect: { id: 'type-note' } })
    expect(call.data.language).toBeNull()
  })

  it('returns null without updating when the target system type is missing', async () => {
    mockFindMany.mockResolvedValue([systemTypes[0]]) // only snippet known
    const result = await updateItem('user-1', 'item-1', { ...baseInput, language: null, itemTypeName: 'command' })
    expect(result).toBeNull()
    expect(mockItemUpdate).not.toHaveBeenCalled()
  })

  it('leaves itemType untouched and passes the raw language when itemTypeName is omitted', async () => {
    mockItemUpdate.mockResolvedValue(updatedRow)
    await updateItem('user-1', 'item-1', { ...baseInput, language: 'python' })
    const call = mockItemUpdate.mock.calls[0][0] as PrismaCallArg
    expect(call.data.itemType).toBeUndefined()
    expect(call.data.language).toBe('python')
  })
})

// ── deleteItem ───────────────────────────────────────────────────────────────

describe('deleteItem', () => {
  it('calls prisma.item.deleteMany with userId and itemId', async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 })
    const result = await deleteItem('user-1', 'item-1')
    
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: 'item-1', userId: 'user-1' }
    })
    expect(result).toBe(true)
  })

  it('returns false if count is 0', async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 })
    const result = await deleteItem('user-1', 'item-x')
    expect(result).toBe(false)
  })
})
