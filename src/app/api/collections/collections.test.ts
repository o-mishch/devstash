import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readJson } from '@/test/matchers'
import { NextRequest } from 'next/server'
import type { getCachedSession as GetCachedSessionFn } from '@/lib/session'
import type { getCachedVerifiedProAccess as GetCachedVerifiedProAccessFn } from '@/lib/billing/access/pro-access-resolution'
import type { invalidateCollectionsCache as InvalidateCollectionsCacheFn } from '@/lib/infra/cache'
import type {
  checkRateLimit as CheckRateLimitFn,
  deniedMessage as DeniedMessageFn,
} from '@/lib/infra/rate-limit'
import type {
  getAllCollections as GetAllCollectionsFn,
  getCollectionById as GetCollectionByIdFn,
  createCollection as CreateCollectionFn,
  updateCollection as UpdateCollectionFn,
  deleteCollection as DeleteCollectionFn,
  toggleCollectionFavorite as ToggleCollectionFavoriteFn,
} from '@/lib/db/collections'
import type { canCreateCollection as CanCreateCollectionFn } from '@/lib/db/usage'

// Route handlers are tested by invoking the exported handler with a mocked NextRequest and asserting
// res.status + await res.json(). Session/Pro/db are mocked exactly as the oRPC suite did.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof GetCachedSessionFn>() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn<typeof GetCachedVerifiedProAccessFn>(),
}))
vi.mock('@/lib/infra/cache', () => ({
  invalidateCollectionsCache: vi.fn<typeof InvalidateCollectionsCacheFn>(),
}))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn<typeof CheckRateLimitFn>(),
  deniedMessage: vi.fn<typeof DeniedMessageFn>((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/db/collections', () => ({
  getAllCollections: vi.fn<typeof GetAllCollectionsFn>(),
  getCollectionById: vi.fn<typeof GetCollectionByIdFn>(),
  createCollection: vi.fn<typeof CreateCollectionFn>(),
  updateCollection: vi.fn<typeof UpdateCollectionFn>(),
  deleteCollection: vi.fn<typeof DeleteCollectionFn>(),
  toggleCollectionFavorite: vi.fn<typeof ToggleCollectionFavoriteFn>(),
}))
vi.mock('@/lib/db/usage', () => ({
  canCreateCollection: vi.fn<typeof CanCreateCollectionFn>(),
  FREE_TIER_COLLECTION_LIMIT: 3,
}))

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
import { GET as GET_BY_ID, PATCH, DELETE } from './[id]/route'
import { PATCH as PATCH_FAVORITE } from './[id]/favorite/route'

const mockSession = vi.mocked(getCachedSession)
const mockIsPro = vi.mocked(getCachedVerifiedProAccess)
const mockGetAll = vi.mocked(getAllCollections)
const mockGetById = vi.mocked(getCollectionById)
const mockCreate = vi.mocked(createCollection)
const mockUpdate = vi.mocked(updateCollection)
const mockDelete = vi.mocked(deleteCollection)
const mockToggleFavorite = vi.mocked(toggleCollectionFavorite)
const mockCanCreate = vi.mocked(canCreateCollection)

const mockCollection = {
  id: 'col-1',
  name: 'My Collection',
  description: null,
  isFavorite: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
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
  mockSession.mockResolvedValue({
    user: { id: 'user-1', isPro: false },
    expires: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  })
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
    const body = await readJson<{ id: string }[]>(res)
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
    expect((await readJson(res)).message).toMatch(/free tier limit/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 201 with the created collection', async () => {
    mockCreate.mockResolvedValue(mockCollection)
    const res = await POST(req('POST', { name: 'My Collection' }))
    expect(res.status).toBe(201)
    expect((await readJson(res)).id).toBe('col-1')
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

describe('GET /collections/{id}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET_BY_ID(req('GET'), params('col-1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the collection does not exist or belongs to another user', async () => {
    mockGetById.mockResolvedValue(null)
    const res = await GET_BY_ID(req('GET'), params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 200 with the collection, scoped to the session userId', async () => {
    mockGetById.mockResolvedValue(mockCollection)
    const res = await GET_BY_ID(req('GET'), params('col-1'))
    expect(res.status).toBe(200)
    expect(mockGetById).toHaveBeenCalledWith('user-1', 'col-1')
    expect((await readJson(res)).id).toBe('col-1')
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
    mockUpdate.mockResolvedValue(null)
    const res = await PATCH(req('PATCH', { name: 'Updated' }), params('missing'))
    expect(res.status).toBe(404)
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
    mockDelete.mockResolvedValue(false)
    const res = await DELETE(req('DELETE'), params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 204 and deletes scoped to the session userId', async () => {
    mockDelete.mockResolvedValue(true)
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
