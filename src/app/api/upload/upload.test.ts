import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { after } from 'next/server'
import { readJson } from '@/test/matchers'
import type { getCachedSession as GetCachedSessionFn } from '@/lib/session'
import type { getCachedVerifiedProAccess as GetCachedVerifiedProAccessFn } from '@/lib/billing/access/pro-access-resolution'
import type { checkRateLimit as CheckRateLimitFn, deniedMessage } from '@/lib/infra/rate-limit'
import type { getPresignedPutCredential as GetPresignedPutCredentialFn, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import type {
  getImageThumbnailKey,
  canGenerateImageThumbnail,
  deleteStoredFile as DeleteStoredFileFn,
} from '@/lib/storage/image-thumbnails'
import type {
  writePendingUpload as WritePendingUploadFn,
  deletePendingUpload as DeletePendingUploadFn,
  sweepExpiredUploads,
} from '@/lib/storage/upload-tokens'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof GetCachedSessionFn>() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn<typeof GetCachedVerifiedProAccessFn>(),
}))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn<typeof CheckRateLimitFn>(),
  deniedMessage: vi.fn<typeof deniedMessage>((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: vi.fn<typeof after>(),
}))
vi.mock('@/lib/storage/s3', () => ({
  getPresignedPutCredential: vi.fn<typeof GetPresignedPutCredentialFn>(),
  getSignedUrlExpiresAt: vi.fn<typeof getSignedUrlExpiresAt>(() => new Date('2026-01-01T00:00:00.000Z')),
}))
vi.mock('@/lib/storage/image-thumbnails', () => ({
  getImageThumbnailKey: vi.fn<typeof getImageThumbnailKey>((k: string) => `thumb/${k}`),
  canGenerateImageThumbnail: vi.fn<typeof canGenerateImageThumbnail>(() => true),
  deleteStoredFile: vi.fn<typeof DeleteStoredFileFn>(),
}))
vi.mock('@/lib/storage/upload-tokens', () => ({
  writePendingUpload: vi.fn<typeof WritePendingUploadFn>(),
  deletePendingUpload: vi.fn<typeof DeletePendingUploadFn>(),
  sweepExpiredUploads: vi.fn<typeof sweepExpiredUploads>(),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { getPresignedPutCredential } from '@/lib/storage/s3'
import { writePendingUpload, deletePendingUpload } from '@/lib/storage/upload-tokens'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'

import { POST } from './url/route'
import { DELETE } from './route'

const mockSession = vi.mocked(getCachedSession)
const mockIsPro = vi.mocked(getCachedVerifiedProAccess)
const mockRateLimit = vi.mocked(checkRateLimit)
const mockPresigned = vi.mocked(getPresignedPutCredential)
const mockWritePending = vi.mocked(writePendingUpload)
const mockDeleteStored = vi.mocked(deleteStoredFile)
const mockDeletePending = vi.mocked(deletePendingUpload)

function postBody(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/upload/url', { method: 'POST', body: JSON.stringify(payload) })
}

function del(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/upload${qs}`, { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1', isPro: true }, expires: '2099-01-01T00:00:00.000Z' })
  mockIsPro.mockResolvedValue(true)
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  // Echo the signed key back (mirrors getPresignedPutCredential returning the key it signs) so
  // assertions can prove the server-authoritative key reaches the response verbatim.
  mockPresigned.mockImplementation((key: string, contentType: string) =>
    Promise.resolve({ url: `https://s3/bucket/${key}`, key, contentType }),
  )
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
    expect((await readJson(res)).message).toMatch(/not allowed/i)
  })

  it('returns 400 when the file exceeds the size limit', async () => {
    const res = await POST(postBody({ fileName: 'a.png', fileSize: 10 * 1024 * 1024 * 1024 }))
    expect(res.status).toBe(400)
    expect((await readJson(res)).message).toMatch(/limit/i)
  })

  it('returns 200 with presigned credentials and writes the pending upload (key scoped to userId)', async () => {
    const res = await POST(postBody({ fileName: 'photo.png', fileSize: 1000 }))
    expect(res.status).toBe(200)
    const body = await readJson<{ expiresAt: string; original: { key: string } }>(res)
    expect(body.expiresAt).toBe('2026-01-01T00:00:00.000Z')
    // The S3 key is namespaced under the session userId (IDOR-safe).
    const [keyArg, , sizeArg] = mockPresigned.mock.calls[0]
    expect(keyArg.startsWith('user-1/')).toBe(true)
    // The server-authoritative key is returned verbatim — the client uses it directly rather
    // than parsing it out of the URL (which would drop the userId prefix on virtual-host S3).
    expect(body.original.key).toBe(keyArg)
    // The original's exact byte size is signed into the URL so S3/GCS enforce it.
    expect(sizeArg).toBe(1000)
    expect(mockWritePending).toHaveBeenCalled()
  })

  it('signs a thumb credential with its exact size only when thumbSize is supplied', async () => {
    const res = await POST(postBody({ fileName: 'photo.png', fileSize: 1000, thumbSize: 4096 }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.thumb).not.toBeNull()
    // Two presigns: original (fileSize) + thumb (image/webp, thumbSize).
    expect(mockPresigned).toHaveBeenCalledTimes(2)
    const [, thumbType, thumbSizeArg] = mockPresigned.mock.calls[1]
    expect(thumbType).toBe('image/webp')
    expect(thumbSizeArg).toBe(4096)
  })

  it('does not issue a thumb credential when thumbSize is omitted', async () => {
    const res = await POST(postBody({ fileName: 'photo.png', fileSize: 1000 }))
    expect(res.status).toBe(200)
    expect((await readJson(res)).thumb).toBeNull()
    expect(mockPresigned).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when the declared thumbSize exceeds the thumbnail cap', async () => {
    const res = await POST(postBody({ fileName: 'photo.png', fileSize: 1000, thumbSize: 200 * 1024 }))
    expect(res.status).toBe(400)
    expect((await readJson(res)).message).toMatch(/thumbnail/i)
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

  it('returns 204 and deletes the S3 object + pending_upload token for a key owned by the user', async () => {
    const res = await DELETE(del('?key=user-1/abc.png'))
    expect(res.status).toBe(204)
    expect(mockDeleteStored).toHaveBeenCalledWith('user-1/abc.png')
    expect(mockDeletePending).toHaveBeenCalledWith('user-1/abc.png')
  })

  it('does not delete the pending_upload token when the key fails the IDOR check', async () => {
    const res = await DELETE(del('?key=attacker/secret.png'))
    expect(res.status).toBe(403)
    expect(mockDeletePending).not.toHaveBeenCalled()
  })
})
