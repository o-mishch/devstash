import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the SSE stream route's branching: 404 for a foreign job, snapshot-only replay for a
// finished job, a resume offer for an interrupted job, fresh-start vs. cursor-resume run selection,
// and the Redis single-flight lock (acquire/release + contention → no double-generate).
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/ai/openai', () => ({ getOpenAIClient: vi.fn() }))
vi.mock('@/lib/ai/brain-dump', () => ({
  startBackgroundBrainDump: vi.fn(),
  resumeBackgroundBrainDump: vi.fn(),
  consumeBrainDumpStream: vi.fn(),
  brainDumpProgress: (n: number) => Math.min(95, n * 3),
  // Stand-in that surfaces the reason-specific copy the route assertions look for ("What to do:",
  // "safety filter"), so the route's failed-branch composition is exercised without the real builder.
  buildFailureDetail: (detail: { reason: string }, persisted: number) =>
    detail.reason === 'content_filter'
      ? `Blocked by the safety filter. ${persisted} saved. What to do: edit the source.`
      : `Run failed. ${persisted} saved. What to do: retry.`,
}))
vi.mock('@/lib/db/ai-parse-jobs', () => ({
  getParseJobSnapshot: vi.fn(),
  getParseJobRunState: vi.fn(),
  appendDraftsAndAdvance: vi.fn(),
  setOpenAiResponseId: vi.fn(),
  finishJob: vi.fn(),
}))
vi.mock('@/lib/infra/redis', () => ({ getRedis: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { getOpenAIClient } from '@/lib/ai/openai'
import { startBackgroundBrainDump, resumeBackgroundBrainDump, consumeBrainDumpStream } from '@/lib/ai/brain-dump'
import { getParseJobSnapshot, getParseJobRunState, finishJob } from '@/lib/db/ai-parse-jobs'
import { getRedis } from '@/lib/infra/redis'
import { GET } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockClient = getOpenAIClient as ReturnType<typeof vi.fn>
const mockStart = startBackgroundBrainDump as ReturnType<typeof vi.fn>
const mockResume = resumeBackgroundBrainDump as ReturnType<typeof vi.fn>
const mockConsume = consumeBrainDumpStream as ReturnType<typeof vi.fn>
const mockSnapshot = getParseJobSnapshot as ReturnType<typeof vi.fn>
const mockRunState = getParseJobRunState as ReturnType<typeof vi.fn>
const mockFinish = finishJob as ReturnType<typeof vi.fn>
const mockRedis = getRedis as ReturnType<typeof vi.fn>

const ctx = { params: Promise.resolve({ jobId: 'job-1' }) }
function req(resume = false): NextRequest {
  return new NextRequest(`http://localhost/api/ai/brain-dump/job-1/stream${resume ? '?resume=1' : ''}`)
}
// Native EventSource auto-reconnect carries no query param — it re-sends the last `id:` it saw as the
// `Last-Event-ID` header. The route must treat that as a resume too.
function reqWithLastEventId(id: string): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/job-1/stream', {
    headers: { 'Last-Event-ID': id },
  })
}

interface SseEvent {
  event: string
  data: unknown
}
async function readSse(res: Response): Promise<SseEvent[]> {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const data = block.match(/^data: (.+)$/m)?.[1]
      return { event: block.match(/^event: (.+)$/m)?.[1] ?? '', data: data ? (JSON.parse(data) as unknown) : undefined }
    })
}

const processingSnap = { status: 'processing', progress: 0, error: null, collectionName: null, collectionIds: [], items: [] }
const freshRun = { status: 'processing', sourceText: 'file text', openaiResponseId: null, streamCursor: null, itemCount: 0 }
const interruptedRun = { status: 'processing', sourceText: 'x', openaiResponseId: 'resp-1', streamCursor: 7, itemCount: 3 }

