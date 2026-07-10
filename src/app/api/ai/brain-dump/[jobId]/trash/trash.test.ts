import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { getCachedSession as GetCachedSessionFn } from '@/lib/session'
import type { emptyJobTrash as EmptyJobTrashFn } from '@/lib/db/ai-parse-jobs'

// Exercises the empty-trash route: auth (401), 404 for a foreign/missing job, and 204 on success —
// asserting the delete is scoped to the session userId. Not Pro-gated by design — emptying the trash of
// one's own job is a benign cleanup; only the paid actions gate on Pro — so no pro-access mock here.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof GetCachedSessionFn>() }))
vi.mock('@/lib/db/ai-parse-jobs', () => ({ emptyJobTrash: vi.fn<typeof EmptyJobTrashFn>() }))

import { getCachedSession } from '@/lib/session'
import { emptyJobTrash } from '@/lib/db/ai-parse-jobs'
import { DELETE } from './route'

const mockSession = vi.mocked(getCachedSession)
const mockEmpty = vi.mocked(emptyJobTrash)

function delReq(): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1/trash', { method: 'DELETE' })
}
const ctx = { params: Promise.resolve({ jobId: 'job-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
})

describe('DELETE /ai/brain-dump/{jobId}/trash', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(401)
    expect(mockEmpty).not.toHaveBeenCalled()
  })

  it('returns 404 when the job is not the user\'s', async () => {
    mockEmpty.mockResolvedValue(null)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(404)
    expect(mockEmpty).toHaveBeenCalledWith('user-1', 'job-1')
  })

  it('returns 204 after emptying an owned job\'s trash', async () => {
    mockEmpty.mockResolvedValue(2)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(204)
  })
})
