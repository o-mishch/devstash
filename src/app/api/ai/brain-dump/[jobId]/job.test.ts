import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the per-job route: snapshot GET (404/200) and the collection-target PATCH
// (401/422/404/204), asserting the DB helpers are called scoped to the session userId.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/db/ai-parse-jobs', () => ({
  getParseJobSnapshot: vi.fn(),
  updateJobCollections: vi.fn(),
  deleteJob: vi.fn(),
}))
vi.mock('@/lib/ai/openai', () => ({ getOpenAIClient: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { getParseJobSnapshot, updateJobCollections, deleteJob } from '@/lib/db/ai-parse-jobs'
import { getOpenAIClient } from '@/lib/ai/openai'
import { GET, PATCH, DELETE } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockSnapshot = getParseJobSnapshot as ReturnType<typeof vi.fn>
const mockUpdate = updateJobCollections as ReturnType<typeof vi.fn>
const mockDeleteJob = deleteJob as ReturnType<typeof vi.fn>
const mockOpenAI = getOpenAIClient as ReturnType<typeof vi.fn>

function patchReq(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1', { method: 'PATCH', body: JSON.stringify(payload) })
}
function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1')
}
function delReq(): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1', { method: 'DELETE' })
}
const ctx = { params: Promise.resolve({ jobId: 'job-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockPro.mockResolvedValue(true)
})

describe('PATCH /ai/brain-dump/{jobId}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await PATCH(patchReq({ collectionIds: [] }), ctx)
    expect(res.status).toBe(401)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 422 when no fields are provided', async () => {
    const res = await PATCH(patchReq({}), ctx)
    expect(res.status).toBe(422)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('updates the collection target, scoped to the session userId (204)', async () => {
    mockUpdate.mockResolvedValue('ok')
    const res = await PATCH(patchReq({ collectionName: 'Notes', collectionIds: ['c1'] }), ctx)
    expect(res.status).toBe(204)
    expect(mockUpdate).toHaveBeenCalledWith('user-1', 'job-1', { collectionName: 'Notes', collectionIds: ['c1'] })
  })

  it('returns 404 when the job is not the user\'s', async () => {
    mockUpdate.mockResolvedValue('not_found')
    const res = await PATCH(patchReq({ collectionIds: [] }), ctx)
    expect(res.status).toBe(404)
  })

  it('returns 422 when a collection id is not owned by the user', async () => {
    mockUpdate.mockResolvedValue('invalid_collections')
    const res = await PATCH(patchReq({ collectionIds: ['foreign'] }), ctx)
    expect(res.status).toBe(422)
  })
})

describe('GET /ai/brain-dump/{jobId}', () => {
  it('returns 404 when the job is not found', async () => {
    mockSnapshot.mockResolvedValue(null)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(404)
  })

  it('returns 200 with the snapshot for an owned job', async () => {
    const snap = { status: 'processing', progress: 0, error: null, collectionName: null, collectionIds: [], items: [] }
    mockSnapshot.mockResolvedValue(snap)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(snap)
    expect(mockSnapshot).toHaveBeenCalledWith('user-1', 'job-1')
  })
})

describe('DELETE /ai/brain-dump/{jobId} (discard)', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(401)
    expect(mockDeleteJob).not.toHaveBeenCalled()
  })

  it('returns 404 when the job is not the user\'s', async () => {
    mockDeleteJob.mockResolvedValue(null)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(404)
    expect(mockDeleteJob).toHaveBeenCalledWith('user-1', 'job-1')
  })

  it('deletes a finished job (nothing to cancel) and returns 204', async () => {
    mockDeleteJob.mockResolvedValue({ openaiResponseId: null })
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(204)
    expect(mockOpenAI).not.toHaveBeenCalled()
  })

  it('best-effort cancels the background run when the job was still processing', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    mockDeleteJob.mockResolvedValue({ openaiResponseId: 'resp_1' })
    mockOpenAI.mockReturnValue({ responses: { cancel } })
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(204)
    expect(cancel).toHaveBeenCalledWith('resp_1')
  })

  it('still returns 204 when the best-effort cancel throws (the job is gone either way)', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('already finished'))
    mockDeleteJob.mockResolvedValue({ openaiResponseId: 'resp_1' })
    mockOpenAI.mockReturnValue({ responses: { cancel } })
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(204)
  })
})
