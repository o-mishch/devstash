import { vi, describe, it, expect, beforeEach } from 'vitest'
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  uploadToS3,
  deleteFromS3,
  getSignedDownloadUrl,
  getSignedUrlExpiresAt,
  getPresignedPostCredential,
} from './s3'

// Mock the AWS SDK
const mockSend = vi.fn()
const { mockGetSignedUrl, mockCreatePresignedPost, mockLogError } = vi.hoisted(() => ({
  mockGetSignedUrl: vi.fn(),
  mockCreatePresignedPost: vi.fn(),
  mockLogError: vi.fn(),
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: mockLogError }) },
}))

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: mockCreatePresignedPost,
}))

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(function() {
      return { send: mockSend }
    }),
    PutObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}))

describe('s3 utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    process.env.AWS_ACCESS_KEY_ID = 'test-key'
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret'
    process.env.AWS_S3_BUCKET = 'test-bucket'
    process.env.AWS_REGION = 'eu-central-1'
  })

  describe('uploadToS3', () => {
    it('sends PutObjectCommand with correct parameters', async () => {
      const buffer = Buffer.from('test data')
      await uploadToS3('test/key.png', buffer, 'image/png')
      
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
        Body: buffer,
        ContentType: 'image/png',
      })
      expect(mockSend).toHaveBeenCalled()
    })
  })

  describe('deleteFromS3', () => {
    it('sends DeleteObjectCommand with correct parameters', async () => {
      await deleteFromS3('test/key.png')
      
      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
      })
      expect(mockSend).toHaveBeenCalled()
    })

    it('catches and logs error instead of throwing', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 error'))

      await expect(deleteFromS3('test/key.png')).resolves.not.toThrow()
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'test/key.png' }),
        'delete failed',
      )
    })
  })

  describe('getSignedDownloadUrl', () => {
    it('signs a GetObjectCommand for the requested key with the default TTL', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed.example/file.png')

      const result = await getSignedDownloadUrl('test/key.png')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
        ResponseCacheControl: 'max-age=840, private',
      })
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 900 },
      )
      expect(result).toBe('https://signed.example/file.png')
    })

    it('allows overriding the signed URL TTL', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed.example/file.png')

      await getSignedDownloadUrl('test/key.png', 60)

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 60 },
      )
    })

    it('adds ResponseContentDisposition when fileName is provided', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed.example/file.pdf')

      await getSignedDownloadUrl('test/key.pdf', undefined, 'my report.pdf')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.pdf',
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent('my report.pdf')}"`,
        ResponseCacheControl: 'max-age=840, private',
      })
    })
  })

  describe('getPresignedPostCredential', () => {
    it('returns url and fields with content-length-range condition baked in', async () => {
      mockCreatePresignedPost.mockResolvedValueOnce({
        url: 'https://s3.example/bucket',
        fields: { 'Content-Type': 'image/png', Policy: 'abc', 'X-Amz-Signature': 'sig' },
      })

      const result = await getPresignedPostCredential('test/key.png', 'image/png', 5_000_000)

      expect(mockCreatePresignedPost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'test/key.png',
          Conditions: expect.arrayContaining([
            ['content-length-range', 1, 5_000_000],
          ]),
        }),
      )
      expect(result.url).toBe('https://s3.example/bucket')
      expect(result.fields['Content-Type']).toBe('image/png')
    })
  })

  describe('getSignedUrlExpiresAt', () => {
    it('returns an expiry date based on the TTL', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'))

      expect(getSignedUrlExpiresAt(60).toISOString()).toBe('2024-06-01T12:01:00.000Z')
    })
  })
})
