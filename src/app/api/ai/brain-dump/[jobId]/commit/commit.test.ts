import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the batch "Save all" route: auth (401), Pro gate (403), not-found (404), and the success
// path (200 + cache invalidation), asserting the DB helper is called scoped to the session userId.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/db/ai-parse-jobs', () => ({ commitJob: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateItemsCache: vi.fn(), invalidateCollectionsCache: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { commitJob } from '@/lib/db/ai-parse-jobs'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { POST } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockCommit = commitJob as ReturnType<typeof vi.fn>
const mockInvalidateItems = invalidateItemsCache as ReturnType<typeof vi.fn>

function req(): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1/commit', { method: 'POST' })
}
const ctx = { params: Promise.resolve({ jobId: 'job-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockPro.mockResolvedValue(true)
})

describe('POST /ai/brain-dump/{jobId}/commit', () => {
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

  it('returns 404 when the job is not the user\'s', async () => {
    mockCommit.mockResolvedValue({ kind: 'not_found' })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(404)
    expect(mockInvalidateItems).not.toHaveBeenCalled()
  })

  it('returns 409 when the job is still processing', async () => {
    mockCommit.mockResolvedValue({ kind: 'still_processing' })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(409)
    expect(mockInvalidateItems).not.toHaveBeenCalled()
  })

  it('commits the whole job, closes it, invalidates caches, and returns created + total + closed', async () => {
    mockCommit.mockResolvedValue({ kind: 'done', created: 3, total: 3, closed: true })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    // `closed` drives the client's dashboard redirect + toast — it must be on the response.
    expect(await res.json()).toEqual({ created: 3, total: 3, closed: true })
    expect(mockCommit).toHaveBeenCalledWith('user-1', 'job-1')
    expect(mockInvalidateItems).toHaveBeenCalledWith('user-1')
  })

  it('returns closed=false on a partial commit (some drafts could not be saved)', async () => {
    mockCommit.mockResolvedValue({ kind: 'done', created: 2, total: 3, closed: false })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ created: 2, total: 3, closed: false })
    expect(mockInvalidateItems).toHaveBeenCalledWith('user-1')
  })
})
