import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the single-item GET that powers the source deep-link drawer: auth (401), 404 for a
// foreign/missing item (IDOR), and 200 with the full item scoped to the session userId.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/db/items', () => ({
  getItemById: vi.fn(),
  getItemForAuth: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))
vi.mock('@/lib/infra/cache', () => ({ invalidateItemsCache: vi.fn(), invalidateCollectionsCache: vi.fn() }))
vi.mock('@/lib/storage/image-thumbnails', () => ({ deleteStoredFile: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { getItemById } from '@/lib/db/items'
import { GET } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockGetById = getItemById as ReturnType<typeof vi.fn>

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/items/item-1')
}
const ctx = { params: Promise.resolve({ id: 'item-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockPro.mockResolvedValue(true)
})

describe('GET /items/{id}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(401)
    expect(mockGetById).not.toHaveBeenCalled()
  })

  it('returns 404 when the item is not the user\'s (IDOR-scoped)', async () => {
    mockGetById.mockResolvedValue(null)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(404)
    expect(mockGetById).toHaveBeenCalledWith('user-1', 'item-1')
  })

  it('returns 200 with the full item for an owned item', async () => {
    const item = { id: 'item-1', title: 'Note', itemType: { name: 'note' }, content: 'body', description: null, collections: [] }
    mockGetById.mockResolvedValue(item)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'item-1', content: 'body' })
  })
})
