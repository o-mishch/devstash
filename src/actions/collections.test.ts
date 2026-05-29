import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/collections', () => ({
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({ invalidateCollectionsCache: vi.fn() }))

import { auth } from '@/auth'
import { createCollection, updateCollection, deleteCollection } from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/cache'
import { createCollectionAction, updateCollectionAction, deleteCollectionAction } from './collections'
import { collectionFormSchema } from '@/lib/utils/validators'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockCreateCollection = createCollection as ReturnType<typeof vi.fn>
const mockUpdateCollection = updateCollection as ReturnType<typeof vi.fn>
const mockDeleteCollection = deleteCollection as ReturnType<typeof vi.fn>
const mockInvalidateCache = invalidateCollectionsCache as ReturnType<typeof vi.fn>

const mockCollection = { id: 'col-1', name: 'My Collection', description: null }

beforeEach(() => vi.clearAllMocks())

describe('createCollectionAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await createCollectionAction({ name: 'Test' })
    expect(result.status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when name is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await createCollectionAction({ name: '   ' })
    expect(result.status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when name exceeds 100 characters', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await createCollectionAction({ name: 'a'.repeat(101) })
    expect(result.status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when description exceeds 500 characters', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await createCollectionAction({ name: 'Test', description: 'a'.repeat(501) })
    expect(result.status).toBe('validation_error')
  })

  it('returns CREATED with collection on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockResolvedValue(mockCollection)
    const result = await createCollectionAction({ name: 'My Collection' })
    expect(result.status).toBe('created')
    expect(result.data).toEqual(mockCollection)
  })

  it('calls createCollection with userId and parsed data', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockResolvedValue(mockCollection)
    await createCollectionAction({ name: '  My Collection  ', description: '  desc  ' })
    expect(mockCreateCollection).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'My Collection', description: 'desc' })
    )
  })

  it('transforms empty description string to null', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockResolvedValue(mockCollection)
    await createCollectionAction({ name: 'Test', description: '' })
    expect(mockCreateCollection).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ description: null })
    )
  })

  it('invalidates collections cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockResolvedValue(mockCollection)
    await createCollectionAction({ name: 'Test' })
    expect(mockInvalidateCache).toHaveBeenCalledWith('user-1')
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockCreateCollection.mockRejectedValue(new Error('DB down'))
    const result = await createCollectionAction({ name: 'Test' })
    expect(result.status).toBe('internal_error')
    expect(mockInvalidateCache).not.toHaveBeenCalled()
  })
})

describe('updateCollectionAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await updateCollectionAction('col-1', { name: 'Test' })
    expect(result.status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when name is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await updateCollectionAction('col-1', { name: '   ' })
    expect(result.status).toBe('validation_error')
  })

  it('allows updating only isFavorite without a name', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateCollection.mockResolvedValue({ ...mockCollection, isFavorite: true })
    const result = await updateCollectionAction('col-1', { isFavorite: true })
    
    expect(result.status).toBe('ok')
    expect(mockUpdateCollection).toHaveBeenCalledWith('user-1', 'col-1', { isFavorite: true })
  })

  it('returns OK with updated collection on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateCollection.mockResolvedValue(mockCollection)
    const result = await updateCollectionAction('col-1', { name: 'Updated' })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(mockCollection)
  })

  it('invalidates cache on successful update', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateCollection.mockResolvedValue(mockCollection)
    await updateCollectionAction('col-1', { name: 'Updated' })
    expect(mockInvalidateCache).toHaveBeenCalledWith('user-1')
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateCollection.mockRejectedValue(new Error('DB down'))
    const result = await updateCollectionAction('col-1', { name: 'Test' })
    expect(result.status).toBe('internal_error')
  })
})

describe('deleteCollectionAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await deleteCollectionAction('col-1')
    expect(result.status).toBe('unauthorized')
  })

  it('returns OK and invalidates cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockDeleteCollection.mockResolvedValue(true)
    const result = await deleteCollectionAction('col-1')
    
    expect(result.status).toBe('ok')
    expect(mockDeleteCollection).toHaveBeenCalledWith('user-1', 'col-1')
    expect(mockInvalidateCache).toHaveBeenCalledWith('user-1')
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockDeleteCollection.mockRejectedValue(new Error('DB down'))
    const result = await deleteCollectionAction('col-1')
    expect(result.status).toBe('internal_error')
  })
})

describe('collectionFormSchema', () => {
  it('trims whitespace from name', () => {
    const result = collectionFormSchema.parse({ name: '  React  ' })
    expect(result.name).toBe('React')
  })

  it('transforms empty description to null', () => {
    const result = collectionFormSchema.parse({ name: 'Test', description: '' })
    expect(result.description).toBeNull()
  })

  it('transforms whitespace-only description to null', () => {
    const result = collectionFormSchema.parse({ name: 'Test', description: '   ' })
    expect(result.description).toBeNull()
  })

  it('preserves non-empty description after trimming', () => {
    const result = collectionFormSchema.parse({ name: 'Test', description: '  some desc  ' })
    expect(result.description).toBe('some desc')
  })

  it('accepts missing description (undefined)', () => {
    const result = collectionFormSchema.parse({ name: 'Test' })
    expect(result.description).toBeNull()
  })

  it('rejects empty name', () => {
    expect(() => collectionFormSchema.parse({ name: '' })).toThrow()
  })
})
