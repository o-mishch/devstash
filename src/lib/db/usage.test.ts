import { vi, describe, it, expect, beforeEach } from 'vitest'
import {
  canCreateItem,
  canCreateCollection,
  FREE_TIER_ITEM_LIMIT,
  FREE_TIER_COLLECTION_LIMIT,
} from './usage'
import { prisma } from '@/lib/infra/prisma'

vi.mock('@/lib/infra/prisma', () => ({
  prisma: {
    item: { count: vi.fn() },
    collection: { count: vi.fn() },
  },
}))

describe('Usage Limits', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('canCreateItem', () => {
    it('allows Pro users to create items without checking DB', async () => {
      const result = await canCreateItem('user_1', true)
      expect(result).toBe(true)
      expect(prisma.item.count).not.toHaveBeenCalled()
    })

    it('blocks free users over the limit', async () => {
      vi.mocked(prisma.item.count).mockResolvedValue(FREE_TIER_ITEM_LIMIT)
      const result = await canCreateItem('user_2', false)
      expect(result).toBe(false)
    })

    it('allows free users under the limit', async () => {
      vi.mocked(prisma.item.count).mockResolvedValue(FREE_TIER_ITEM_LIMIT - 1)
      const result = await canCreateItem('user_3', false)
      expect(result).toBe(true)
    })
  })

  describe('canCreateCollection', () => {
    it('allows Pro users to create collections without checking DB', async () => {
      const result = await canCreateCollection('user_1', true)
      expect(result).toBe(true)
      expect(prisma.collection.count).not.toHaveBeenCalled()
    })

    it('blocks free users over the limit', async () => {
      vi.mocked(prisma.collection.count).mockResolvedValue(FREE_TIER_COLLECTION_LIMIT)
      const result = await canCreateCollection('user_2', false)
      expect(result).toBe(false)
    })

    it('allows free users under the limit', async () => {
      vi.mocked(prisma.collection.count).mockResolvedValue(FREE_TIER_COLLECTION_LIMIT - 1)
      const result = await canCreateCollection('user_3', false)
      expect(result).toBe(true)
    })
  })
})
