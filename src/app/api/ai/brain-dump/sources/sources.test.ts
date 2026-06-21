import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Exercises the source picker route: auth (401), Pro gate (403), and that the listing is scoped
// to the session userId (200).
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/db/ai-parse-jobs', () => ({ listParseSourceCandidates: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { listParseSourceCandidates } from '@/lib/db/ai-parse-jobs'
import { GET } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockList = listParseSourceCandidates as ReturnType<typeof vi.fn>

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/ai/brain-dump/sources')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
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

  it('returns the user\'s eligible sources, scoped to the session userId', async () => {
    const sources = [{ itemId: 'f1', name: 'notes.md', sizeBytes: 12 }]
    mockList.mockResolvedValue(sources)
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sources })
    expect(mockList).toHaveBeenCalledWith('user-1')
  })
})
