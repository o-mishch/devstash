import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    item: { findMany: vi.fn() },
    collection: { findMany: vi.fn() },
  },
}))

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { globalSearchAction } from './search'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockItemFindMany = prisma.item.findMany as ReturnType<typeof vi.fn>
const mockCollectionFindMany = prisma.collection.findMany as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('globalSearchAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await globalSearchAction({ query: 'test' })
    expect(result.status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when query is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await globalSearchAction({ query: '   ' })
    expect(result.status).toBe('validation_error')
  })

  it('returns OK with items and collections on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    
    mockItemFindMany.mockResolvedValue([
      {
        id: 'item-1',
        title: 'Test Item',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        itemType: { id: 'type-1', name: 'snippet', icon: 'code', color: 'blue', isSystem: true },
        tags: [{ name: 'react' }],
        url: null,
        fileUrl: null,
        fileName: null,
        fileSize: null,
        isFavorite: false,
        isPinned: false,
      }
    ])

    mockCollectionFindMany.mockResolvedValue([
      {
        id: 'col-1',
        name: 'Test Collection',
        description: null,
        isFavorite: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        _count: { items: 2 },
        items: [
          {
            item: {
              itemType: { id: 'type-1', name: 'snippet', icon: 'code', color: 'blue', isSystem: true }
            }
          },
          {
            item: {
              itemType: { id: 'type-1', name: 'snippet', icon: 'code', color: 'blue', isSystem: true }
            }
          }
        ],
      }
    ])

    const result = await globalSearchAction({ query: 'test' })
    
    expect(result.status).toBe('ok')
    expect(result.data?.items).toHaveLength(1)
    expect(result.data?.items[0].title).toBe('Test Item')
    expect(result.data?.collections).toHaveLength(1)
    expect(result.data?.collections[0].name).toBe('Test Collection')

    expect(mockItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { title: { contains: 'test', mode: 'insensitive' } },
          { description: { contains: 'test', mode: 'insensitive' } },
          { content: { contains: 'test', mode: 'insensitive' } },
        ]
      })
    }))
  })

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockItemFindMany.mockRejectedValue(new Error('DB down'))
    
    const result = await globalSearchAction({ query: 'test' })
    expect(result.status).toBe('internal_error')
  })
})
