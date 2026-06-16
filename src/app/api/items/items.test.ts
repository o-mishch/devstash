import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Route handlers are tested by invoking the exported handler with a mocked NextRequest and asserting
// res.status + await res.json(). Session/Pro/db/storage are mocked as the oRPC items suite did.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({
  invalidateItemsCache: vi.fn(),
  invalidateCollectionsCache: vi.fn(),
}))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/db/items', () => ({
  getRecentItemsPage: vi.fn(),
  getItemsByTypePage: vi.fn(),
  getItemsByCollectionPage: vi.fn(),
  getFavoriteItemsPage: vi.fn(),
  createItem: vi.fn(),
  getItemForAuth: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  getItemDetails: vi.fn(),
  getItemContent: vi.fn(),
  toggleItemFavorite: vi.fn(),
  toggleItemPinned: vi.fn(),
}))
vi.mock('@/lib/db/usage', () => ({ canCreateItem: vi.fn(), FREE_TIER_ITEM_LIMIT: 50 }))
vi.mock('@/lib/storage/s3', () => ({ deleteFromS3: vi.fn() }))
vi.mock('@/lib/storage/image-thumbnails', () => ({ deleteStoredFile: vi.fn() }))
vi.mock('@/lib/storage/upload-tokens', () => ({ consumePendingUpload: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import {
  getRecentItemsPage,
  getItemsByTypePage,
  getItemsByCollectionPage,
  getFavoriteItemsPage,
  createItem,
  getItemForAuth,
  updateItem,
  deleteItem,
  getItemDetails,
  getItemContent,
  toggleItemFavorite,
  toggleItemPinned,
} from '@/lib/db/items'
import { canCreateItem } from '@/lib/db/usage'
import { consumePendingUpload } from '@/lib/storage/upload-tokens'

import { GET, POST } from './route'
import { PATCH, DELETE } from './[id]/route'
import { GET as GET_DETAILS } from './[id]/details/route'
import { GET as GET_CONTENT } from './[id]/content/route'
import { PATCH as PATCH_FAVORITE } from './[id]/favorite/route'
import { PATCH as PATCH_PINNED } from './[id]/pinned/route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockRecent = getRecentItemsPage as ReturnType<typeof vi.fn>
const mockByType = getItemsByTypePage as ReturnType<typeof vi.fn>
const mockByCollection = getItemsByCollectionPage as ReturnType<typeof vi.fn>
const mockFavorites = getFavoriteItemsPage as ReturnType<typeof vi.fn>
const mockCreate = createItem as ReturnType<typeof vi.fn>
const mockGetForAuth = getItemForAuth as ReturnType<typeof vi.fn>
const mockUpdate = updateItem as ReturnType<typeof vi.fn>
const mockDelete = deleteItem as ReturnType<typeof vi.fn>
const mockGetDetails = getItemDetails as ReturnType<typeof vi.fn>
const mockGetContent = getItemContent as ReturnType<typeof vi.fn>
const mockToggleFavorite = toggleItemFavorite as ReturnType<typeof vi.fn>
const mockTogglePinned = toggleItemPinned as ReturnType<typeof vi.fn>
const mockCanCreate = canCreateItem as ReturnType<typeof vi.fn>
const mockConsumeUpload = consumePendingUpload as ReturnType<typeof vi.fn>

const lightItem = {
  id: 'item-1',
  title: 'My Snippet',
  createdAt: '2026-01-01T00:00:00.000Z',
  itemType: { name: 'snippet' },
  descriptionPreview: null,
  contentPreview: null,
  url: null,
  tags: [],
  fileName: null,
  fileSize: null,
  isFavorite: false,
  isPinned: false,
}

const page = { items: [lightItem], nextCursor: null, hasMore: false }

function get(url: string): NextRequest {
  return new NextRequest(`http://localhost/api${url}`, { method: 'GET' })
}

function body(method: string, payload?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/items', {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockCanCreate.mockResolvedValue(true)
  mockGetForAuth.mockResolvedValue({ id: 'item-1', fileUrl: null, fileName: null, itemType: { name: 'snippet' } })
})

describe('GET /items', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(get('/items?type=recent'))
    expect(res.status).toBe(401)
  })

  it('returns 422 for an unknown query type', async () => {
    const res = await GET(get('/items?type=bogus'))
    expect(res.status).toBe(422)
  })

  it('returns 422 when type=type is missing typeName', async () => {
    const res = await GET(get('/items?type=type'))
    expect(res.status).toBe(422)
  })

  it('routes type=recent to getRecentItemsPage scoped to the session userId', async () => {
    mockRecent.mockResolvedValue(page)
    const res = await GET(get('/items?type=recent'))
    expect(res.status).toBe(200)
    expect(mockRecent).toHaveBeenCalledWith('user-1', undefined)
    expect((await res.json()).items[0].id).toBe('item-1')
  })

  it('routes type=type with cursor to getItemsByTypePage', async () => {
    mockByType.mockResolvedValue(page)
    const res = await GET(get('/items?type=type&typeName=snippet&cursor=abc'))
    expect(res.status).toBe(200)
    expect(mockByType).toHaveBeenCalledWith('user-1', 'snippet', 'abc')
  })

  it('routes type=collection to getItemsByCollectionPage', async () => {
    mockByCollection.mockResolvedValue(page)
    const res = await GET(get('/items?type=collection&collectionId=col-1'))
    expect(res.status).toBe(200)
    expect(mockByCollection).toHaveBeenCalledWith('user-1', 'col-1', undefined)
  })

  it('routes type=favorites to getFavoriteItemsPage', async () => {
    mockFavorites.mockResolvedValue(page)
    const res = await GET(get('/items?type=favorites'))
    expect(res.status).toBe(200)
    expect(mockFavorites).toHaveBeenCalledWith('user-1', undefined)
  })
})

