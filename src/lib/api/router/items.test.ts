import { vi, describe, it, expect, beforeEach } from 'vitest'
import { invoke, expectORPCError } from '@/test/orpc'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/db/items', () => ({
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  getItemForAuth: vi.fn(),
  createItem: vi.fn(),
  getRecentItemsPage: vi.fn(),
  getItemsByTypePage: vi.fn(),
  getItemsByCollectionPage: vi.fn(),
  getFavoriteItemsPage: vi.fn(),
  getItemDetails: vi.fn(),
  getItemContent: vi.fn(),
  toggleItemFavorite: vi.fn(),
  toggleItemPinned: vi.fn(),
}))
vi.mock('@/lib/infra/cache', () => ({ invalidateItemsCache: vi.fn(), invalidateCollectionsCache: vi.fn() }))
vi.mock('@/lib/storage/image-thumbnails', () => ({ deleteStoredFile: vi.fn() }))
vi.mock('@/lib/db/usage', () => ({ canCreateItem: vi.fn(), FREE_TIER_ITEM_LIMIT: 50 }))
vi.mock('@/lib/storage/upload-tokens', () => ({ consumePendingUpload: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ deleteFromS3: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { canCreateItem } from '@/lib/db/usage'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { consumePendingUpload } from '@/lib/storage/upload-tokens'
import { deleteFromS3 } from '@/lib/storage/s3'
import { updateItem, deleteItem, getItemForAuth, createItem, toggleItemFavorite, toggleItemPinned } from '@/lib/db/items'
import { itemsRouter } from './items'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockDeleteStoredFile = deleteStoredFile as ReturnType<typeof vi.fn>
const mockCanCreateItem = canCreateItem as ReturnType<typeof vi.fn>
const mockInvalidateCollectionsCache = invalidateCollectionsCache as ReturnType<typeof vi.fn>
const mockConsumePendingUpload = consumePendingUpload as ReturnType<typeof vi.fn>
const mockDeleteFromS3 = deleteFromS3 as ReturnType<typeof vi.fn>
const mockUpdateItem = updateItem as ReturnType<typeof vi.fn>
const mockDeleteItem = deleteItem as ReturnType<typeof vi.fn>
const mockGetItemForAuth = getItemForAuth as ReturnType<typeof vi.fn>
const mockCreateItem = createItem as ReturnType<typeof vi.fn>
const mockToggleItemFavorite = toggleItemFavorite as ReturnType<typeof vi.fn>
const mockToggleItemPinned = toggleItemPinned as ReturnType<typeof vi.fn>

// Uncaught DB rejections propagate as raw errors through `call` (the HTTP handler normalizes
// them to 500 — that masking is not exercised by `call`).
async function expectReject(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow()
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

// getItemForAuth shape (auth check only — not output-validated).
const mockAuthItem = { itemType: { name: 'snippet' } }

// Full LightItem — createItem output is validated against lightItemSchema.
const mockLightItem = {
  id: 'item-1',
  title: 'My snippet',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
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

// Full ItemSavedDetails — updateItem output is validated against itemSavedDetailsSchema.
const mockSavedDetails = {
  description: null,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  collections: [],
  url: null,
  tags: [],
  isFavorite: false,
  isPinned: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockCanCreateItem.mockResolvedValue(true)
  mockGetItemForAuth.mockResolvedValue(mockAuthItem)
  mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 1024, thumbKey: null } })
  mockDeleteFromS3.mockResolvedValue(undefined)
})

describe('items.create', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.create, validCreateInput), 'UNAUTHORIZED')
  })

  it('rejects when url is missing for link type', async () => {
    await expectORPCError(invoke(itemsRouter.create, { ...validCreateInput, itemTypeName: 'link', url: null }), 'BAD_REQUEST')
  })

  it('rejects when fileUrl is missing for file type', async () => {
    await expectORPCError(invoke(itemsRouter.create, { ...validCreateInput, itemTypeName: 'file', fileUrl: null }), 'BAD_REQUEST')
  })

  it('rejects an empty title', async () => {
    await expectORPCError(invoke(itemsRouter.create, { ...validCreateInput, title: '   ' }), 'BAD_REQUEST')
  })

  it('throws FORBIDDEN when the free-tier item limit is reached', async () => {
    mockCanCreateItem.mockResolvedValue(false)
    await expectORPCError(invoke(itemsRouter.create, validCreateInput), 'FORBIDDEN')
  })

  it('throws FORBIDDEN when a free user creates a file item', async () => {
    await expectORPCError(invoke(itemsRouter.create, validFileCreateInput), 'FORBIDDEN')
    expect(mockConsumePendingUpload).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when a free user creates an image item', async () => {
    await expectORPCError(invoke(itemsRouter.create, { ...validFileCreateInput, itemTypeName: 'image', fileUrl: 'user-1/pic.png' }), 'FORBIDDEN')
  })

  it('throws FORBIDDEN when the upload token is not found', async () => {
    mockIsPro.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expectORPCError(invoke(itemsRouter.create, validFileCreateInput), 'FORBIDDEN')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when the upload was issued to a different user', async () => {
    mockIsPro.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'unauthorized' })
    await expectORPCError(invoke(itemsRouter.create, validFileCreateInput), 'FORBIDDEN')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('throws INTERNAL_SERVER_ERROR when Redis is unavailable during token consumption', async () => {
    mockIsPro.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'unavailable' })
    await expectORPCError(invoke(itemsRouter.create, validFileCreateInput), 'INTERNAL_SERVER_ERROR')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('returns the created item for a non-file type', async () => {
    mockCreateItem.mockResolvedValue(mockLightItem)
    const result = await invoke(itemsRouter.create, validCreateInput)
    expect(result).toEqual(mockLightItem)
    expect(mockConsumePendingUpload).not.toHaveBeenCalled()
    expect(mockInvalidateCollectionsCache).not.toHaveBeenCalled()
  })

  it('consumes the pending upload token and uses server-side fileName/fileSize for file items', async () => {
    mockIsPro.mockResolvedValue(true)
    mockCreateItem.mockResolvedValue(mockLightItem)
    mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 2048, thumbKey: null } })
    await invoke(itemsRouter.create, validFileCreateInput)
    expect(mockConsumePendingUpload).toHaveBeenCalledWith('user-1/uuid.pdf', 'user-1')
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ fileName: 'doc.pdf', fileSize: 2048, fileUrl: 'user-1/uuid.pdf' }))
  })

  it('strips content/language/url for file type items', async () => {
    mockIsPro.mockResolvedValue(true)
    mockCreateItem.mockResolvedValue(mockLightItem)
    await invoke(itemsRouter.create, { ...validFileCreateInput, content: 'ignored', language: 'ts', url: 'https://example.com' })
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ content: null, language: null, url: null }))
  })

  it('strips fileUrl/imageWidth/imageHeight for non-file type items', async () => {
    mockCreateItem.mockResolvedValue(mockLightItem)
    await invoke(itemsRouter.create, { ...validCreateInput, fileUrl: 'user-1/abc.pdf', imageWidth: 100, imageHeight: 200 })
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ fileUrl: null, imageWidth: null, imageHeight: null }))
  })

  it('passes collectionIds to createItem and invalidates the collections cache', async () => {
    mockCreateItem.mockResolvedValue(mockLightItem)
    const collectionIds = ['col-1', 'col-2']
    await invoke(itemsRouter.create, { ...validCreateInput, collectionIds })
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ collectionIds }))
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('throws INTERNAL_SERVER_ERROR when createItem returns null', async () => {
    mockCreateItem.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.create, validCreateInput), 'INTERNAL_SERVER_ERROR')
  })

  it('throws INTERNAL_SERVER_ERROR when createItem rejects (caught)', async () => {
    mockCreateItem.mockRejectedValue(new Error('DB down'))
    await expectORPCError(invoke(itemsRouter.create, validCreateInput), 'INTERNAL_SERVER_ERROR')
  })

  it('deletes S3 original and thumb when createItem returns null for a file type', async () => {
    mockIsPro.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 1024, thumbKey: 'user-1/uuid-thumb.webp' } })
    mockCreateItem.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.create, validFileCreateInput), 'INTERNAL_SERVER_ERROR')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid.pdf')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid-thumb.webp')
  })

  it('skips S3 cleanup when createItem fails for a non-file type', async () => {
    mockCreateItem.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.create, validCreateInput), 'INTERNAL_SERVER_ERROR')
    expect(mockDeleteFromS3).not.toHaveBeenCalled()
  })
})

