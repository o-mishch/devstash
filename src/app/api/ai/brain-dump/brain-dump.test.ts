import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the brain-dump routes' auth (401), validation (422), Pro gate (403), rate limit (429),
// success (201) for both paste + sourceItemId, gate-first ordering (no source/job on refusal), and the
// unreadable-source 422 (no token spent). The DB + rate-limit layers are mocked.
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/db/ai-parse-jobs', () => ({
  createParseJob: vi.fn(),
  listActiveParseJobs: vi.fn(),
  getSourceItemForParse: vi.fn(),
  getSourceText: vi.fn(),
  listParseSourceCandidates: vi.fn(),
}))
vi.mock('@/lib/db/items', () => ({ createItem: vi.fn(), deleteItem: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateItemsCache: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit, resetRateLimit } from '@/lib/infra/rate-limit'
import { createParseJob, listActiveParseJobs, getSourceItemForParse, getSourceText, listParseSourceCandidates } from '@/lib/db/ai-parse-jobs'
import { createItem, deleteItem } from '@/lib/db/items'
import { POST, GET } from './route'
import { GET as SOURCES } from './sources/route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockResetRateLimit = resetRateLimit as ReturnType<typeof vi.fn>
const mockCreate = createParseJob as ReturnType<typeof vi.fn>
const mockList = listActiveParseJobs as ReturnType<typeof vi.fn>
const mockGetSourceItem = getSourceItemForParse as ReturnType<typeof vi.fn>
const mockGetSourceText = getSourceText as ReturnType<typeof vi.fn>
const mockCreateItem = createItem as ReturnType<typeof vi.fn>
const mockDeleteItem = deleteItem as ReturnType<typeof vi.fn>

const longText = 'Here is a real project brain dump with plenty of content to split into items.'

function postReq(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump', { method: 'POST', body: JSON.stringify(payload) })
}
function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump', { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(true)
  mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
})

describe('POST /ai/brain-dump (paste)', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await POST(postReq({ text: longText }))
    expect(res.status).toBe(401)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 422 when the text is too short', async () => {
    const res = await POST(postReq({ text: 'hi' }))
    expect(res.status).toBe(422)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 403 when not Pro (before spending rate-limit budget or creating a note)', async () => {
    mockIsPro.mockResolvedValue(false)
    const res = await POST(postReq({ text: longText }))
    expect(res.status).toBe(403)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockCreateItem).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After when rate-limited — no note or job created', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 3600 })
    const res = await POST(postReq({ text: longText }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('3600')
    expect(mockCreateItem).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('persists the paste as a brain-dump note, then creates the job (201)', async () => {
    mockCreateItem.mockResolvedValue({ id: 'note-1' })
    mockGetSourceText.mockResolvedValue({ text: longText, truncated: false, sourceName: 'Here is a real project' })
    mockCreate.mockResolvedValue('job-123')

    const res = await POST(postReq({ text: longText }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ jobId: 'job-123', sourceName: 'Here is a real project', truncated: false })
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ itemTypeName: 'note', content: longText, tags: ['brain-dump'] }),
    )
    expect(mockCreate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ sourceItemId: 'note-1', truncated: false }),
    )
  })

  it('refunds the hourly token when job creation fails after the paste note was saved', async () => {
    mockCreateItem.mockResolvedValue({ id: 'note-1' })
    mockGetSourceText.mockResolvedValue({ text: longText, truncated: false, sourceName: 'Here is a real project' })
    mockCreate.mockRejectedValue(new Error('db down'))

    const res = await POST(postReq({ text: longText }))
    expect(res.status).toBe(500)
    expect(mockResetRateLimit).toHaveBeenCalledWith('aiBrainDump', 'user-1')
    expect(mockDeleteItem).toHaveBeenCalledWith('user-1', 'note-1')
  })
})

describe('POST /ai/brain-dump (sourceItemId)', () => {
  it('reuses an existing item and creates the job without a new note (201)', async () => {
    mockGetSourceItem.mockResolvedValue({ id: 'file-1', itemTypeName: 'file', content: null, fileUrl: 'k', fileName: 'a.txt' })
    mockGetSourceText.mockResolvedValue({ text: longText, truncated: true, sourceName: 'a.txt' })
    mockCreate.mockResolvedValue('job-9')

    const res = await POST(postReq({ sourceItemId: 'file-1' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ jobId: 'job-9', sourceName: 'a.txt', truncated: true })
    expect(mockCreateItem).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith('user-1', expect.objectContaining({ sourceItemId: 'file-1', truncated: true }))
  })

  it('returns 404 when the source item is not the user\'s', async () => {
    mockGetSourceItem.mockResolvedValue(null)
    const res = await POST(postReq({ sourceItemId: 'nope' }))
    expect(res.status).toBe(404)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 422 for an unreadable/ineligible source — no token spent, no job created', async () => {
    mockGetSourceItem.mockResolvedValue({ id: 'file-1', itemTypeName: 'file', content: null, fileUrl: 'k', fileName: 'a.bin' })
    mockGetSourceText.mockRejectedValue(new Error('not a text file'))

    const res = await POST(postReq({ sourceItemId: 'file-1' }))
    expect(res.status).toBe(422)
    expect(mockCheckRateLimit).not.toHaveBeenCalled() // token never spent
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 422 when a readable source has too little text — no token spent, no job created', async () => {
    mockGetSourceItem.mockResolvedValue({ id: 'file-1', itemTypeName: 'file', content: null, fileUrl: 'k', fileName: 'a.txt' })
    // Readable, but under the non-blank minimum (this gate is distinct from the unreadable 422 above).
    mockGetSourceText.mockResolvedValue({ text: 'too short', truncated: false, sourceName: 'a.txt' })

    const res = await POST(postReq({ sourceItemId: 'file-1' }))
    expect(res.status).toBe(422)
    expect(mockCheckRateLimit).not.toHaveBeenCalled() // gate runs before the rate-limit token is spent
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('GET /ai/brain-dump', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(getReq())
    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 200 with the in-progress jobs for the session user', async () => {
    const jobs = [
      { id: 'job-1', status: 'processing', progress: 30, itemCount: 4, sourceName: 'notes.md', createdAt: '2026-06-21T00:00:00.000Z' },
    ]
    mockList.mockResolvedValue(jobs)
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jobs })
    expect(mockList).toHaveBeenCalledWith('user-1')
  })
})

describe('GET /ai/brain-dump/sources', () => {
  function sourcesReq(): NextRequest {
    return new NextRequest('http://localhost/api/ai/brain-dump/sources', { method: 'GET' })
  }

  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await SOURCES(sourcesReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when not Pro', async () => {
    mockIsPro.mockResolvedValue(false)
    const res = await SOURCES(sourcesReq())
    expect(res.status).toBe(403)
  })

  it('returns 200 with sources list for Pro users', async () => {
    const mockSources = [{ itemId: 'item-1', name: 'test.txt', sizeBytes: 100 }]
    vi.mocked(listParseSourceCandidates).mockResolvedValue(mockSources)

    const res = await SOURCES(sourcesReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sources: mockSources })
  })
})
