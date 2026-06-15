import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/items', () => ({
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  getItemForAuth: vi.fn(),
  createItem: vi.fn(),
  getRecentItemsPage: vi.fn(),
  getItemsByTypePage: vi.fn(),
  getItemsByCollectionPage: vi.fn(),
  getFavoriteItemsPage: vi.fn(),
  toggleItemFavorite: vi.fn(),
  toggleItemPinned: vi.fn(),
}))
vi.mock('@/lib/infra/cache', () => ({
  invalidateItemsCache: vi.fn(),
  invalidateCollectionsCache: vi.fn(),
}))
vi.mock('@/lib/storage/image-thumbnails', () => ({ deleteStoredFile: vi.fn() }))
vi.mock('@/lib/db/usage', () => ({ canCreateItem: vi.fn(), FREE_TIER_ITEM_LIMIT: 50 }))
vi.mock('@/lib/storage/upload-tokens', () => ({ consumePendingUpload: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ deleteFromS3: vi.fn() }))

import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { canCreateItem } from '@/lib/db/usage'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { consumePendingUpload } from '@/lib/storage/upload-tokens'
import { deleteFromS3 } from '@/lib/storage/s3'
import { auth } from '@/auth'
import { updateItem, deleteItem, getItemForAuth, createItem, toggleItemFavorite, toggleItemPinned } from '@/lib/db/items'

import { POST } from './route'
import { PATCH, DELETE } from './[id]/route'
import { PATCH as FAVORITE } from './[id]/favorite/route'
import { PATCH as PINNED } from './[id]/pinned/route'

const mockDeleteStoredFile = deleteStoredFile as ReturnType<typeof vi.fn>
const mockCanCreateItem = canCreateItem as ReturnType<typeof vi.fn>
const mockGetCachedVerifiedProAccess = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockInvalidateCollectionsCache = invalidateCollectionsCache as ReturnType<typeof vi.fn>
const mockConsumePendingUpload = consumePendingUpload as ReturnType<typeof vi.fn>
const mockDeleteFromS3 = deleteFromS3 as ReturnType<typeof vi.fn>
const mockAuth = auth as ReturnType<typeof vi.fn>
const mockUpdateItem = updateItem as ReturnType<typeof vi.fn>
const mockDeleteItem = deleteItem as ReturnType<typeof vi.fn>
const mockGetItemById = getItemForAuth as ReturnType<typeof vi.fn>
const mockCreateItem = createItem as ReturnType<typeof vi.fn>
const mockToggleItemFavorite = toggleItemFavorite as ReturnType<typeof vi.fn>
const mockToggleItemPinned = toggleItemPinned as ReturnType<typeof vi.fn>

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

interface CallOptions {
  body?: unknown
  params?: Record<string, string>
}

async function call(handler: RouteHandler, method: string, { body, params }: CallOptions = {}) {
  const req = new NextRequest('http://localhost/api/items', {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
  const res = await handler(req, { params: Promise.resolve(params ?? {}) })
  return res.json()
}

const validInput = {
  title: 'My snippet',
  description: 'A description',
  content: 'const x = 1',
  url: null,
  language: 'TypeScript',
  tags: ['react', 'hooks'],
  collectionIds: [],
}

const mockItem = { id: 'item-1', title: 'My snippet', itemType: { name: 'snippet' } }

const validCreateInput = { ...validInput, itemTypeName: 'snippet', fileUrl: null, imageWidth: null, imageHeight: null }

const validFileCreateInput = {
  title: 'My file',
  description: null,
  content: null,
  url: null,
  language: null,
  tags: [],
  collectionIds: [],
  itemTypeName: 'file',
  fileUrl: 'user-1/uuid.pdf',
  imageWidth: null,
  imageHeight: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCanCreateItem.mockResolvedValue(true)
  mockGetCachedVerifiedProAccess.mockResolvedValue(false)
  mockGetItemById.mockResolvedValue(mockItem)
  mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 1024, thumbKey: null } })
  mockDeleteFromS3.mockResolvedValue(undefined)
})