describe('items.update', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.update, { id: 'item-1', ...validInput }), 'UNAUTHORIZED')
  })

  it('rejects an empty title', async () => {
    await expectORPCError(invoke(itemsRouter.update, { id: 'item-1', ...validInput, title: '   ' }), 'BAD_REQUEST')
  })

  it('rejects an invalid url', async () => {
    await expectORPCError(invoke(itemsRouter.update, { id: 'item-1', ...validInput, url: 'not-a-url' }), 'BAD_REQUEST')
  })

  it('rejects tags containing empty strings', async () => {
    await expectORPCError(invoke(itemsRouter.update, { id: 'item-1', ...validInput, tags: ['react', '', 'hooks'] }), 'BAD_REQUEST')
  })

  it('throws NOT_FOUND when the item does not exist', async () => {
    mockGetItemForAuth.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.update, { id: 'item-1', ...validInput }), 'NOT_FOUND')
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when a free user edits a file item', async () => {
    mockGetItemForAuth.mockResolvedValue({ itemType: { name: 'file' } })
    await expectORPCError(invoke(itemsRouter.update, { id: 'item-1', ...validInput }), 'FORBIDDEN')
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('returns the updated item on success and invalidates the collections cache', async () => {
    mockUpdateItem.mockResolvedValue(mockSavedDetails)
    const result = await invoke(itemsRouter.update, { id: 'item-1', ...validInput })
    expect(result).toEqual(mockSavedDetails)
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('transforms empty url/description to null', async () => {
    mockUpdateItem.mockResolvedValue(mockSavedDetails)
    await invoke(itemsRouter.update, { id: 'item-1', ...validInput, url: '', description: '' })
    expect(mockUpdateItem).toHaveBeenCalledWith('user-1', 'item-1', expect.objectContaining({ url: null, description: null }))
  })

  it('passes collectionIds to updateItem', async () => {
    mockUpdateItem.mockResolvedValue(mockSavedDetails)
    const collectionIds = ['col-1', 'col-2']
    await invoke(itemsRouter.update, { id: 'item-1', ...validInput, collectionIds })
    expect(mockUpdateItem).toHaveBeenCalledWith('user-1', 'item-1', expect.objectContaining({ collectionIds }))
  })

  it('rejects on unexpected DB failure', async () => {
    mockUpdateItem.mockRejectedValue(new Error('DB down'))
    await expectReject(invoke(itemsRouter.update, { id: 'item-1', ...validInput }))
  })
})

