import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { getCachedSession as GetCachedSessionFn } from '@/lib/session'
import type { getCachedVerifiedProAccess as GetCachedVerifiedProAccessFn } from '@/lib/billing/access/pro-access-resolution'
import type { listParseSourceCandidates as ListParseSourceCandidatesFn } from '@/lib/db/ai-parse-jobs'

// Exercises the source picker route: auth (401), Pro gate (403), and that the listing is scoped
// to the session userId (200).
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof GetCachedSessionFn>() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn<typeof GetCachedVerifiedProAccessFn>(),
}))
vi.mock('@/lib/db/ai-parse-jobs', () => ({
  listParseSourceCandidates: vi.fn<typeof ListParseSourceCandidatesFn>(),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { listParseSourceCandidates } from '@/lib/db/ai-parse-jobs'
import { GET } from './route'

const mockSession = vi.mocked(getCachedSession)
const mockPro = vi.mocked(getCachedVerifiedProAccess)
const mockList = vi.mocked(listParseSourceCandidates)

function getReq(type?: string): NextRequest {
  const url = type
    ? `http://localhost/api/ai/brain-dump/sources?type=${type}`
    : 'http://localhost/api/ai/brain-dump/sources'
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1', isPro: true }, expires: '2099-01-01' })
  mockPro.mockResolvedValue(true)
})

describe('GET /ai/brain-dump/sources', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET(getReq())
    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not Pro', async () => {
    mockPro.mockResolvedValue(false)
    const res = await GET(getReq())
    expect(res.status).toBe(403)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('defaults to listing file sources, scoped to the session userId', async () => {
    const sources = [{ itemId: 'f1', name: 'notes.md', itemTypeName: 'file', sizeBytes: 12 }]
    mockList.mockResolvedValue(sources)
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sources })
    expect(mockList).toHaveBeenCalledWith('user-1', 'file')
  })

  it('lists content item sources when ?type=content', async () => {
    const sources = [{ itemId: 'n1', name: 'Project ideas', itemTypeName: 'command', sizeBytes: 64 }]
    mockList.mockResolvedValue(sources)
    const res = await GET(getReq('content'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sources })
    expect(mockList).toHaveBeenCalledWith('user-1', 'content')
  })

  it('returns 422 for an unknown source type', async () => {
    const res = await GET(getReq('image'))
    expect(res.status).toBe(422)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('validates the query before the Pro gate: a non-Pro user with a bad query gets 422, not 403', async () => {
    mockPro.mockResolvedValue(false)
    const res = await GET(getReq('image'))
    expect(res.status).toBe(422)
    expect(mockList).not.toHaveBeenCalled()
  })
})
