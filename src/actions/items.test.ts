import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/items', () => ({ updateItem: vi.fn() }))
vi.mock('@/lib/cache', () => ({ invalidateItemsCache: vi.fn() }))

import { auth } from '@/auth'
import { updateItem } from '@/lib/db/items'
import { updateItemAction } from './items'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockUpdateItem = updateItem as ReturnType<typeof vi.fn>

const validInput = {
  title: 'My snippet',
  description: 'A description',
  content: 'const x = 1',
  url: null,
  language: 'TypeScript',
  tags: ['react', 'hooks'],
}

const mockItem = {
  id: 'item-1',
  title: 'My snippet',
  itemType: { name: 'snippet' },
}

beforeEach(() => vi.clearAllMocks())

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

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateItem.mockRejectedValue(new Error('DB down'))
    const result = await updateItemAction('item-1', validInput)
    expect(result.status).toBe('internal_error')
  })
})
