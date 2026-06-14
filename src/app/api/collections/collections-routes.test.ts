import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
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

import { auth } from '@/auth'
import { getCollectionById, createCollection, updateCollection, deleteCollection, toggleCollectionFavorite } from '@/lib/db/collections'
import { canCreateCollection } from '@/lib/db/usage'
import { collectionFormSchema } from '@/lib/utils/validators'

import { POST } from './route'
import { PATCH, DELETE } from './[id]/route'
import { PATCH as FAVORITE } from './[id]/favorite/route'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockCreateCollection = createCollection as ReturnType<typeof vi.fn>
const mockGetCollectionById = getCollectionById as ReturnType<typeof vi.fn>
const mockUpdateCollection = updateCollection as ReturnType<typeof vi.fn>
const mockDeleteCollection = deleteCollection as ReturnType<typeof vi.fn>
const mockToggleCollectionFavorite = toggleCollectionFavorite as ReturnType<typeof vi.fn>
const mockCanCreateCollection = canCreateCollection as ReturnType<typeof vi.fn>

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

interface CallOptions {
  body?: unknown
  params?: Record<string, string>
}

async function call(handler: RouteHandler, method: string, { body, params }: CallOptions = {}) {
  const req = new NextRequest('http://localhost/api/collections', {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
  const res = await handler(req, { params: Promise.resolve(params ?? {}) })
  return res.json()
}

const mockCollection = { id: 'col-1', name: 'My Collection', description: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockCanCreateCollection.mockResolvedValue(true)
  mockGetCollectionById.mockResolvedValue(mockCollection)
})

describe('POST /api/collections', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(POST, 'POST', { body: { name: 'Test' } })).status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when name is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(POST, 'POST', { body: { name: '   ' } })).status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when name exceeds 100 characters', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(POST, 'POST', { body: { name: 'a'.repeat(101) } })).status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when description exceeds 500 characters', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(POST, 'POST', { body: { name: 'Test', description: 'a'.repeat(501) } })).status).toBe('validation_error')
  })

  it('returns FORBIDDEN when free user reaches the collection limit', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCanCreateCollection.mockResolvedValue(false)
    const result = await call(POST, 'POST', { body: { name: 'My Collection' } })
    expect(result.status).toBe('forbidden')
    expect(mockCreateCollection).not.toHaveBeenCalled()
  })

  it('returns CREATED with collection on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockResolvedValue(mockCollection)
    const result = await call(POST, 'POST', { body: { name: 'My Collection' } })
    expect(result.status).toBe('created')
    expect(result.data).toEqual(mockCollection)
  })

  it('calls createCollection with userId and parsed data', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockResolvedValue(mockCollection)
    await call(POST, 'POST', { body: { name: '  My Collection  ', description: '  desc  ' } })
    expect(mockCreateCollection).toHaveBeenCalledWith('user-1', expect.objectContaining({ name: 'My Collection', description: 'desc' }))
  })

  it('transforms empty description string to null', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockResolvedValue(mockCollection)
    await call(POST, 'POST', { body: { name: 'Test', description: '' } })
    expect(mockCreateCollection).toHaveBeenCalledWith('user-1', expect.objectContaining({ description: null }))
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockRejectedValue(new Error('DB down'))
    expect((await call(POST, 'POST', { body: { name: 'Test' } })).status).toBe('internal_error')
  })
})

describe('PATCH /api/collections/[id]', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(PATCH, 'PATCH', { body: { name: 'Test' }, params: { id: 'col-1' } })).status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when name is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(PATCH, 'PATCH', { body: { name: '   ' }, params: { id: 'col-1' } })).status).toBe('validation_error')
  })

  it('allows updating only isFavorite without a name', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateCollection.mockResolvedValue({ ...mockCollection, isFavorite: true })
    const result = await call(PATCH, 'PATCH', { body: { isFavorite: true }, params: { id: 'col-1' } })
    expect(result.status).toBe('ok')
    expect(mockUpdateCollection).toHaveBeenCalledWith('user-1', 'col-1', { isFavorite: true })
  })

  it('returns OK with updated collection on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateCollection.mockResolvedValue(mockCollection)
    const result = await call(PATCH, 'PATCH', { body: { name: 'Updated' }, params: { id: 'col-1' } })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(mockCollection)
  })

  it('returns NOT_FOUND when the collection does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCollectionById.mockResolvedValue(null)
    const result = await call(PATCH, 'PATCH', { body: { name: 'Updated' }, params: { id: 'missing' } })
    expect(result.status).toBe('not_found')
    expect(mockUpdateCollection).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateCollection.mockRejectedValue(new Error('DB down'))
    expect((await call(PATCH, 'PATCH', { body: { name: 'Test' }, params: { id: 'col-1' } })).status).toBe('internal_error')
  })
})

describe('DELETE /api/collections/[id]', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(DELETE, 'DELETE', { params: { id: 'col-1' } })).status).toBe('unauthorized')
  })

  it('returns OK on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockDeleteCollection.mockResolvedValue(undefined)
    const result = await call(DELETE, 'DELETE', { params: { id: 'col-1' } })
    expect(result.status).toBe('ok')
    expect(mockDeleteCollection).toHaveBeenCalledWith('user-1', 'col-1')
  })

  it('returns NOT_FOUND when the collection does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCollectionById.mockResolvedValue(null)
    const result = await call(DELETE, 'DELETE', { params: { id: 'missing' } })
    expect(result.status).toBe('not_found')
    expect(mockDeleteCollection).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockDeleteCollection.mockRejectedValue(new Error('DB down'))
    expect((await call(DELETE, 'DELETE', { params: { id: 'col-1' } })).status).toBe('internal_error')
  })
})

describe('PATCH /api/collections/[id]/favorite', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(FAVORITE, 'PATCH', { body: { isFavorite: true }, params: { id: 'col-1' } })).status).toBe('unauthorized')
  })

  it('returns NOT_FOUND when collection does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleCollectionFavorite.mockResolvedValue(false)
    expect((await call(FAVORITE, 'PATCH', { body: { isFavorite: true }, params: { id: 'col-1' } })).status).toBe('not_found')
  })

  it('returns OK on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleCollectionFavorite.mockResolvedValue(true)
    const result = await call(FAVORITE, 'PATCH', { body: { isFavorite: true }, params: { id: 'col-1' } })
    expect(result.status).toBe('ok')
    expect(mockToggleCollectionFavorite).toHaveBeenCalledWith('user-1', 'col-1', true)
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
