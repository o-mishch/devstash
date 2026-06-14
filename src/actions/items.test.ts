import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/db/items', () => ({ updateItem: vi.fn(), deleteItem: vi.fn(), getItemForAuth: vi.fn(), createItem: vi.fn(), getRecentItemsPage: vi.fn(), getItemsByTypePage: vi.fn(), getItemsByCollectionPage: vi.fn(), getFavoriteItemsPage: vi.fn(), toggleItemFavorite: vi.fn(), toggleItemPinned: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({
  invalidateItemsCache: vi.fn(),
  invalidateCollectionsCache: vi.fn(),
}))
vi.mock('@/lib/storage/image-thumbnails', () => ({
  deleteStoredFile: vi.fn(),
}))
vi.mock('@/lib/db/usage', () => ({
  canCreateItem: vi.fn(),
  FREE_TIER_ITEM_LIMIT: 50,
}))
vi.mock('@/lib/storage/upload-tokens', () => ({
  consumePendingUpload: vi.fn(),
}))

vi.mock('@/lib/storage/s3', () => ({
  deleteFromS3: vi.fn(),
}))

import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { canCreateItem } from '@/lib/db/usage'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { consumePendingUpload } from '@/lib/storage/upload-tokens'
import { deleteFromS3 } from '@/lib/storage/s3'

const mockDeleteStoredFile = deleteStoredFile as ReturnType<typeof vi.fn>
const mockCanCreateItem = canCreateItem as ReturnType<typeof vi.fn>
const mockGetCachedVerifiedProAccess = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockInvalidateCollectionsCache = invalidateCollectionsCache as ReturnType<typeof vi.fn>
const mockConsumePendingUpload = consumePendingUpload as ReturnType<typeof vi.fn>
const mockDeleteFromS3 = deleteFromS3 as ReturnType<typeof vi.fn>

import { auth } from '@/auth'
import { updateItem, deleteItem, getItemForAuth, createItem, toggleItemFavorite, toggleItemPinned } from '@/lib/db/items'
import {
  updateItemAction,
  deleteItemAction,
  createItemAction,
  fetchMoreItemsAction,
  toggleItemFavoriteAction,
  toggleItemPinnedAction,
} from './items'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockUpdateItem = updateItem as ReturnType<typeof vi.fn>
const mockDeleteItem = deleteItem as ReturnType<typeof vi.fn>
const mockGetItemById = getItemForAuth as ReturnType<typeof vi.fn>
const mockCreateItem = createItem as ReturnType<typeof vi.fn>
const mockToggleItemFavorite = toggleItemFavorite as ReturnType<typeof vi.fn>
const mockToggleItemPinned = toggleItemPinned as ReturnType<typeof vi.fn>

const validInput = {
  title: 'My snippet',
  description: 'A description',
  content: 'const x = 1',
  url: null,
  language: 'TypeScript',
  tags: ['react', 'hooks'],
  collectionIds: [],
}

const mockItem = {
  id: 'item-1',
  title: 'My snippet',
  itemType: { name: 'snippet' },
}

const validCreateInput = {
  ...validInput,
  itemTypeName: 'snippet',
  fileUrl: null,
  imageWidth: null,
  imageHeight: null,
}

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

