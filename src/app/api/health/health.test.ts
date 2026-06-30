import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the route wrapper to a faithful pass-through so importing ./route doesn't
// pull in the next-auth chain (publicRoute only injects { request } + a try/catch).
vi.mock('@/lib/api/route', () => ({
  publicRoute:
    (handler: (ctx: { request: unknown }) => Promise<unknown>) =>
    (request: unknown) =>
      handler({ request }),
}))
vi.mock('@/lib/infra/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/infra/health-checks', () => ({
  checkRedis: vi.fn(),
  checkS3: vi.fn(),
  checkEmail: vi.fn(),
}))

import { prisma } from '@/lib/infra/prisma'
import { checkRedis, checkS3, checkEmail } from '@/lib/infra/health-checks'

import { GET } from './route'

const mockQueryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>
const mockRedis = checkRedis as ReturnType<typeof vi.fn>
const mockS3 = checkS3 as ReturnType<typeof vi.fn>
const mockEmail = checkEmail as ReturnType<typeof vi.fn>

const req = (qs = '') => new NextRequest(`http://localhost/api/health${qs}`, { method: 'GET' })

beforeEach(() => {
  vi.clearAllMocks()
  mockQueryRaw.mockResolvedValue([{ '?column?': 1 }])
  mockRedis.mockResolvedValue('ok')
  mockS3.mockResolvedValue('ok')
  mockEmail.mockResolvedValue('ok')
})

describe('GET /api/health (liveness)', () => {
  it('returns 200 {status:ok} without touching any dependency', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(mockQueryRaw).not.toHaveBeenCalled()
    expect(mockRedis).not.toHaveBeenCalled()
  })
})

describe('GET /api/health?deep=1 (readiness)', () => {
  it('returns 200 with all dependencies ok', async () => {
    const res = await GET(req('?deep=1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', db: 'ok', redis: 'ok', s3: 'ok', email: 'ok' })
  })

  it('returns 503 when the database is unreachable (DB is the only critical dep)', async () => {
    mockQueryRaw.mockRejectedValue(new Error('connection refused'))
    const res = await GET(req('?deep=1'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'degraded', db: 'down' })
  })

  it('stays 200 when an optional dep is down (redis/s3/email never fail readiness)', async () => {
    mockRedis.mockResolvedValue('down')
    mockS3.mockResolvedValue('down')
    mockEmail.mockResolvedValue('disabled')
    const res = await GET(req('?deep=1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'ok',
      db: 'ok',
      redis: 'down',
      s3: 'down',
      email: 'disabled',
    })
  })

  it('treats a thrown optional check as down without failing the probe', async () => {
    mockS3.mockRejectedValue(new Error('boom'))
    const res = await GET(req('?deep=1'))
    expect(res.status).toBe(200)
    expect((await res.json()).s3).toBe('down')
  })
})