describe('POST /api/items', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(POST, 'POST', { body: validCreateInput })).status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when url is missing for link type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(POST, 'POST', { body: { ...validCreateInput, itemTypeName: 'link', url: null } })).status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when fileUrl is missing for file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(POST, 'POST', { body: { ...validCreateInput, itemTypeName: 'file', fileUrl: null } })).status).toBe('validation_error')
  })

  it('returns FORBIDDEN when free user reaches the item limit', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCanCreateItem.mockResolvedValue(false)
    const result = await call(POST, 'POST', { body: validCreateInput })
    expect(result.status).toBe('forbidden')
    expect(result.message).toMatch(/free tier limit/i)
  })

  it('returns FORBIDDEN when free user tries to create a file item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await call(POST, 'POST', { body: validFileCreateInput })
    expect(result.status).toBe('forbidden')
    expect(mockConsumePendingUpload).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when free user tries to create an image item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await call(POST, 'POST', { body: { ...validFileCreateInput, itemTypeName: 'image', fileUrl: 'user-1/pic.png' } })
    expect(result.status).toBe('forbidden')
  })

  it('returns FORBIDDEN when upload token is not found in Redis', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'not_found' })
    const result = await call(POST, 'POST', { body: validFileCreateInput })
    expect(result.status).toBe('forbidden')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when upload was issued to a different user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'unauthorized' })
    const result = await call(POST, 'POST', { body: validFileCreateInput })
    expect(result.status).toBe('forbidden')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR when Redis is unavailable during token consumption', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'unavailable' })
    const result = await call(POST, 'POST', { body: validFileCreateInput })
    expect(result.status).toBe('internal_error')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR when title is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(POST, 'POST', { body: { ...validCreateInput, title: '   ' } })).status).toBe('validation_error')
  })

  it('returns CREATED with created item on success for non-file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(mockItem)
    const result = await call(POST, 'POST', { body: validCreateInput })
    expect(result.status).toBe('created')
    expect(result.data).toEqual(mockItem)
    expect(mockConsumePendingUpload).not.toHaveBeenCalled()
    expect(mockInvalidateCollectionsCache).not.toHaveBeenCalled()
  })

  it('consumes the pending upload token and uses server-side fileName/fileSize for file items', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockCreateItem.mockResolvedValue(mockItem)
    mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 2048 } })
    const result = await call(POST, 'POST', { body: validFileCreateInput })
    expect(result.status).toBe('created')
    expect(mockConsumePendingUpload).toHaveBeenCalledWith('user-1/uuid.pdf', 'user-1')
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ fileName: 'doc.pdf', fileSize: 2048, fileUrl: 'user-1/uuid.pdf' }))
  })

  it('strips content/language/url for file type items', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockCreateItem.mockResolvedValue(mockItem)
    await call(POST, 'POST', { body: { ...validFileCreateInput, content: 'ignored', language: 'ts', url: 'https://example.com' } })
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ content: null, language: null, url: null }))
  })

  it('strips fileUrl/imageWidth/imageHeight for non-file type items', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(mockItem)
    await call(POST, 'POST', { body: { ...validCreateInput, fileUrl: 'user-1/abc.pdf', imageWidth: 100, imageHeight: 200 } })
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ fileUrl: null, imageWidth: null, imageHeight: null }))
  })

  it('passes collectionIds to dbCreateItem', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(mockItem)
    const collectionIds = ['col-1', 'col-2']
    await call(POST, 'POST', { body: { ...validCreateInput, collectionIds } })
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ collectionIds }))
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('returns INTERNAL_ERROR when createItem returns null', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(null)
    expect((await call(POST, 'POST', { body: validCreateInput })).status).toBe('internal_error')
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockRejectedValue(new Error('DB down'))
    expect((await call(POST, 'POST', { body: validCreateInput })).status).toBe('internal_error')
  })

  it('deletes S3 original and thumb when createItem returns null for a file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 1024, thumbKey: 'user-1/uuid-thumb.webp' } })
    mockCreateItem.mockResolvedValue(null)
    const result = await call(POST, 'POST', { body: validFileCreateInput })
    expect(result.status).toBe('internal_error')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid.pdf')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid-thumb.webp')
  })

  it('deletes S3 original and thumb when createItem throws for a file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 1024, thumbKey: 'user-1/uuid-thumb.webp' } })
    mockCreateItem.mockRejectedValue(new Error('DB down'))
    const result = await call(POST, 'POST', { body: validFileCreateInput })
    expect(result.status).toBe('internal_error')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid.pdf')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid-thumb.webp')
  })

  it('skips S3 cleanup when createItem fails for a non-file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(null)
    const result = await call(POST, 'POST', { body: validCreateInput })
    expect(result.status).toBe('internal_error')
    expect(mockDeleteFromS3).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/items/[id]', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(PATCH, 'PATCH', { body: validInput, params: { id: 'item-1' } })).status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when title is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(PATCH, 'PATCH', { body: { ...validInput, title: '   ' }, params: { id: 'item-1' } })).status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when url is invalid', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(PATCH, 'PATCH', { body: { ...validInput, url: 'not-a-url' }, params: { id: 'item-1' } })).status).toBe('validation_error')
  })

  it('returns NOT_FOUND when item does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue(null)
    const result = await call(PATCH, 'PATCH', { body: validInput, params: { id: 'item-1' } })
    expect(result.status).toBe('not_found')
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when free user tries to edit a file item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue({ ...mockItem, itemType: { name: 'file' } })
    const result = await call(PATCH, 'PATCH', { body: validInput, params: { id: 'item-1' } })
    expect(result.status).toBe('forbidden')
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when free user tries to edit an image item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue({ ...mockItem, itemType: { name: 'image' } })
    const result = await call(PATCH, 'PATCH', { body: validInput, params: { id: 'item-1' } })
    expect(result.status).toBe('forbidden')
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('returns OK with updated item on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockResolvedValue(mockItem)
    const result = await call(PATCH, 'PATCH', { body: validInput, params: { id: 'item-1' } })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(mockItem)
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('allows empty string for optional fields (url, description) and transforms to null', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockResolvedValue(mockItem)
    const result = await call(PATCH, 'PATCH', { body: { ...validInput, url: '', description: '' }, params: { id: 'item-1' } })
    expect(result.status).toBe('ok')
    expect(mockUpdateItem).toHaveBeenCalledWith('user-1', 'item-1', expect.objectContaining({ url: null, description: null }))
  })

  it('returns VALIDATION_ERROR when tags contain empty strings', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await call(PATCH, 'PATCH', { body: { ...validInput, tags: ['react', '', 'hooks'] }, params: { id: 'item-1' } })).status).toBe('validation_error')
  })

  it('passes collectionIds to dbUpdateItem', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockResolvedValue(mockItem)
    const collectionIds = ['col-1', 'col-2']
    await call(PATCH, 'PATCH', { body: { ...validInput, collectionIds }, params: { id: 'item-1' } })
    expect(mockUpdateItem).toHaveBeenCalledWith('user-1', 'item-1', expect.objectContaining({ collectionIds }))
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockRejectedValue(new Error('DB down'))
    expect((await call(PATCH, 'PATCH', { body: validInput, params: { id: 'item-1' } })).status).toBe('internal_error')
  })
})