describe('createItemAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await createItemAction(validCreateInput)
    expect(result.status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when url is missing for link type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await createItemAction({ ...validCreateInput, itemTypeName: 'link', url: null })
    expect(result.status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when fileUrl is missing for file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await createItemAction({ ...validCreateInput, itemTypeName: 'file', fileUrl: null })
    expect(result.status).toBe('validation_error')
  })

  it('returns FORBIDDEN when free user reaches the item limit', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCanCreateItem.mockResolvedValue(false)
    const result = await createItemAction(validCreateInput)
    expect(result.status).toBe('forbidden')
    expect(result.message).toMatch(/free tier limit/i)
  })

  it('returns FORBIDDEN when free user tries to create a file item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(false)
    const result = await createItemAction(validFileCreateInput)
    expect(result.status).toBe('forbidden')
    expect(mockConsumePendingUpload).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when free user tries to create an image item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(false)
    const result = await createItemAction({ ...validFileCreateInput, itemTypeName: 'image', fileUrl: 'user-1/pic.png' })
    expect(result.status).toBe('forbidden')
  })

  it('returns FORBIDDEN when upload token is not found in Redis', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'not_found' })
    const result = await createItemAction(validFileCreateInput)
    expect(result.status).toBe('forbidden')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when upload was issued to a different user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'unauthorized' })
    const result = await createItemAction(validFileCreateInput)
    expect(result.status).toBe('forbidden')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR when Redis is unavailable during token consumption', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: false, reason: 'unavailable' })
    const result = await createItemAction(validFileCreateInput)
    expect(result.status).toBe('internal_error')
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR when title is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await createItemAction({ ...validCreateInput, title: '   ' })
    expect(result.status).toBe('validation_error')
  })

  it('returns CREATED with created item on success for non-file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(mockItem)
    const result = await createItemAction(validCreateInput)
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
    const result = await createItemAction(validFileCreateInput)
    expect(result.status).toBe('created')
    expect(mockConsumePendingUpload).toHaveBeenCalledWith('user-1/uuid.pdf', 'user-1')
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ fileName: 'doc.pdf', fileSize: 2048, fileUrl: 'user-1/uuid.pdf' })
    )
  })

  it('strips content/language/url for file type items', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockCreateItem.mockResolvedValue(mockItem)
    await createItemAction({ ...validFileCreateInput, content: 'ignored', language: 'ts', url: 'https://example.com' })
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ content: null, language: null, url: null })
    )
  })

  it('strips fileUrl/imageWidth/imageHeight for non-file type items', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(mockItem)
    await createItemAction({ ...validCreateInput, fileUrl: 'user-1/abc.pdf', imageWidth: 100, imageHeight: 200 })
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ fileUrl: null, imageWidth: null, imageHeight: null })
    )
  })

  it('passes collectionIds to dbCreateItem', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(mockItem)
    const collectionIds = ['col-1', 'col-2']
    await createItemAction({ ...validCreateInput, collectionIds })
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ collectionIds })
    )
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('returns INTERNAL_ERROR when createItem returns null', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(null)
    const result = await createItemAction(validCreateInput)
    expect(result.status).toBe('internal_error')
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockRejectedValue(new Error('DB down'))
    const result = await createItemAction(validCreateInput)
    expect(result.status).toBe('internal_error')
  })

  it('deletes S3 original and thumb when createItem returns null for a file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 1024, thumbKey: 'user-1/uuid-thumb.webp' } })
    mockCreateItem.mockResolvedValue(null)
    const result = await createItemAction(validFileCreateInput)
    expect(result.status).toBe('internal_error')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid.pdf')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid-thumb.webp')
  })

  it('deletes S3 original and thumb when createItem throws for a file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(true)
    mockConsumePendingUpload.mockResolvedValue({ ok: true, data: { fileName: 'doc.pdf', fileSize: 1024, thumbKey: 'user-1/uuid-thumb.webp' } })
    mockCreateItem.mockRejectedValue(new Error('DB down'))
    const result = await createItemAction(validFileCreateInput)
    expect(result.status).toBe('internal_error')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid.pdf')
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid-thumb.webp')
  })

  it('skips S3 cleanup when createItem fails for a non-file type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(null)
    const result = await createItemAction(validCreateInput)
    expect(result.status).toBe('internal_error')
    expect(mockDeleteFromS3).not.toHaveBeenCalled()
  })
})