describe('items.remove', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.remove, { id: 'item-1' }), 'UNAUTHORIZED')
  })

  it('throws NOT_FOUND when the item does not exist', async () => {
    mockGetItemForAuth.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.remove, { id: 'item-1' }), 'NOT_FOUND')
  })

  it('throws INTERNAL_SERVER_ERROR when deleteItem returns false', async () => {
    mockGetItemForAuth.mockResolvedValue(mockAuthItem)
    mockDeleteItem.mockResolvedValue(false)
    await expectORPCError(invoke(itemsRouter.remove, { id: 'item-1' }), 'INTERNAL_SERVER_ERROR')
  })

  it('deletes and invalidates the cache on success', async () => {
    mockGetItemForAuth.mockResolvedValue(mockAuthItem)
    mockDeleteItem.mockResolvedValue(true)
    await invoke(itemsRouter.remove, { id: 'item-1' })
    expect(mockDeleteStoredFile).not.toHaveBeenCalled()
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('deletes the file from S3 before removing the DB row', async () => {
    mockGetItemForAuth.mockResolvedValue({ ...mockAuthItem, fileUrl: 'user-1/abc.pdf' })
    mockDeleteItem.mockResolvedValue(true)
    await invoke(itemsRouter.remove, { id: 'item-1' })
    expect(mockDeleteStoredFile).toHaveBeenCalledWith('user-1/abc.pdf')
    expect(mockDeleteStoredFile.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteItem.mock.invocationCallOrder[0])
  })

  it('throws INTERNAL_SERVER_ERROR and keeps the DB row when the S3 delete fails', async () => {
    mockGetItemForAuth.mockResolvedValue({ ...mockAuthItem, fileUrl: 'user-1/abc.pdf' })
    mockDeleteStoredFile.mockRejectedValue(new Error('S3 unavailable'))
    await expectORPCError(invoke(itemsRouter.remove, { id: 'item-1' }), 'INTERNAL_SERVER_ERROR')
    expect(mockDeleteItem).not.toHaveBeenCalled()
  })

  it('rejects on unexpected DB failure', async () => {
    mockGetItemForAuth.mockRejectedValue(new Error('DB down'))
    await expectReject(invoke(itemsRouter.remove, { id: 'item-1' }))
  })
})

describe('items.toggleFavorite', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.toggleFavorite, { id: 'item-1', isFavorite: true }), 'UNAUTHORIZED')
  })

  it('throws NOT_FOUND when the item does not exist or belongs to another user', async () => {
    mockToggleItemFavorite.mockResolvedValue(false)
    await expectORPCError(invoke(itemsRouter.toggleFavorite, { id: 'item-1', isFavorite: true }), 'NOT_FOUND')
  })

  it('toggles scoped to the session userId on success', async () => {
    mockToggleItemFavorite.mockResolvedValue(true)
    await invoke(itemsRouter.toggleFavorite, { id: 'item-1', isFavorite: true })
    expect(mockToggleItemFavorite).toHaveBeenCalledWith('user-1', 'item-1', true)
  })

  it('rejects on unexpected DB failure', async () => {
    mockToggleItemFavorite.mockRejectedValue(new Error('DB down'))
    await expectReject(invoke(itemsRouter.toggleFavorite, { id: 'item-1', isFavorite: true }))
  })
})

describe('items.togglePinned', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(itemsRouter.togglePinned, { id: 'item-1', isPinned: true }), 'UNAUTHORIZED')
  })

  it('throws NOT_FOUND when the item does not exist or belongs to another user', async () => {
    mockToggleItemPinned.mockResolvedValue(false)
    await expectORPCError(invoke(itemsRouter.togglePinned, { id: 'item-1', isPinned: true }), 'NOT_FOUND')
  })

  it('toggles scoped to the session userId on success', async () => {
    mockToggleItemPinned.mockResolvedValue(true)
    await invoke(itemsRouter.togglePinned, { id: 'item-1', isPinned: true })
    expect(mockToggleItemPinned).toHaveBeenCalledWith('user-1', 'item-1', true)
  })

  it('rejects on unexpected DB failure', async () => {
    mockToggleItemPinned.mockRejectedValue(new Error('DB down'))
    await expectReject(invoke(itemsRouter.togglePinned, { id: 'item-1', isPinned: true }))
  })
})
