import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({
  getPresignedPostCredential: vi.fn(),
  getSignedUrlExpiresAt: vi.fn(() => new Date('2026-01-01T00:00:00.000Z')),
}))
vi.mock('@/lib/storage/image-thumbnails', () => ({
  getImageThumbnailKey: vi.fn((k: string) => `thumb/${k}`),
  canGenerateImageThumbnail: vi.fn(() => true),
  deleteStoredFile: vi.fn(),
}))
vi.mock('@/lib/storage/upload-tokens', () => ({ writePendingUpload: vi.fn(), sweepExpiredUploads: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { getPresignedPostCredential } from '@/lib/storage/s3'
import { writePendingUpload } from '@/lib/storage/upload-tokens'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'

import { POST } from './url/route'
import { DELETE } from './route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockPresigned = getPresignedPostCredential as ReturnType<typeof vi.fn>
const mockWritePending = writePendingUpload as ReturnType<typeof vi.fn>
const mockDeleteStored = deleteStoredFile as ReturnType<typeof vi.fn>

function postBody(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/upload/url', { method: 'POST', body: JSON.stringify(payload) })
}

function del(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/upload${qs}`, { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(true)
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockPresigned.mockResolvedValue({ url: 'https://s3', fields: { key: 'user-1/abc.png' } })
})

describe('POST /upload/url', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await POST(postBody({ fileName: 'a.png', fileSize: 100 }))
    expect(res.status).toBe(401)
  })

  it('returns 422 for a missing fileName', async () => {
    const res = await POST(postBody({ fileSize: 100 }))
    expect(res.status).toBe(422)
  })

  it('returns 403 when the user is not Pro', async () => {
    mockIsPro.mockResolvedValue(false)
    const res = await POST(postBody({ fileName: 'a.png', fileSize: 100 }))
    expect(res.status).toBe(403)
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After when rate-limited', async () => {
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    const res = await POST(postBody({ fileName: 'a.png', fileSize: 100 }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
  })

  it('returns 400 for a disallowed extension', async () => {
    const res = await POST(postBody({ fileName: 'malware.exe', fileSize: 100 }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/not allowed/i)
  })

  it('returns 400 when the file exceeds the size limit', async () => {
    const res = await POST(postBody({ fileName: 'a.png', fileSize: 10 * 1024 * 1024 * 1024 }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/limit/i)
  })

  it('returns 200 with presigned credentials and writes the pending upload (key scoped to userId)', async () => {
    const res = await POST(postBody({ fileName: 'photo.png', fileSize: 1000 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.original.url).toBe('https://s3')
    expect(body.expiresAt).toBe('2026-01-01T00:00:00.000Z')
    // The S3 key is namespaced under the session userId (IDOR-safe).
    const keyArg = mockPresigned.mock.calls[0][0] as string
    expect(keyArg.startsWith('user-1/')).toBe(true)
    expect(mockWritePending).toHaveBeenCalled()
  })

  it('returns 500 when writing the pending upload fails', async () => {
    mockWritePending.mockRejectedValue(new Error('redis down'))
    const res = await POST(postBody({ fileName: 'photo.png', fileSize: 1000 }))
    expect(res.status).toBe(500)
  })
})

describe('DELETE /upload', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await DELETE(del('?key=user-1/abc.png'))
    expect(res.status).toBe(401)
  })

  it('returns 422 when the key is missing', async () => {
    const res = await DELETE(del(''))
    expect(res.status).toBe(422)
  })

  it('returns 403 when the key does not belong to the user (IDOR)', async () => {
    const res = await DELETE(del('?key=attacker/secret.png'))
    expect(res.status).toBe(403)
    expect(mockDeleteStored).not.toHaveBeenCalled()
  })

  it('returns 204 and deletes a key owned by the user', async () => {
    const res = await DELETE(del('?key=user-1/abc.png'))
    expect(res.status).toBe(204)
    expect(mockDeleteStored).toHaveBeenCalledWith('user-1/abc.png')
  })
})