describe('updateItemAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when title is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await updateItemAction('item-1', { ...validInput, title: '   ' })
    expect(result.status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when url is invalid', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await updateItemAction('item-1', { ...validInput, url: 'not-a-url' })
    expect(result.status).toBe('validation_error')
  })

  it('returns NOT_FOUND when item does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue(null)
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('not_found')
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when free user tries to edit a file item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(false)
    mockGetItemById.mockResolvedValue({ ...mockItem, itemType: { name: 'file' } })
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('forbidden')
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when free user tries to edit an image item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCachedVerifiedProAccess.mockResolvedValue(false)
    mockGetItemById.mockResolvedValue({ ...mockItem, itemType: { name: 'image' } })
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('forbidden')
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('returns OK with updated item on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockResolvedValue(mockItem)
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(mockItem)
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('allows empty string for optional fields (url, description) and transforms to null', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockResolvedValue(mockItem)
    const result = await updateItemAction('item-1', { ...validInput, url: '', description: '' })
    expect(result.status).toBe('ok')
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'user-1',
      'item-1',
      expect.objectContaining({ url: null, description: null })
    )
  })

  it('returns VALIDATION_ERROR when tags contain empty strings', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await updateItemAction('item-1', { ...validInput, tags: ['react', '', 'hooks'] })
    expect(result.status).toBe('validation_error')
  })

  it('passes collectionIds to dbUpdateItem', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockResolvedValue(mockItem)
    const collectionIds = ['col-1', 'col-2']
    await updateItemAction('item-1', { ...validInput, collectionIds })
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'user-1',
      'item-1',
      expect.objectContaining({ collectionIds })
    )
  })

  it('passes empty collectionIds when none provided', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockResolvedValue(mockItem)
    await updateItemAction('item-1', { ...validInput, collectionIds: [] })
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'user-1',
      'item-1',
      expect.objectContaining({ collectionIds: [] })
    )
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockRejectedValue(new Error('DB down'))
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('internal_error')
  })
})

describe('deleteItemAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('unauthorized')
  })

  it('returns NOT_FOUND when item does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue(null)
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('not_found')
  })

  it('returns INTERNAL_ERROR if delete operation fails (returns false)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue(mockItem)
    mockDeleteItem.mockResolvedValue(false)
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('internal_error')
  })

  it('returns OK and invalidates cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue(mockItem)
    mockDeleteItem.mockResolvedValue(true)
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('ok')
    expect(mockDeleteStoredFile).not.toHaveBeenCalled()
    expect(mockInvalidateCollectionsCache).toHaveBeenCalledWith('user-1')
  })

  it('deletes file from S3 before removing the DB row', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue({ ...mockItem, fileUrl: 'user-1/abc.pdf' })
    mockDeleteItem.mockResolvedValue(true)
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('ok')
    expect(mockDeleteStoredFile).toHaveBeenCalledWith('user-1/abc.pdf')
    expect(mockDeleteStoredFile.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteItem.mock.invocationCallOrder[0])
  })

  it('returns INTERNAL_ERROR when S3 delete fails and keeps the DB row', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue({ ...mockItem, fileUrl: 'user-1/abc.pdf' })
    mockDeleteStoredFile.mockRejectedValue(new Error('R2 unavailable'))
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('internal_error')
    expect(mockDeleteItem).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockRejectedValue(new Error('DB down'))
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('internal_error')
  })
})