function mockRedisLock(acquired = true) {
  mockRedis.mockReturnValue({
    set: vi.fn().mockResolvedValue(acquired ? 'OK' : null),
    del: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockPro.mockResolvedValue(true)
  mockClient.mockReturnValue({})
  mockRedisLock()
  mockConsume.mockResolvedValue({ status: 'completed', emitted: 0 })
  mockStart.mockResolvedValue({})
  mockResume.mockResolvedValue({})
})

describe('GET /ai/brain-dump/{jobId}/stream', () => {
  it('returns 401 when not signed in (no snapshot read)', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(401)
    expect(mockSnapshot).not.toHaveBeenCalled()
  })

  it("returns 404 when the job is not the user's", async () => {
    mockSnapshot.mockResolvedValue(null)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
    expect(mockSnapshot).toHaveBeenCalledWith('user-1', 'job-1')
  })

  it('returns 403 (no generation) for a downgraded non-Pro user', async () => {
    mockPro.mockResolvedValue(false)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(403)
    expect(mockSnapshot).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('replays the snapshot and stops for a finished job (no generation)', async () => {
    mockSnapshot.mockResolvedValue({ ...processingSnap, status: 'completed' })
    const events = await readSse(await GET(req(), ctx))
    expect(events.map((e) => e.event)).toEqual(['snapshot', 'done'])
    expect(mockRunState).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('offers resume (no generation) for an interrupted job without ?resume=1', async () => {
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(interruptedRun)
    const events = await readSse(await GET(req(), ctx))
    expect(events.map((e) => e.event)).toEqual(['snapshot', 'resumable'])
    expect(events.find((e) => e.event === 'resumable')?.data).toEqual({ count: 3 })
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockResume).not.toHaveBeenCalled()
  })

  it('starts a fresh background run and finishes completed', async () => {
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(freshRun)
    const events = await readSse(await GET(req(), ctx))
    expect(mockStart).toHaveBeenCalled()
    expect(mockResume).not.toHaveBeenCalled()
    expect(mockFinish).toHaveBeenCalledWith('user-1', 'job-1', 'completed')
    expect(events.map((e) => e.event)).toContain('done')
  })

  it('finishes failed with rich detail + remediation and emits the reason on a model error', async () => {
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(freshRun)
    mockConsume.mockResolvedValue({ status: 'failed', emitted: 0, failure: { reason: 'model_error', message: 'boom' } })
    const events = await readSse(await GET(req(), ctx))
    // finishJob gets the composed human-readable detail (not a bare "Generation failed."), the truncated
    // flag undefined, and the structured failure reason for the log.
    expect(mockFinish).toHaveBeenCalledWith(
      'user-1', 'job-1', 'failed', expect.stringContaining('What to do:'), undefined, { reason: 'model_error' },
    )
    const errEvent = events.find((e) => e.event === 'error')?.data as { message: string; reason: string }
    expect(errEvent.reason).toBe('model_error')
    expect(errEvent.message).toContain('What to do:')
  })

  it('content_filter maps to failed (not truncated-complete) with its remediation', async () => {
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(freshRun)
    mockConsume.mockResolvedValue({ status: 'failed', emitted: 1, failure: { reason: 'content_filter', message: null } })
    await readSse(await GET(req(), ctx))
    expect(mockFinish).toHaveBeenCalledWith(
      'user-1', 'job-1', 'failed', expect.stringContaining('safety filter'), undefined, { reason: 'content_filter' },
    )
  })

  it('finishes completed-but-truncated and discloses it when the run is token-capped (incomplete)', async () => {
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(freshRun)
    mockConsume.mockResolvedValue({ status: 'incomplete', emitted: 2 })
    const events = await readSse(await GET(req(), ctx))
    // Persisted as completed + truncated (so the source banner discloses it on reload), and the live
    // `done` event carries the truncated flag (board toasts it) — never a silent clean finish.
    expect(mockFinish).toHaveBeenCalledWith('user-1', 'job-1', 'completed', undefined, true)
    expect(events.find((e) => e.event === 'done')?.data).toEqual({ status: 'completed', truncated: true })
  })

  it('handles crash-recovery path: settles job completed-but-truncated when runState has items but no resume id', async () => {
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue({
      status: 'processing',
      sourceText: 'x',
      openaiResponseId: null,
      streamCursor: null,
      itemCount: 3,
    })
    const events = await readSse(await GET(req(), ctx))
    expect(mockFinish).toHaveBeenCalledWith('user-1', 'job-1', 'completed', undefined, true)
    const doneEvent = events.find((e) => e.event === 'done')
    expect(doneEvent?.data).toEqual({ status: 'completed', truncated: true })
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('resumes from the stored cursor on ?resume=1 (no new run)', async () => {
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(interruptedRun)
    await readSse(await GET(req(true), ctx))
    expect(mockResume).toHaveBeenCalledWith(expect.anything(), 'resp-1', 7, expect.anything())
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('resumes from the stored cursor when the browser reconnects with a Last-Event-ID header', async () => {
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(interruptedRun)
    await readSse(await GET(reqWithLastEventId('3'), ctx))
    expect(mockResume).toHaveBeenCalledWith(expect.anything(), 'resp-1', 7, expect.anything())
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('tags the snapshot frame with a retry directive and an id so native reconnect has a Last-Event-ID', async () => {
    mockSnapshot.mockResolvedValue({ ...processingSnap, status: 'completed' })
    const raw = await (await GET(req(), ctx)).text()
    const snapshotBlock = raw.split('\n\n').find((block) => block.includes('event: snapshot')) ?? ''
    expect(snapshotBlock).toContain('retry: 3000')
    expect(snapshotBlock).toContain('id: 0')
  })

  it('releases the single-flight lock after the run', async () => {
    const del = vi.fn()
    mockRedis.mockReturnValue({ set: vi.fn().mockResolvedValue('OK'), del })
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(freshRun)
    await readSse(await GET(req(), ctx))
    expect(del).toHaveBeenCalledWith('split-lock:job-1')
  })

  it('fails closed when Redis is unavailable (no double-generate)', async () => {
    mockRedis.mockReturnValue(null)
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(freshRun)
    const events = await readSse(await GET(req(), ctx))
    expect(mockStart).not.toHaveBeenCalled()
    expect(events.find((e) => e.event === 'error')?.data).toEqual({
      message: 'Generation is temporarily unavailable. Please try again.',
    })
  })

  it('does not double-generate when the lock is already held', async () => {
    mockRedis.mockReturnValue({ set: vi.fn().mockResolvedValue(null), del: vi.fn() })
    mockSnapshot.mockResolvedValue(processingSnap)
    mockRunState.mockResolvedValue(freshRun)
    const events = await readSse(await GET(req(), ctx))
    expect(mockStart).not.toHaveBeenCalled()
    expect(events.find((e) => e.event === 'done')?.data).toEqual({ status: 'processing' })
  })
})