describe('POST /items', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await POST(body('POST', { title: 'x', itemTypeName: 'snippet' }))
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate-limited', async () => {
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 30 })
    const res = await POST(body('POST', { title: 'x', itemTypeName: 'snippet' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  it('returns 422 for a missing title', async () => {
    const res = await POST(body('POST', { itemTypeName: 'snippet' }))
    expect(res.status).toBe(422)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 403 when a non-Pro user creates a Pro-only type', async () => {
    const res = await POST(body('POST', { title: 'pic', itemTypeName: 'image', fileUrl: 'k' }))
    expect(res.status).toBe(403)
    expect((await res.json()).message).toMatch(/upgrade to pro/i)
  })

  it('returns 403 when the free-tier item limit is reached', async () => {
    mockCanCreate.mockResolvedValue(false)
    const res = await POST(body('POST', { title: 'x', itemTypeName: 'snippet' }))
    expect(res.status).toBe(403)
    expect((await res.json()).message).toMatch(/free tier limit/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 201 and creates scoped to the session userId (IDOR-safe — ignores body userId)', async () => {
    mockCreate.mockResolvedValue(lightItem)
    const res = await POST(body('POST', { title: 'My Snippet', itemTypeName: 'snippet', userId: 'attacker' }))
    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: 'My Snippet' }))
    expect((await res.json()).id).toBe('item-1')
  })

  it('consumes the pending upload for file types when Pro', async () => {
    mockIsPro.mockResolvedValue(true)
    mockConsumeUpload.mockResolvedValue({ ok: true, data: { fileName: 'a.png', fileSize: 10, thumbKey: 't' } })
    mockCreate.mockResolvedValue({ ...lightItem, itemType: { name: 'image' } })
    const res = await POST(body('POST', { title: 'pic', itemTypeName: 'image', fileUrl: 'uploads/user-1/a.png' }))
    expect(res.status).toBe(201)
    expect(mockConsumeUpload).toHaveBeenCalledWith('uploads/user-1/a.png', 'user-1')
  })
})

describe('PATCH /items/{id}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await PATCH(body('PATCH', { title: 'x' }), params('item-1'))
    expect(res.status).toBe(401)
  })

  it('returns 422 for an empty title', async () => {
    const res = await PATCH(body('PATCH', { title: '   ' }), params('item-1'))
    expect(res.status).toBe(422)
  })

  it('returns 404 when the item does not exist', async () => {
    mockGetForAuth.mockResolvedValue(null)
    const res = await PATCH(body('PATCH', { title: 'x' }), params('missing'))
    expect(res.status).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 403 when a non-Pro user edits a Pro-only type', async () => {
    mockGetForAuth.mockResolvedValue({ id: 'item-1', fileUrl: 'k', fileName: 'a', itemType: { name: 'image' } })
    const res = await PATCH(body('PATCH', { title: 'x' }), params('item-1'))
    expect(res.status).toBe(403)
  })

  it('returns 200 and updates scoped to the session userId', async () => {
    mockUpdate.mockResolvedValue({
      description: null,
      updatedAt: '2026-01-02T00:00:00.000Z',
      collections: [],
      url: null,
      tags: [],
      isFavorite: false,
      isPinned: false,
    })
    const res = await PATCH(body('PATCH', { title: 'Updated' }), params('item-1'))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('user-1', 'item-1', expect.objectContaining({ title: 'Updated' }))
  })
})

