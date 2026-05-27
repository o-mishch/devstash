import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    item: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    itemType: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/cache', () => ({
  withDataCache: vi.fn((_config, fetcher) => fetcher()),
  CacheTags: {
    itemTypeBySlug: (slug: string) => ({ tag: `item-type:slug:${slug}`, revalidate: 3600 }),
    systemItemTypes: () => ({ tag: 'system-item-types', revalidate: 3600 }),
    sidebarTypes: (userId: string) => ({ tag: `user:${userId}:sidebar-types`, revalidate: 60 }),
    pinnedItems: (userId: string) => ({ tag: `user:${userId}:pinned-items`, revalidate: 60 }),
    recentItems: (userId: string) => ({ tag: `user:${userId}:recent-items`, revalidate: 60 }),
    itemsByType: (userId: string, type: string) => ({ tag: `user:${userId}:items:${type}`, revalidate: 60 }),
    itemStats: (userId: string) => ({ tag: `user:${userId}:item-stats`, revalidate: 60 }),
  },
}))

import { prisma } from '@/lib/prisma'
import { compareBySystemTypeOrder, getItemTypeBySlug, getSidebarItemTypes } from './items'

const mockFindFirst = prisma.itemType.findFirst as ReturnType<typeof vi.fn>
const mockFindMany = prisma.itemType.findMany as ReturnType<typeof vi.fn>
const mockGroupBy = prisma.item.groupBy as ReturnType<typeof vi.fn>

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
