import { vi, describe, it, expect, beforeEach } from 'vitest'
import { invoke, expectORPCError } from '@/test/orpc'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/db/search', () => ({ globalSearch: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { globalSearch } from '@/lib/db/search'
import { searchRouter } from './search'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockGlobalSearch = globalSearch as ReturnType<typeof vi.fn>

const mockItem = { id: 'item-1', title: 'React hooks', itemType: { name: 'snippet' }, descriptionPreview: null }
const mockCollection = { id: 'col-1', name: 'React', description: null, isFavorite: false, itemCount: 2, dominantColor: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockGlobalSearch.mockResolvedValue([[], []])
})

describe('search.search', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(searchRouter.search, { q: 'react' }), 'UNAUTHORIZED')
    expect(mockGlobalSearch).not.toHaveBeenCalled()
  })

  it('rejects an empty query', async () => {
    await expectORPCError(invoke(searchRouter.search, { q: '' }), 'BAD_REQUEST')
    expect(mockGlobalSearch).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only query', async () => {
    await expectORPCError(invoke(searchRouter.search, { q: '   ' }), 'BAD_REQUEST')
    expect(mockGlobalSearch).not.toHaveBeenCalled()
  })

  it('returns items and collections, scoping the query to the session user', async () => {
    mockGlobalSearch.mockResolvedValue([[mockItem], [mockCollection]])
    const result = await invoke(searchRouter.search, { q: 'react' })
    expect(result).toEqual({ items: [mockItem], collections: [mockCollection] })
    expect(mockGlobalSearch).toHaveBeenCalledWith('react', 'user-1')
  })
})
