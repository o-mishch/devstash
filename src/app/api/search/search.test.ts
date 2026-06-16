import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({ checkRateLimit: vi.fn(), deniedMessage: vi.fn() }))
vi.mock('@/lib/db/search', () => ({ globalSearch: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { globalSearch } from '@/lib/db/search'

import { GET } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockSearch = globalSearch as ReturnType<typeof vi.fn>

const get = (qs: string) => new NextRequest(`http://localhost/api/search${qs}`, { method: 'GET' })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockSearch.mockResolvedValue([[], []])
})

describe('GET /search', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(get('?q=react'))
    expect(res.status).toBe(401)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('returns 422 when the query is empty', async () => {
    const res = await GET(get('?q='))
    expect(res.status).toBe(422)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('returns 200 with results scoped to the session userId', async () => {
    const item = { id: 'i1', title: 'React hook', itemType: { name: 'snippet' }, descriptionPreview: null }
    const collection = { id: 'c1', name: 'React', description: null, isFavorite: false, itemCount: 2, dominantColor: null }
    mockSearch.mockResolvedValue([[item], [collection]])
    const res = await GET(get('?q=react'))
    expect(res.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith('react', 'user-1')
    const body = await res.json()
    expect(body.items[0].id).toBe('i1')
    expect(body.collections[0].id).toBe('c1')
  })

  it('trims the query before searching', async () => {
    await GET(get('?q=%20%20react%20%20'))
    expect(mockSearch).toHaveBeenCalledWith('react', 'user-1')
  })
})