describe('fetchMoreItemsAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)

    const result = await fetchMoreItemsAction({ type: 'recent' })

    expect(result.status).toBe('unauthorized')
  })

  it('returns validation_error for invalid query type at runtime', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })

    const result = await fetchMoreItemsAction({ type: 'invalid' } as never)

    expect(result.status).toBe('validation_error')
  })

  it('returns validation_error when type query is missing typeName', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })

    const result = await fetchMoreItemsAction({ type: 'type', typeName: '   ' })

    expect(result.status).toBe('validation_error')
  })

  it('calls getRecentItemsPage when type is recent', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const mockPage = { items: [], nextCursor: null, hasMore: false }
    const { getRecentItemsPage } = await import('@/lib/db/items')
    vi.mocked(getRecentItemsPage).mockResolvedValue(mockPage)

    const { fetchMoreItemsAction } = await import('./items')
    const result = await fetchMoreItemsAction({ type: 'recent' }, 'cursor-1')

    expect(getRecentItemsPage).toHaveBeenCalledWith('user-1', 'cursor-1')
    expect(result).toEqual({ status: 'ok', data: mockPage, message: null })
  })

  it('calls getItemsByTypePage when type is type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const mockPage = { items: [], nextCursor: null, hasMore: false }
    const { getItemsByTypePage } = await import('@/lib/db/items')
    vi.mocked(getItemsByTypePage).mockResolvedValue(mockPage)

    const { fetchMoreItemsAction } = await import('./items')
    const result = await fetchMoreItemsAction({ type: 'type', typeName: 'snippet' }, 'cursor-1')

    expect(getItemsByTypePage).toHaveBeenCalledWith('user-1', 'snippet', 'cursor-1')
    expect(result).toEqual({ status: 'ok', data: mockPage, message: null })
  })

  it('calls getItemsByCollectionPage when type is collection', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const mockPage = { items: [], nextCursor: null, hasMore: false }
    const { getItemsByCollectionPage } = await import('@/lib/db/items')
    vi.mocked(getItemsByCollectionPage).mockResolvedValue(mockPage)

    const { fetchMoreItemsAction } = await import('./items')
    const result = await fetchMoreItemsAction({ type: 'collection', collectionId: 'col-1' }, 'cursor-1')

    expect(getItemsByCollectionPage).toHaveBeenCalledWith('user-1', 'col-1', 'cursor-1')
    expect(result).toEqual({ status: 'ok', data: mockPage, message: null })
  })

  it('calls getFavoriteItemsPage when type is favorites', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const mockPage = { items: [], nextCursor: null, hasMore: false }
    const { getFavoriteItemsPage } = await import('@/lib/db/items')
    vi.mocked(getFavoriteItemsPage).mockResolvedValue(mockPage)

    const { fetchMoreItemsAction } = await import('./items')
    const result = await fetchMoreItemsAction({ type: 'favorites' }, 'cursor-1')

    expect(getFavoriteItemsPage).toHaveBeenCalledWith('user-1', 'cursor-1')
    expect(result).toEqual({ status: 'ok', data: mockPage, message: null })
  })
})

describe('toggleItemFavoriteAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await toggleItemFavoriteAction('item-1', true)
    expect(result.status).toBe('unauthorized')
  })

  it('returns NOT_FOUND when item does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemFavorite.mockResolvedValue(false)
    const result = await toggleItemFavoriteAction('item-1', true)
    expect(result.status).toBe('not_found')
  })

  it('returns OK and invalidates cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemFavorite.mockResolvedValue(true)
    const result = await toggleItemFavoriteAction('item-1', true)
    expect(result.status).toBe('ok')
    expect(mockToggleItemFavorite).toHaveBeenCalledWith('user-1', 'item-1', true)
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemFavorite.mockRejectedValue(new Error('DB down'))
    const result = await toggleItemFavoriteAction('item-1', true)
    expect(result.status).toBe('internal_error')
  })
})

describe('toggleItemPinnedAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await toggleItemPinnedAction('item-1', true)
    expect(result.status).toBe('unauthorized')
  })

  it('returns NOT_FOUND when item does not exist or belongs to another user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemPinned.mockResolvedValue(false)
    const result = await toggleItemPinnedAction('item-1', true)
    expect(result.status).toBe('not_found')
  })

  it('returns OK and invalidates cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemPinned.mockResolvedValue(true)
    const result = await toggleItemPinnedAction('item-1', true)
    expect(result.status).toBe('ok')
    expect(mockToggleItemPinned).toHaveBeenCalledWith('user-1', 'item-1', true)
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockToggleItemPinned.mockRejectedValue(new Error('DB down'))
    const result = await toggleItemPinnedAction('item-1', true)
    expect(result.status).toBe('internal_error')
  })
})
