import { vi, describe, it, expect, beforeEach } from 'vitest'
import { anything } from '@/test/matchers'
import { NextRequest } from 'next/server'

// Exercises the single-item GET that powers the source deep-link drawer: auth (401), 404 for a
// foreign/missing item (IDOR), and 200 with the full item scoped to the session userId.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/db/items', () => ({
  getItemById: vi.fn(),
  getItemForAuth: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))
vi.mock('@/lib/infra/cache', () => ({ invalidateItemsCache: vi.fn(), invalidateCollectionsCache: vi.fn() }))
vi.mock('@/lib/storage/image-thumbnails', () => ({ deleteStoredFile: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { getItemById, getItemForAuth, updateItem } from '@/lib/db/items'
import { GET, PATCH } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockGetById = getItemById as ReturnType<typeof vi.fn>
const mockGetForAuth = getItemForAuth as ReturnType<typeof vi.fn>
const mockUpdate = updateItem as ReturnType<typeof vi.fn>
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/items/item-1')
}
function patchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/items/item-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const ctx = { params: Promise.resolve({ id: 'item-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockPro.mockResolvedValue(true)
  mockRateLimit.mockResolvedValue({ success: true })
})

describe('GET /items/{id}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(401)
    expect(mockGetById).not.toHaveBeenCalled()
  })

  it('returns 404 when the item is not the user\'s (IDOR-scoped)', async () => {
    mockGetById.mockResolvedValue(null)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(404)
    expect(mockGetById).toHaveBeenCalledWith('user-1', 'item-1')
  })

  it('returns 200 with the full item for an owned item', async () => {
    const item = { id: 'item-1', title: 'Note', itemType: { name: 'note' }, content: 'body', description: null, collections: [] }
    mockGetById.mockResolvedValue(item)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'item-1', content: 'body' })
  })
})

describe('PATCH /items/{id} — live type change (v3)', () => {
  it('passes an allowed text target (note→command) through to updateItem', async () => {
    mockGetForAuth.mockResolvedValue({ id: 'item-1', fileUrl: null, fileName: null, itemType: { name: 'note' } })
    mockUpdate.mockResolvedValue({ id: 'item-1', updatedAt: new Date().toISOString(), tags: [], collections: [] })
    const res = await PATCH(patchReq({ title: 'T', tags: [], collectionIds: [], itemTypeName: 'command' }), ctx)
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      'user-1',
      'item-1',
      expect.objectContaining({ itemTypeName: 'command' }),
    )
  })

  it('rejects a non-text target (link) with 422 before touching the DB', async () => {
    const res = await PATCH(patchReq({ title: 'T', tags: [], collectionIds: [], itemTypeName: 'link' }), ctx)
    expect(res.status).toBe(422)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects file/image targets with 422', async () => {
    for (const target of ['file', 'image']) {
      const res = await PATCH(patchReq({ title: 'T', tags: [], collectionIds: [], itemTypeName: target }), ctx)
      expect(res.status).toBe(422)
    }
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects re-typing a non-text source (file→note) with 422 before touching the DB', async () => {
    mockGetForAuth.mockResolvedValue({ id: 'item-1', fileUrl: 'f.txt', fileName: 'f.txt', itemType: { name: 'file' } })
    const res = await PATCH(patchReq({ title: 'T', tags: [], collectionIds: [], itemTypeName: 'note' }), ctx)
    expect(res.status).toBe(422)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 401 when not signed in (before any DB access)', async () => {
    mockSession.mockResolvedValue(null)
    const res = await PATCH(patchReq({ title: 'T', tags: [], collectionIds: [] }), ctx)
    expect(res.status).toBe(401)
    expect(mockGetForAuth).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 403 when a non-Pro user edits a Pro-type (file) item', async () => {
    mockPro.mockResolvedValue(false)
    mockGetForAuth.mockResolvedValue({ id: 'item-1', fileUrl: 'f.txt', fileName: 'f.txt', itemType: { name: 'file' } })
    const res = await PATCH(patchReq({ title: 'T', tags: [], collectionIds: [] }), ctx)
    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 when the item is not the user\'s (IDOR-scoped)', async () => {
    mockGetForAuth.mockResolvedValue(null)
    const res = await PATCH(patchReq({ title: 'T', tags: [], collectionIds: [] }), ctx)
    expect(res.status).toBe(404)
    expect(mockGetForAuth).toHaveBeenCalledWith('user-1', 'item-1')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('leaves the type unchanged when itemTypeName is omitted', async () => {
    mockGetForAuth.mockResolvedValue({ id: 'item-1', fileUrl: null, fileName: null, itemType: { name: 'note' } })
    mockUpdate.mockResolvedValue({ id: 'item-1', updatedAt: new Date().toISOString(), tags: [], collections: [] })
    const res = await PATCH(patchReq({ title: 'T', tags: [], collectionIds: [] }), ctx)
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('user-1', 'item-1', expect.not.objectContaining({ itemTypeName: anything() }))
  })
})
