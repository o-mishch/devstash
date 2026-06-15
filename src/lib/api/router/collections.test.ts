import { vi, describe, it, expect, beforeEach } from 'vitest'
import { invoke, expectORPCError } from '@/test/orpc'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateCollectionsCache: vi.fn() }))
vi.mock('@/lib/db/collections', () => ({
  getAllCollections: vi.fn(),
  getCollectionById: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  toggleCollectionFavorite: vi.fn(),
}))
vi.mock('@/lib/db/usage', () => ({ canCreateCollection: vi.fn(), FREE_TIER_COLLECTION_LIMIT: 3 }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import {
  getCollectionById,
  createCollection,
  updateCollection,
  deleteCollection,
  toggleCollectionFavorite,
} from '@/lib/db/collections'
import { canCreateCollection } from '@/lib/db/usage'
import { collectionFormSchema } from '@/lib/utils/validators'
import { collectionsRouter } from './collections'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockGetById = getCollectionById as ReturnType<typeof vi.fn>
const mockCreate = createCollection as ReturnType<typeof vi.fn>
const mockUpdate = updateCollection as ReturnType<typeof vi.fn>
const mockDelete = deleteCollection as ReturnType<typeof vi.fn>
const mockToggleFavorite = toggleCollectionFavorite as ReturnType<typeof vi.fn>
const mockCanCreate = canCreateCollection as ReturnType<typeof vi.fn>

// A complete CollectionWithTypes — oRPC validates handler output against collectionSchema.
const mockCollection = {
  id: 'col-1',
  name: 'My Collection',
  description: null,
  isFavorite: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  itemCount: 0,
  dominantColor: null,
  types: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockCanCreate.mockResolvedValue(true)
  mockGetById.mockResolvedValue(mockCollection)
})

describe('collections.create', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(collectionsRouter.create, { name: 'Test' }), 'UNAUTHORIZED')
  })

  it('rejects an empty name (input validation)', async () => {
    await expectORPCError(invoke(collectionsRouter.create, { name: '   ' }), 'BAD_REQUEST')
  })

  it('rejects a name over 100 characters', async () => {
    await expectORPCError(invoke(collectionsRouter.create, { name: 'a'.repeat(101) }), 'BAD_REQUEST')
  })

  it('throws FORBIDDEN when the free-tier limit is reached', async () => {
    mockCanCreate.mockResolvedValue(false)
    await expectORPCError(invoke(collectionsRouter.create, { name: 'My Collection' }), 'FORBIDDEN')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns the created collection on success', async () => {
    mockCreate.mockResolvedValue(mockCollection)
    const result = await invoke(collectionsRouter.create, { name: 'My Collection' })
    expect(result).toEqual(mockCollection)
  })

  it('calls createCollection with the session userId and parsed data', async () => {
    mockCreate.mockResolvedValue(mockCollection)
    await invoke(collectionsRouter.create, { name: '  My Collection  ', description: '  desc  ' })
    expect(mockCreate).toHaveBeenCalledWith('user-1', expect.objectContaining({ name: 'My Collection', description: 'desc' }))
  })

  it('transforms an empty description to null', async () => {
    mockCreate.mockResolvedValue(mockCollection)
    await invoke(collectionsRouter.create, { name: 'Test', description: '' })
    expect(mockCreate).toHaveBeenCalledWith('user-1', expect.objectContaining({ description: null }))
  })
})

describe('collections.update', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(collectionsRouter.update, { id: 'col-1', name: 'Test' }), 'UNAUTHORIZED')
  })

  it('rejects an empty name', async () => {
    await expectORPCError(invoke(collectionsRouter.update, { id: 'col-1', name: '   ' }), 'BAD_REQUEST')
  })

  it('updates isFavorite alone without a name', async () => {
    mockUpdate.mockResolvedValue({ ...mockCollection, isFavorite: true })
    await invoke(collectionsRouter.update, { id: 'col-1', isFavorite: true })
    expect(mockUpdate).toHaveBeenCalledWith('user-1', 'col-1', { isFavorite: true })
  })

  it('returns the updated collection on success', async () => {
    mockUpdate.mockResolvedValue(mockCollection)
    const result = await invoke(collectionsRouter.update, { id: 'col-1', name: 'Updated' })
    expect(result).toEqual(mockCollection)
  })

  it('throws NOT_FOUND when the collection does not exist', async () => {
    mockGetById.mockResolvedValue(null)
    await expectORPCError(invoke(collectionsRouter.update, { id: 'missing', name: 'Updated' }), 'NOT_FOUND')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('collections.remove', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(collectionsRouter.remove, { id: 'col-1' }), 'UNAUTHORIZED')
  })

  it('deletes scoped to the session userId on success', async () => {
    mockDelete.mockResolvedValue(undefined)
    await invoke(collectionsRouter.remove, { id: 'col-1' })
    expect(mockDelete).toHaveBeenCalledWith('user-1', 'col-1')
  })

  it('throws NOT_FOUND when the collection does not exist', async () => {
    mockGetById.mockResolvedValue(null)
    await expectORPCError(invoke(collectionsRouter.remove, { id: 'missing' }), 'NOT_FOUND')
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe('collections.toggleFavorite', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(collectionsRouter.toggleFavorite, { id: 'col-1', isFavorite: true }), 'UNAUTHORIZED')
  })

  it('throws NOT_FOUND when the collection does not exist or belongs to another user', async () => {
    mockToggleFavorite.mockResolvedValue(false)
    await expectORPCError(invoke(collectionsRouter.toggleFavorite, { id: 'col-1', isFavorite: true }), 'NOT_FOUND')
  })

  it('toggles scoped to the session userId on success', async () => {
    mockToggleFavorite.mockResolvedValue(true)
    await invoke(collectionsRouter.toggleFavorite, { id: 'col-1', isFavorite: true })
    expect(mockToggleFavorite).toHaveBeenCalledWith('user-1', 'col-1', true)
  })
})

describe('collectionFormSchema', () => {
  it('trims whitespace from name', () => {
    expect(collectionFormSchema.parse({ name: '  React  ' }).name).toBe('React')
  })

  it('transforms empty description to null', () => {
    expect(collectionFormSchema.parse({ name: 'Test', description: '' }).description).toBeNull()
  })

  it('transforms whitespace-only description to null', () => {
    expect(collectionFormSchema.parse({ name: 'Test', description: '   ' }).description).toBeNull()
  })

  it('preserves non-empty description after trimming', () => {
    expect(collectionFormSchema.parse({ name: 'Test', description: '  some desc  ' }).description).toBe('some desc')
  })

  it('accepts missing description (undefined)', () => {
    expect(collectionFormSchema.parse({ name: 'Test' }).description).toBeNull()
  })

  it('rejects empty name', () => {
    expect(() => collectionFormSchema.parse({ name: '' })).toThrow()
  })
})
