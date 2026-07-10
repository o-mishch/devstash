import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readJson } from '@/test/matchers'
import { NextRequest } from 'next/server'
import type { getCachedSession as RealGetCachedSession } from '@/lib/session'
import type { getCachedVerifiedProAccess as RealGetCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import type { checkRateLimit, deniedMessage } from '@/lib/infra/rate-limit'
import type { globalSearch as RealGlobalSearch } from '@/lib/db/search'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof RealGetCachedSession>() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn<typeof RealGetCachedVerifiedProAccess>(),
}))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn<typeof checkRateLimit>(),
  deniedMessage: vi.fn<typeof deniedMessage>(),
}))
vi.mock('@/lib/db/search', () => ({ globalSearch: vi.fn<typeof RealGlobalSearch>() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { globalSearch } from '@/lib/db/search'

import { GET } from './route'

const mockSession = vi.mocked(getCachedSession)
const mockIsPro = vi.mocked(getCachedVerifiedProAccess)
const mockSearch = vi.mocked(globalSearch)

const get = (qs: string) => new NextRequest(`http://localhost/api/search${qs}`, { method: 'GET' })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1', isPro: false }, expires: '2099-01-01T00:00:00.000Z' })
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
    const item = {
      id: 'i1',
      title: 'React hook',
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
    const collection = { id: 'c1', name: 'React', description: null, isFavorite: false, itemCount: 2, dominantColor: null }
    mockSearch.mockResolvedValue([[item], [collection]])
    const res = await GET(get('?q=react'))
    expect(res.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith('react', 'user-1')
    const body = await readJson<{ items: { id: string }[]; collections: { id: string }[] }>(res)
    expect(body.items[0].id).toBe('i1')
    expect(body.collections[0].id).toBe('c1')
  })

  it('trims the query before searching', async () => {
    await GET(get('?q=%20%20react%20%20'))
    expect(mockSearch).toHaveBeenCalledWith('react', 'user-1')
  })
})
