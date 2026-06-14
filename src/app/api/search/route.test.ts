import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/search', () => ({ globalSearch: vi.fn() }))

import { auth } from '@/auth'
import { globalSearch } from '@/lib/db/search'

import { GET } from './route'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockGlobalSearch = globalSearch as ReturnType<typeof vi.fn>

async function search(q: string | null) {
  const url = q === null ? 'http://localhost/api/search' : `http://localhost/api/search?q=${encodeURIComponent(q)}`
  const req = new NextRequest(url, { method: 'GET' })
  const res = await GET(req, { params: Promise.resolve({}) })
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
  mockGlobalSearch.mockResolvedValue([[], []])
})

describe('GET /api/search', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await search('react')
    expect(result.status).toBe('unauthorized')
    expect(mockGlobalSearch).not.toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR when q is missing', async () => {
    const result = await search(null)
    expect(result.status).toBe('validation_error')
    expect(mockGlobalSearch).not.toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR when q is only whitespace', async () => {
    const result = await search('   ')
    expect(result.status).toBe('validation_error')
    expect(mockGlobalSearch).not.toHaveBeenCalled()
  })

  it('returns ok with items and collections, scoping the query to the session user', async () => {
    const items = [{ id: 'item-1' }]
    const collections = [{ id: 'col-1' }]
    mockGlobalSearch.mockResolvedValue([items, collections])

    const result = await search('react')

    expect(result.status).toBe('ok')
    expect(result.data).toEqual({ items, collections })
    expect(mockGlobalSearch).toHaveBeenCalledWith('react', 'user-1')
  })
})
