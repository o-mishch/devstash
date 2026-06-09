import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/infra/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    item: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), deleteMany: vi.fn() },
    itemType: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/infra/cache', () => ({
  withDataCache: vi.fn((_config, fetcher) => fetcher()),
  CacheTags: {
    itemTypeBySlug: (slug: string) => ({ tag: `item-type:slug:${slug}`, revalidate: 3600 }),
    systemItemTypes: () => ({ tag: 'system-item-types', revalidate: 3600 }),
    sidebarTypes: (userId: string) => ({ tag: `user:${userId}:sidebar-types`, revalidate: 60 }),
    pinnedItems: (userId: string) => ({ tag: `user:${userId}:pinned-items`, revalidate: 60 }),
    recentItems: (userId: string) => ({ tag: `user:${userId}:recent-items`, revalidate: 60 }),
    itemsByType: (userId: string, type: string) => ({ tag: `user:${userId}:items:${type}`, revalidate: 60 }),
    itemsByCollection: (userId: string, id: string) => ({ tag: `user:${userId}:collection:${id}:items`, revalidate: 60 }),
    itemStats: (userId: string) => ({ tag: `user:${userId}:item-stats`, revalidate: 60 }),
  },
}))

import { prisma } from '@/lib/infra/prisma'
import { compareBySystemTypeOrder } from '@/lib/utils/constants'
import { getItemTypeBySlug, getSidebarItemTypes, deleteItem, getRecentItemsPage, getItemsByTypePage, getItemsByCollectionPage } from './items'

const mockFindFirst = prisma.itemType.findFirst as ReturnType<typeof vi.fn>
const mockFindMany = prisma.itemType.findMany as ReturnType<typeof vi.fn>
const mockItemFindMany = prisma.item.findMany as ReturnType<typeof vi.fn>
const mockGroupBy = prisma.item.groupBy as ReturnType<typeof vi.fn>
const mockDeleteMany = prisma.item.deleteMany as ReturnType<typeof vi.fn>
const mockQueryRaw = prisma.$queryRaw as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

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

// ── getItemTypeBySlug ────────────────────────────────────────────────────────

describe('getItemTypeBySlug', () => {
  it('passes the raw slug as a candidate', async () => {
    mockFindFirst.mockResolvedValue(null)
    await getItemTypeBySlug('snippet')
    const call = mockFindFirst.mock.calls[0][0]
    expect(call.where.name.in).toContain('snippet')
  })

  it('strips trailing -s to singularize (snippets → snippet)', async () => {
    mockFindFirst.mockResolvedValue(null)
    await getItemTypeBySlug('snippets')
    const { in: candidates } = mockFindFirst.mock.calls[0][0].where.name
    expect(candidates).toContain('snippet')
  })

  it('strips -es suffix (aliases → alias excluded; notes → note)', async () => {
    mockFindFirst.mockResolvedValue(null)
    await getItemTypeBySlug('notes')
    const { in: candidates } = mockFindFirst.mock.calls[0][0].where.name
    // -es rule fires first: "notes" → "not", then -s rule fires: "note"
    expect(candidates).toContain('note')
  })

  it('converts -ies suffix to -y (queries → query)', async () => {
    mockFindFirst.mockResolvedValue(null)
    await getItemTypeBySlug('queries')
    const { in: candidates } = mockFindFirst.mock.calls[0][0].where.name
    expect(candidates).toContain('query')
  })

  it('returns null when no type matches', async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await getItemTypeBySlug('unknown')
    expect(result).toBeNull()
  })

  it('returns the matched item type', async () => {
    const mockType = { id: '1', name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true }
    mockFindFirst.mockResolvedValue(mockType)
    const result = await getItemTypeBySlug('snippets')
    expect(result).toEqual(mockType)
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
    fileUrl: null,
    isFavorite: false,
    isPinned: false,
    itemType: { id: 'type-1', name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true },
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

  it('uses preview data from fetchItemPreviews', async () => {
    mockItemFindMany.mockResolvedValue([makeLightRow('x')])
    mockQueryRaw.mockResolvedValueOnce([{ id: 'x', description_preview: 'preview desc' }])
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
