import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Route handlers are tested by invoking the exported handler with a mocked NextRequest and asserting
// res.status + await res.json(). Session/Pro/db are mocked exactly as the oRPC suite did.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateCollectionsCache: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
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
  getAllCollections,
  getCollectionById,
  createCollection,
  updateCollection,
  deleteCollection,
  toggleCollectionFavorite,
} from '@/lib/db/collections'
import { canCreateCollection } from '@/lib/db/usage'

import { GET, POST } from './route'
import { PATCH, DELETE } from './[id]/route'
import { PATCH as PATCH_FAVORITE } from './[id]/favorite/route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockGetAll = getAllCollections as ReturnType<typeof vi.fn>
const mockGetById = getCollectionById as ReturnType<typeof vi.fn>
const mockCreate = createCollection as ReturnType<typeof vi.fn>
const mockUpdate = updateCollection as ReturnType<typeof vi.fn>
const mockDelete = deleteCollection as ReturnType<typeof vi.fn>
const mockToggleFavorite = toggleCollectionFavorite as ReturnType<typeof vi.fn>
const mockCanCreate = canCreateCollection as ReturnType<typeof vi.fn>

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

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/collections', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockCanCreate.mockResolvedValue(true)
  mockGetById.mockResolvedValue(mockCollection)
})

describe('GET /collections', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(req('GET'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ message: 'Not authenticated.' })
  })

  it('returns the session user\'s collections', async () => {
    mockGetAll.mockResolvedValue([mockCollection])
    const res = await GET(req('GET'))
    expect(res.status).toBe(200)
    expect(mockGetAll).toHaveBeenCalledWith('user-1')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('col-1')
  })
})

describe('POST /collections', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await POST(req('POST', { name: 'Test' }))
    expect(res.status).toBe(401)
  })

  it('returns 422 for an empty name', async () => {
    const res = await POST(req('POST', { name: '   ' }))
    expect(res.status).toBe(422)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 422 for a name over 100 characters', async () => {
    const res = await POST(req('POST', { name: 'a'.repeat(101) }))
    expect(res.status).toBe(422)
  })

  it('returns 403 when the free-tier limit is reached', async () => {
    mockCanCreate.mockResolvedValue(false)
    const res = await POST(req('POST', { name: 'My Collection' }))
    expect(res.status).toBe(403)
    expect((await res.json()).message).toMatch(/free tier limit/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 201 with the created collection', async () => {
    mockCreate.mockResolvedValue(mockCollection)
    const res = await POST(req('POST', { name: 'My Collection' }))
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('col-1')
  })

  it('uses the session userId and trims input (IDOR-safe — ignores a userId in the body)', async () => {
    mockCreate.mockResolvedValue(mockCollection)
    await POST(req('POST', { name: '  My Collection  ', description: '  desc  ', userId: 'attacker' }))
    expect(mockCreate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'My Collection', description: 'desc' }),
    )
  })

  it('transforms an empty description to null', async () => {
    mockCreate.mockResolvedValue(mockCollection)
    await POST(req('POST', { name: 'Test', description: '' }))
    expect(mockCreate).toHaveBeenCalledWith('user-1', expect.objectContaining({ description: null }))
  })
})

describe('PATCH /collections/{id}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await PATCH(req('PATCH', { name: 'Test' }), params('col-1'))
    expect(res.status).toBe(401)
  })

  it('returns 422 for an empty name', async () => {
    const res = await PATCH(req('PATCH', { name: '   ' }), params('col-1'))
    expect(res.status).toBe(422)
  })

  it('returns 404 when the collection does not exist', async () => {
    mockGetById.mockResolvedValue(null)
    const res = await PATCH(req('PATCH', { name: 'Updated' }), params('missing'))
    expect(res.status).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 200 and updates isFavorite alone, scoped to the session userId', async () => {
    mockUpdate.mockResolvedValue({ ...mockCollection, isFavorite: true })
    const res = await PATCH(req('PATCH', { isFavorite: true }), params('col-1'))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('user-1', 'col-1', { isFavorite: true })
  })
})

describe('DELETE /collections/{id}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await DELETE(req('DELETE'), params('col-1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the collection does not exist', async () => {
    mockGetById.mockResolvedValue(null)
    const res = await DELETE(req('DELETE'), params('missing'))
    expect(res.status).toBe(404)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 204 and deletes scoped to the session userId', async () => {
    mockDelete.mockResolvedValue(undefined)
    const res = await DELETE(req('DELETE'), params('col-1'))
    expect(res.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith('user-1', 'col-1')
  })
})

describe('PATCH /collections/{id}/favorite', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await PATCH_FAVORITE(req('PATCH', { isFavorite: true }), params('col-1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the collection does not exist or belongs to another user', async () => {
    mockToggleFavorite.mockResolvedValue(false)
    const res = await PATCH_FAVORITE(req('PATCH', { isFavorite: true }), params('col-1'))
    expect(res.status).toBe(404)
  })

  it('returns 204 and toggles scoped to the session userId', async () => {
    mockToggleFavorite.mockResolvedValue(true)
    const res = await PATCH_FAVORITE(req('PATCH', { isFavorite: true }), params('col-1'))
    expect(res.status).toBe(204)
    expect(mockToggleFavorite).toHaveBeenCalledWith('user-1', 'col-1', true)
  })
})