describe('DELETE /api/items/[id]', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(DELETE, 'DELETE', { params: { id: 'item-1' } })).status).toBe('unauthorized')
  })

  it('returns NOT_FOUND when item does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue(null)
    expect((await call(DELETE, 'DELETE', { params: { id: 'item-1' } })).status).toBe('not_found')
  })

  it('returns INTERNAL_ERROR if delete operation fails (returns false)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue(mockItem)
    mockDeleteItem.mockResolvedValue(false)
    expect((await call(DELETE, 'DELETE', { params: { id: 'item-1' } })).status).toBe('internal_error')
  })

  it('returns OK and invalidates cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue(mockItem)
    mockDeleteItem.mockResolvedValue(true)
    const result = await call(DELETE, 'DELETE', { params: { id: 'item-1' } })
    expect(result.status).toBe('ok')
    expect(mockDeleteStoredFile).not.toHaveBeenCalled()
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('deletes file from S3 before removing the DB row', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue({ ...mockItem, fileUrl: 'user-1/abc.pdf' })
    mockDeleteItem.mockResolvedValue(true)
    const result = await call(DELETE, 'DELETE', { params: { id: 'item-1' } })
    expect(result.status).toBe('ok')
    expect(mockDeleteStoredFile).toHaveBeenCalledWith('user-1/abc.pdf')
    expect(mockDeleteStoredFile.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteItem.mock.invocationCallOrder[0])
  })

  it('returns INTERNAL_ERROR when S3 delete fails and keeps the DB row', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue({ ...mockItem, fileUrl: 'user-1/abc.pdf' })
    mockDeleteStoredFile.mockRejectedValue(new Error('S3 unavailable'))
    const result = await call(DELETE, 'DELETE', { params: { id: 'item-1' } })
    expect(result.status).toBe('internal_error')
    expect(mockDeleteItem).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockRejectedValue(new Error('DB down'))
    expect((await call(DELETE, 'DELETE', { params: { id: 'item-1' } })).status).toBe('internal_error')
  })
})

describe('PATCH /api/items/[id]/favorite', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(FAVORITE, 'PATCH', { body: { isFavorite: true }, params: { id: 'item-1' } })).status).toBe('unauthorized')
  })

  it('returns NOT_FOUND when item does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemFavorite.mockResolvedValue(false)
    expect((await call(FAVORITE, 'PATCH', { body: { isFavorite: true }, params: { id: 'item-1' } })).status).toBe('not_found')
  })

  it('returns OK and invalidates cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemFavorite.mockResolvedValue(true)
    const result = await call(FAVORITE, 'PATCH', { body: { isFavorite: true }, params: { id: 'item-1' } })
    expect(result.status).toBe('ok')
    expect(mockToggleItemFavorite).toHaveBeenCalledWith('user-1', 'item-1', true)
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemFavorite.mockRejectedValue(new Error('DB down'))
    expect((await call(FAVORITE, 'PATCH', { body: { isFavorite: true }, params: { id: 'item-1' } })).status).toBe('internal_error')
  })
})

describe('PATCH /api/items/[id]/pinned', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(PINNED, 'PATCH', { body: { isPinned: true }, params: { id: 'item-1' } })).status).toBe('unauthorized')
  })

  it('returns NOT_FOUND when item does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemPinned.mockResolvedValue(false)
    expect((await call(PINNED, 'PATCH', { body: { isPinned: true }, params: { id: 'item-1' } })).status).toBe('not_found')
  })

  it('returns OK and invalidates cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemPinned.mockResolvedValue(true)
    const result = await call(PINNED, 'PATCH', { body: { isPinned: true }, params: { id: 'item-1' } })
    expect(result.status).toBe('ok')
    expect(mockToggleItemPinned).toHaveBeenCalledWith('user-1', 'item-1', true)
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemPinned.mockRejectedValue(new Error('DB down'))
    expect((await call(PINNED, 'PATCH', { body: { isPinned: true }, params: { id: 'item-1' } })).status).toBe('internal_error')
  })
})
