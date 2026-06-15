import { vi, describe, it, expect, beforeEach } from 'vitest'
import { invoke, expectORPCError } from '@/test/orpc'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, checkRateLimit: vi.fn() }
})
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ getPresignedPostCredential: vi.fn(), getSignedUrlExpiresAt: vi.fn() }))
vi.mock('@/lib/storage/image-thumbnails', () => ({
  getImageThumbnailKey: vi.fn(() => 'user-1/thumb.webp'),
  canGenerateImageThumbnail: vi.fn(() => true),
  deleteStoredFile: vi.fn(),
}))
vi.mock('@/lib/storage/upload-tokens', () => ({ writePendingUpload: vi.fn(), sweepExpiredUploads: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { getPresignedPostCredential, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import { writePendingUpload } from '@/lib/storage/upload-tokens'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { uploadRouter } from './upload'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockGetPresigned = getPresignedPostCredential as ReturnType<typeof vi.fn>
const mockGetExpiresAt = getSignedUrlExpiresAt as ReturnType<typeof vi.fn>
const mockWritePending = writePendingUpload as ReturnType<typeof vi.fn>
const mockDeleteStoredFile = deleteStoredFile as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(true)
  mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockGetPresigned.mockResolvedValue({ url: 'https://s3.example/bucket', fields: { key: 'user-1/abc.png' } })
  mockGetExpiresAt.mockReturnValue(new Date('2026-01-01T00:00:00.000Z'))
  mockWritePending.mockResolvedValue(undefined)
})

describe('upload.getUploadUrl', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(uploadRouter.getUploadUrl, { fileName: 'a.png', fileSize: 100 }), 'UNAUTHORIZED')
  })

  it('throws FORBIDDEN for non-Pro users', async () => {
    mockIsPro.mockResolvedValue(false)
    await expectORPCError(invoke(uploadRouter.getUploadUrl, { fileName: 'a.png', fileSize: 100 }), 'FORBIDDEN')
    expect(mockGetPresigned).not.toHaveBeenCalled()
  })

  it('throws TOO_MANY_REQUESTS when the limiter denies', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(uploadRouter.getUploadUrl, { fileName: 'a.png', fileSize: 100 }), 'TOO_MANY_REQUESTS')
  })

  it('throws BAD_REQUEST for a disallowed extension', async () => {
    await expectORPCError(invoke(uploadRouter.getUploadUrl, { fileName: 'malware.exe', fileSize: 100 }), 'BAD_REQUEST')
  })

  it('throws BAD_REQUEST when the file exceeds the size limit', async () => {
    await expectORPCError(invoke(uploadRouter.getUploadUrl, { fileName: 'a.png', fileSize: 999_999_999 }), 'BAD_REQUEST')
  })

  it('throws INTERNAL_SERVER_ERROR when the pending-upload write fails', async () => {
    mockWritePending.mockRejectedValue(new Error('redis down'))
    await expectORPCError(invoke(uploadRouter.getUploadUrl, { fileName: 'a.png', fileSize: 100 }), 'INTERNAL_SERVER_ERROR')
  })

  it('returns presigned credentials on success', async () => {
    const result = await invoke(uploadRouter.getUploadUrl, { fileName: 'a.png', fileSize: 100 })
    expect(result).toMatchObject({
      original: { url: 'https://s3.example/bucket', fields: { key: 'user-1/abc.png' } },
      expiresAt: '2026-01-01T00:00:00.000Z',
    })
    expect(mockWritePending).toHaveBeenCalled()
  })
})

describe('upload.deleteUpload', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(uploadRouter.deleteUpload, { key: 'user-1/a.png' }), 'UNAUTHORIZED')
  })

  it('throws FORBIDDEN when the key belongs to another user', async () => {
    await expectORPCError(invoke(uploadRouter.deleteUpload, { key: 'user-2/a.png' }), 'FORBIDDEN')
    expect(mockDeleteStoredFile).not.toHaveBeenCalled()
  })

  it('deletes a key owned by the session user', async () => {
    await invoke(uploadRouter.deleteUpload, { key: 'user-1/a.png' })
    expect(mockDeleteStoredFile).toHaveBeenCalledWith('user-1/a.png')
  })
})
