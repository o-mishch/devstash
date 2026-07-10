import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the brain-dump routes' auth (401), validation (422), Pro gate (403), rate limit (429),
// success (201) for both paste + sourceItemId, gate-first ordering (no source/job on refusal), and the
// unreadable-source 422 (no token spent). The DB + rate-limit layers are mocked.
// `after` runs the abandoned-job sweep post-response; stub it to a no-op so the handler doesn't
// register a real callback outside a request scope in tests.
import type { deniedMessage } from '@/lib/infra/rate-limit'
import type { listParseSourceCandidates } from '@/lib/db/ai-parse-jobs'
import type { invalidateItemsCache } from '@/lib/infra/cache'
import type { LightItem } from '@/types/item'

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn<typeof after>() }))
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof getCachedSession>() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn<typeof getCachedVerifiedProAccess>() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn<typeof checkRateLimit>(),
  resetRateLimit: vi.fn<typeof resetRateLimit>(),
  deniedMessage: vi.fn<typeof deniedMessage>((retryAfter) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/db/ai-parse-jobs', () => ({
  createParseJob: vi.fn<typeof createParseJob>(),
  listActiveParseJobs: vi.fn<typeof listActiveParseJobs>(),
  listClosedParseJobs: vi.fn<typeof listClosedParseJobs>(),
  getSourceItemForParse: vi.fn<typeof getSourceItemForParse>(),
  getSourceText: vi.fn<typeof getSourceText>(),
  listParseSourceCandidates: vi.fn<typeof listParseSourceCandidates>(),
  sweepAbandonedParseJobs: vi.fn<typeof sweepAbandonedParseJobs>(),
}))
vi.mock('@/lib/db/items', () => ({ createItem: vi.fn<typeof createItem>(), deleteItem: vi.fn<typeof deleteItem>() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateItemsCache: vi.fn<typeof invalidateItemsCache>() }))

import { after } from 'next/server'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit, resetRateLimit } from '@/lib/infra/rate-limit'
import { createParseJob, listActiveParseJobs, listClosedParseJobs, getSourceItemForParse, getSourceText, sweepAbandonedParseJobs } from '@/lib/db/ai-parse-jobs'
import type { ParseJobSummary } from '@/lib/db/ai-parse-jobs'
import { createItem, deleteItem } from '@/lib/db/items'
import { POST, GET } from './route'

const mockSession = vi.mocked(getCachedSession)
const mockIsPro = vi.mocked(getCachedVerifiedProAccess)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockResetRateLimit = vi.mocked(resetRateLimit)
const mockCreate = vi.mocked(createParseJob)
const mockList = vi.mocked(listActiveParseJobs)
const mockGetSourceItem = vi.mocked(getSourceItemForParse)
const mockGetSourceText = vi.mocked(getSourceText)
const mockCreateItem = vi.mocked(createItem)
const mockDeleteItem = vi.mocked(deleteItem)

const mockSnippetItem: LightItem = {
  id: 'note-1',
  title: 'Brain dump',
  createdAt: '2026-06-21T00:00:00.000Z',
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

const longText = 'Here is a real project brain dump with plenty of content to split into items.'

function postReq(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump', { method: 'POST', body: JSON.stringify(payload) })
}
function getReq(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/ai/brain-dump${query}`, { method: 'GET' })
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

  it('persists the paste as a brain-dump snippet, then creates the job (201)', async () => {
    mockCreateItem.mockResolvedValue(mockSnippetItem)
    mockGetSourceText.mockResolvedValue({ text: longText, truncated: false, sourceName: 'Here is a real project' })
    mockCreate.mockResolvedValue('job-123')

    const res = await POST(postReq({ text: longText }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ jobId: 'job-123', sourceName: 'Here is a real project', truncated: false })
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ itemTypeName: 'snippet', content: longText, language: 'Plain Text', tags: ['brain-dump'] }),
    )
    expect(mockCreate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ sourceItemId: 'note-1', truncated: false }),
    )
    // The TTL-cleanup backstop must be registered after a successful create.
    expect(after).toHaveBeenCalledWith(sweepAbandonedParseJobs)
    // Gate ordering on the paste success path: the hourly token is spent exactly once, and the job is
    // created only AFTER it (so a refactor that creates the job before gating the budget is caught).
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockCheckRateLimit.mock.invocationCallOrder[0],
    )
  })

  it('refunds the hourly token when job creation fails after the paste snippet was saved', async () => {
    mockCreateItem.mockResolvedValue(mockSnippetItem)
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
    // Gate ordering: source eligibility is resolved BEFORE the token is spent, and the token is spent
    // exactly once — so an unreadable source can never burn the user's hourly quota.
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
    expect(mockGetSourceText.mock.invocationCallOrder[0]).toBeLessThan(
      mockCheckRateLimit.mock.invocationCallOrder[0],
    )
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
    const jobs: ParseJobSummary[] = [
      { id: 'job-1', status: 'processing', progress: 30, itemCount: 4, sourceName: 'notes.md', collectionName: null, createdAt: '2026-06-21T00:00:00.000Z' },
    ]
    mockList.mockResolvedValue(jobs)
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jobs })
    expect(mockList).toHaveBeenCalledWith('user-1')
    // The job-list path also registers the lazy abandoned-job sweep.
    expect(after).toHaveBeenCalledWith(sweepAbandonedParseJobs)
  })

  it('returns the closed History list when ?history=1 (not the active list)', async () => {
    const mockClosed = vi.mocked(listClosedParseJobs)
    const closed: ParseJobSummary[] = [
      { id: 'c1', status: 'closed', progress: 100, itemCount: 1, sourceName: 'done.md', collectionName: null, createdAt: '2026-06-20T00:00:00.000Z', committedCount: 5, committedByType: { snippet: 5 } },
    ]
    mockClosed.mockResolvedValue(closed)
    const res = await GET(getReq('?history=1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jobs: closed })
    expect(mockClosed).toHaveBeenCalledWith('user-1')
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 422 for an invalid history value — neither list is queried', async () => {
    const mockClosed = vi.mocked(listClosedParseJobs)
    const res = await GET(getReq('?history=2'))
    expect(res.status).toBe(422)
    expect(mockList).not.toHaveBeenCalled()
    expect(mockClosed).not.toHaveBeenCalled()
  })
})