describe('DELETE /items/{id}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await DELETE(body('DELETE'), params('item-1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the item does not exist', async () => {
    mockGetForAuth.mockResolvedValue(null)
    const res = await DELETE(body('DELETE'), params('missing'))
    expect(res.status).toBe(404)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 204 and deletes scoped to the session userId', async () => {
    mockDelete.mockResolvedValue(true)
    const res = await DELETE(body('DELETE'), params('item-1'))
    expect(res.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith('user-1', 'item-1')
  })

  it('returns 500 when the delete fails', async () => {
    mockDelete.mockResolvedValue(false)
    const res = await DELETE(body('DELETE'), params('item-1'))
    expect(res.status).toBe(500)
  })
})

describe('GET /items/{id}/details', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET_DETAILS(get('/items/item-1/details'), params('item-1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when not found', async () => {
    mockGetDetails.mockResolvedValue(null)
    const res = await GET_DETAILS(get('/items/missing/details'), params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 200 scoped to the session userId', async () => {
    mockGetDetails.mockResolvedValue({ description: null, updatedAt: '2026-01-01T00:00:00.000Z', collections: [] })
    const res = await GET_DETAILS(get('/items/item-1/details'), params('item-1'))
    expect(res.status).toBe(200)
    expect(mockGetDetails).toHaveBeenCalledWith('user-1', 'item-1')
  })
})

describe('GET /items/{id}/content', () => {
  it('returns 404 when not found', async () => {
    mockGetContent.mockResolvedValue(null)
    const res = await GET_CONTENT(get('/items/missing/content'), params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 200 scoped to the session userId', async () => {
    mockGetContent.mockResolvedValue({ content: 'code', language: 'ts' })
    const res = await GET_CONTENT(get('/items/item-1/content'), params('item-1'))
    expect(res.status).toBe(200)
    expect(mockGetContent).toHaveBeenCalledWith('user-1', 'item-1')
  })
})

describe('PATCH /items/{id}/favorite', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await PATCH_FAVORITE(body('PATCH', { isFavorite: true }), params('item-1'))
    expect(res.status).toBe(401)
  })

  it('returns 422 for a missing isFavorite', async () => {
    const res = await PATCH_FAVORITE(body('PATCH', {}), params('item-1'))
    expect(res.status).toBe(422)
  })

  it('returns 404 when the item does not exist or belongs to another user', async () => {
    mockToggleFavorite.mockResolvedValue(false)
    const res = await PATCH_FAVORITE(body('PATCH', { isFavorite: true }), params('item-1'))
    expect(res.status).toBe(404)
  })

  it('returns 204 and toggles scoped to the session userId', async () => {
    mockToggleFavorite.mockResolvedValue(true)
    const res = await PATCH_FAVORITE(body('PATCH', { isFavorite: true }), params('item-1'))
    expect(res.status).toBe(204)
    expect(mockToggleFavorite).toHaveBeenCalledWith('user-1', 'item-1', true)
  })
})

describe('PATCH /items/{id}/pinned', () => {
  it('returns 404 when the item does not exist', async () => {
    mockTogglePinned.mockResolvedValue(false)
    const res = await PATCH_PINNED(body('PATCH', { isPinned: true }), params('item-1'))
    expect(res.status).toBe(404)
  })

  it('returns 204 and toggles scoped to the session userId', async () => {
    mockTogglePinned.mockResolvedValue(true)
    const res = await PATCH_PINNED(body('PATCH', { isPinned: true }), params('item-1'))
    expect(res.status).toBe(204)
    expect(mockTogglePinned).toHaveBeenCalledWith('user-1', 'item-1', true)
  })
})
