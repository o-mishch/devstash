import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/infra/prisma', () => ({
  prisma: {
    item: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    itemType: { findFirst: vi.fn(), findMany: vi.fn() },
    collection: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

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
    downloadItem: (userId: string, itemId: string) => `user:${userId}:download-item:${itemId}`,
  },
}))

import { prisma } from '@/lib/infra/prisma'
import { compareBySystemTypeOrder } from '@/lib/utils/constants'
import { createItem, getSidebarItemTypes, deleteItem, getRecentItemsPage, getItemsByTypePage, getItemsByCollectionPage, getDownloadItem } from './items'

const mockFindMany = prisma.itemType.findMany as ReturnType<typeof vi.fn>
const mockItemFindFirst = prisma.item.findFirst as ReturnType<typeof vi.fn>
const mockItemFindMany = prisma.item.findMany as ReturnType<typeof vi.fn>
const mockItemCreate = prisma.item.create as ReturnType<typeof vi.fn>
const mockGroupBy = prisma.item.groupBy as ReturnType<typeof vi.fn>
const mockDeleteMany = prisma.item.deleteMany as ReturnType<typeof vi.fn>
const mockQueryRaw = prisma.$queryRaw as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no text previews (non-text pages skip this call; text pages get empty map)
  mockQueryRaw.mockResolvedValue([])
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
    const call = mockItemFindMany.mock.calls[0][0]
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
    const call = mockItemFindMany.mock.calls[0][0]
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
    const call = mockItemFindMany.mock.calls[0][0]
    expect(call.where).toMatchObject({ userId: 'user-1', collections: { some: { collectionId: 'col-1' } } })
    expect(result.items).toHaveLength(4)
  })

  it('uses skip+cursor on page 2', async () => {
    mockItemFindMany.mockResolvedValue(makeRows(1))
    await getItemsByCollectionPage('user-1', 'col-1', 'cursor-id')
    const call = mockItemFindMany.mock.calls[0][0]
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

    const call = mockItemCreate.mock.calls[0][0]
    expect(call.data.tags.connectOrCreate).toEqual([
      { where: { name: 'ui' }, create: { name: 'ui' } },
      { where: { name: 'screenshot' }, create: { name: 'screenshot' } },
    ])
    expect(call.select.tags).toEqual({ select: { name: true } })
    expect(result?.tags).toEqual(['ui', 'screenshot'])
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
