import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/items', () => ({ updateItem: vi.fn(), deleteItem: vi.fn(), getItemById: vi.fn(), createItem: vi.fn(), getRecentItemsPage: vi.fn(), getItemsByTypePage: vi.fn(), getItemsByCollectionPage: vi.fn(), getFavoriteItemsPage: vi.fn(), toggleItemFavorite: vi.fn(), toggleItemPinned: vi.fn() }))
vi.mock('@/lib/cache', () => ({ invalidateItemsCache: vi.fn() }))
vi.mock('@/lib/filebase', () => ({ deleteFromFilebase: vi.fn() }))
vi.mock('@/lib/usage', () => ({ canCreateItem: vi.fn() }))

import { deleteFromFilebase } from '@/lib/filebase'
import { canCreateItem } from '@/lib/usage'

const mockDeleteFromFilebase = deleteFromFilebase as ReturnType<typeof vi.fn>
const mockCanCreateItem = canCreateItem as ReturnType<typeof vi.fn>

import { auth } from '@/auth'
import { updateItem, deleteItem, getItemById, createItem, toggleItemFavorite, toggleItemPinned } from '@/lib/db/items'
import { updateItemAction, deleteItemAction, createItemAction, toggleItemFavoriteAction, toggleItemPinnedAction } from './items'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockUpdateItem = updateItem as ReturnType<typeof vi.fn>
const mockDeleteItem = deleteItem as ReturnType<typeof vi.fn>
const mockGetItemById = getItemById as ReturnType<typeof vi.fn>
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
  fileName: null,
  fileSize: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCanCreateItem.mockResolvedValue(true)
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

  it('returns FORBIDDEN when free user tries to create a file item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', isPro: false } })
    const result = await createItemAction({ ...validCreateInput, itemTypeName: 'file', fileUrl: 'user-1/doc.pdf', fileName: 'doc.pdf', fileSize: 1024 })
    expect(result.status).toBe('forbidden')
  })

  it('returns FORBIDDEN when free user tries to create an image item', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', isPro: false } })
    const result = await createItemAction({ ...validCreateInput, itemTypeName: 'image', fileUrl: 'user-1/pic.png', fileName: 'pic.png', fileSize: 1024 })
    expect(result.status).toBe('forbidden')
  })

  it('returns FORBIDDEN when fileUrl does not belong to the authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', isPro: true } })
    const result = await createItemAction({ ...validCreateInput, itemTypeName: 'image', fileUrl: 'other-user/abc.png' })
    expect(result.status).toBe('forbidden')
  })

  it('returns VALIDATION_ERROR when title is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await createItemAction({ ...validCreateInput, title: '   ' })
    expect(result.status).toBe('validation_error')
  })

  it('returns CREATED with created item on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(mockItem)
    const result = await createItemAction(validCreateInput)
    expect(result.status).toBe('created')
    expect(result.data).toEqual(mockItem)
  })

  it('returns CREATED when fileUrl belongs to the authenticated user (requires Pro)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', isPro: true } })
    mockCreateItem.mockResolvedValue(mockItem)
    const result = await createItemAction({ ...validCreateInput, itemTypeName: 'image', fileUrl: 'user-1/abc.png', fileName: 'abc.png', fileSize: 1024 })
    expect(result.status).toBe('created')
    expect(mockCreateItem).toHaveBeenCalled()
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
  })

  it('passes empty collectionIds when none provided', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateItem.mockResolvedValue(mockItem)
    await createItemAction({ ...validCreateInput, collectionIds: [] })
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ collectionIds: [] })
    )
  })

  it('returns INTERNAL_ERROR when createItem returns null (item type not found)', async () => {
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
    mockUpdateItem.mockResolvedValue(null)
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('not_found')
  })

  it('returns OK with updated item on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockResolvedValue(mockItem)
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(mockItem)
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
    expect(mockDeleteFromFilebase).not.toHaveBeenCalled()
  })

  it('deletes file from filebase when item has fileUrl', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockResolvedValue({ ...mockItem, fileUrl: 'user-1/abc.pdf' })
    mockDeleteItem.mockResolvedValue(true)
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('ok')
    expect(mockDeleteFromFilebase).toHaveBeenCalledWith('user-1/abc.pdf')
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetItemById.mockRejectedValue(new Error('DB down'))
    const result = await deleteItemAction('item-1')
    expect(result.status).toBe('internal_error')
  })
})

describe('fetchMoreItemsAction', () => {
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
