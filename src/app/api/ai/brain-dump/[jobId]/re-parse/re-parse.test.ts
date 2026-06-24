import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// `after` runs the abandoned-job sweep post-response; stub it to a no-op so the handler doesn't register
// a real callback outside a request scope in tests.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/db/ai-parse-jobs', () => ({
  createParseJob: vi.fn(),
  getReparseEligibility: vi.fn(),
  getSourceItemForParse: vi.fn(),
  getSourceText: vi.fn(),
  sweepAbandonedParseJobs: vi.fn(),
}))

import { after } from 'next/server'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit, resetRateLimit } from '@/lib/infra/rate-limit'
import {
  createParseJob,
  getReparseEligibility,
  getSourceItemForParse,
  getSourceText,
  sweepAbandonedParseJobs,
} from '@/lib/db/ai-parse-jobs'
import { POST } from './route'

const mockSession = vi.mocked(getCachedSession)
const mockIsPro = vi.mocked(getCachedVerifiedProAccess)
const mockRateLimit = vi.mocked(checkRateLimit)
const mockResetRateLimit = vi.mocked(resetRateLimit)
const mockCreate = vi.mocked(createParseJob)
const mockEligibility = vi.mocked(getReparseEligibility)
const mockSourceItem = vi.mocked(getSourceItemForParse)
const mockSourceText = vi.mocked(getSourceText)

const request = () => new NextRequest('http://localhost/api/ai/brain-dump/job-1/re-parse', {
  method: 'POST',
})
const ctx = { params: Promise.resolve({ jobId: 'job-1' }) }
const emptyJobCtx = { params: Promise.resolve({ jobId: '' }) }
const source = { id: 'note-1', itemTypeName: 'note', content: 'long source', fileUrl: null, fileName: null }
const read = {
  text: 'A sufficiently long source body that can be split into multiple useful stash items.',
  truncated: true,
  sourceName: 'project.md',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1', isPro: true }, expires: '2099-01-01' })
  mockIsPro.mockResolvedValue(true)
  mockEligibility.mockResolvedValue({ status: 'completed', sourceItemId: 'note-1' })
  mockSourceItem.mockResolvedValue(source)
  mockSourceText.mockResolvedValue(read)
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockCreate.mockResolvedValue('job-2')
})

describe('POST /ai/brain-dump/{jobId}/re-parse', () => {
  it('returns 422 for an empty path parameter before reading the original job', async () => {
    expect((await POST(request(), emptyJobCtx)).status).toBe(422)
    expect(mockEligibility).not.toHaveBeenCalled()
  })

  it('returns 401 before reading the original job when signed out', async () => {
    mockSession.mockResolvedValue(null)
    expect((await POST(request(), ctx)).status).toBe(401)
    expect(mockEligibility).not.toHaveBeenCalled()
  })

  it('returns 403 before reading or spending quota when not Pro', async () => {
    mockIsPro.mockResolvedValue(false)
    expect((await POST(request(), ctx)).status).toBe(403)
    expect(mockEligibility).not.toHaveBeenCalled()
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('returns 404 for a foreign or missing original job without spending quota', async () => {
    mockEligibility.mockResolvedValue(null)
    expect((await POST(request(), ctx)).status).toBe(404)
    expect(mockEligibility).toHaveBeenCalledWith('user-1', 'job-1')
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('returns 409 for every non-completed original status (re-parse is completed-only) without spending quota', async () => {
    // beforeEach already provides a Pro session; only the eligibility status varies per iteration.
    for (const status of ['processing', 'failed', 'closed'] as const) {
      mockEligibility.mockResolvedValue({ status, sourceItemId: 'note-1' })
      expect((await POST(request(), ctx)).status).toBe(409)
    }
    expect(mockRateLimit).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 404 when a completed job has lost its source item (SetNull)', async () => {
    mockEligibility.mockResolvedValue({ status: 'completed', sourceItemId: null })
    expect((await POST(request(), ctx)).status).toBe(404)
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('returns 404 when the durable source was deleted or is not readable by the user', async () => {
    mockSourceItem.mockResolvedValue(null)
    expect((await POST(request(), ctx)).status).toBe(404)
    expect(mockSourceItem).toHaveBeenCalledWith('user-1', 'note-1')
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('returns 422 for an ineligible source before spending quota', async () => {
    mockSourceText.mockRejectedValue(new Error('ineligible'))
    expect((await POST(request(), ctx)).status).toBe(422)
    expect(mockRateLimit).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 422 for a too-short source before spending quota', async () => {
    mockSourceText.mockResolvedValue({ text: 'short', truncated: false, sourceName: 'short.md' })
    expect((await POST(request(), ctx)).status).toBe(422)
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('returns 429 without creating a job when the hourly token is unavailable', async () => {
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 900 })
    const response = await POST(request(), ctx)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('900')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a fresh job from the current durable source state', async () => {
    const response = await POST(request(), ctx)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ jobId: 'job-2', sourceName: 'project.md', truncated: true })
    expect(mockCreate).toHaveBeenCalledWith('user-1', {
      sourceText: read.text,
      sourceItemId: 'note-1',
      sourceName: 'project.md',
      truncated: true,
      collectionName: null,
    })
    // Re-parse is a create handler, so it registers the lazy abandoned-job sweep like POST/GET /brain-dump.
    expect(after).toHaveBeenCalledWith(sweepAbandonedParseJobs)
  })

  it('refunds the hourly token when fresh-job creation fails', async () => {
    mockCreate.mockRejectedValue(new Error('db down'))
    expect((await POST(request(), ctx)).status).toBe(500)
    expect(mockResetRateLimit).toHaveBeenCalledWith('aiBrainDump', 'user-1')
  })
})
