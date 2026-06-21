import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the per-item "Save now" route: auth (401), not-found (404), and the success path
// (200 + cache invalidation), asserting the DB helper is called scoped to the session userId.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/db/ai-parse-jobs', () => ({ commitDraftItem: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateItemsCache: vi.fn(), invalidateCollectionsCache: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { commitDraftItem } from '@/lib/db/ai-parse-jobs'
import { invalidateItemsCache, invalidateCollectionsCache } from '@/lib/infra/cache'
import { POST } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockCommit = commitDraftItem as ReturnType<typeof vi.fn>
const mockInvalidateItems = invalidateItemsCache as ReturnType<typeof vi.fn>
const mockInvalidateCollections = invalidateCollectionsCache as ReturnType<typeof vi.fn>

function req(): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1/items/item-1/commit', { method: 'POST' })
}
const ctx = { params: Promise.resolve({ jobId: 'job-1', itemId: 'item-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockPro.mockResolvedValue(true)
})

describe('POST /ai/brain-dump/{jobId}/items/{itemId}/commit', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await POST(req(), ctx)
    expect(res.status).toBe(401)
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not Pro', async () => {
    mockPro.mockResolvedValue(false)
    const res = await POST(req(), ctx)
    expect(res.status).toBe(403)
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it('returns 404 when the draft is not the user\'s', async () => {
    mockCommit.mockResolvedValue(null)
    const res = await POST(req(), ctx)
    expect(res.status).toBe(404)
    expect(mockInvalidateItems).not.toHaveBeenCalled()
  })

  it('commits the draft, invalidates both caches, and returns the count', async () => {
    mockCommit.mockResolvedValue(1)
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ created: 1, total: 1 })
    expect(mockCommit).toHaveBeenCalledWith('user-1', 'job-1', 'item-1')
    expect(mockInvalidateItems).toHaveBeenCalledWith('user-1')
    expect(mockInvalidateCollections).toHaveBeenCalledWith('user-1')
  })

  it('does not invalidate caches when nothing was created (createItem failed)', async () => {
    mockCommit.mockResolvedValue(0)
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ created: 0, total: 1 })
    expect(mockInvalidateItems).not.toHaveBeenCalled()
  })
})
