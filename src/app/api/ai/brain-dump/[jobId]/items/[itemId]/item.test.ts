import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the per-draft edit/reclassify (PATCH) and delete (DELETE) routes: auth (401), validation
// (422), 404 for a foreign draft, and that the DB helpers are scoped to the session userId.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof getCachedSession>() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn<typeof getCachedVerifiedProAccess>(),
}))
vi.mock('@/lib/db/ai-parse-jobs', () => ({
  patchDraftItem: vi.fn<typeof patchDraftItem>(),
  deleteDraftItem: vi.fn<typeof deleteDraftItem>(),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { patchDraftItem, deleteDraftItem } from '@/lib/db/ai-parse-jobs'
import { PATCH, DELETE } from './route'

const mockSession = vi.mocked(getCachedSession)
const mockPro = vi.mocked(getCachedVerifiedProAccess)
const mockPatch = vi.mocked(patchDraftItem)
const mockDelete = vi.mocked(deleteDraftItem)

function patchReq(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1/items/item-1', { method: 'PATCH', body: JSON.stringify(payload) })
}
function delReq(): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1/items/item-1', { method: 'DELETE' })
}
const ctx = { params: Promise.resolve({ jobId: 'job-1', itemId: 'item-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockPro.mockResolvedValue(true)
})

describe('PATCH /ai/brain-dump/{jobId}/items/{itemId}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await PATCH(patchReq({ trashed: true }), ctx)
    expect(res.status).toBe(401)
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('returns 422 when no fields are provided', async () => {
    const res = await PATCH(patchReq({}), ctx)
    expect(res.status).toBe(422)
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('returns 422 for a draft reclassified into a non-text type (file/image rejected)', async () => {
    const res = await PATCH(patchReq({ itemTypeName: 'file' }), ctx)
    expect(res.status).toBe(422)
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('patches the draft scoped to the session userId and returns 200', async () => {
    const updated = { id: 'item-1', order: 0, itemTypeName: 'note', title: 'A', content: null, url: null, language: null, description: null, tags: [], trashed: true }
    mockPatch.mockResolvedValue(updated)
    const res = await PATCH(patchReq({ trashed: true }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(updated)
    expect(mockPatch).toHaveBeenCalledWith('user-1', 'job-1', 'item-1', { trashed: true })
  })

  it('returns 404 when the draft is not the user\'s', async () => {
    mockPatch.mockResolvedValue(null)
    const res = await PATCH(patchReq({ trashed: true }), ctx)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /ai/brain-dump/{jobId}/items/{itemId}', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(401)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('deletes the draft scoped to the session userId and returns 204', async () => {
    mockDelete.mockResolvedValue(true)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith('user-1', 'job-1', 'item-1')
  })

  it('returns 404 when the draft is not the user\'s', async () => {
    mockDelete.mockResolvedValue(false)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(404)
  })
})
