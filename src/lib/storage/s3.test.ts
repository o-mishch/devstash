import { vi, describe, it, expect, beforeEach } from 'vitest'
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  uploadToS3,
  deleteFromS3,
  getSignedDownloadUrl,
  getSignedUrlExpiresAt,
  getPresignedPutCredential,
  getTextFromS3,
} from './s3'
import { SPLIT_FILE_MAX_INPUT_CHARS } from '@/lib/utils/constants'

// Mock the AWS SDK
const mockSend = vi.fn()
const { mockGetSignedUrl, mockLogError } = vi.hoisted(() => ({
  mockGetSignedUrl: vi.fn(),
  mockLogError: vi.fn(),
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: mockLogError }) },
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

  describe('getPresignedPutCredential', () => {
    it('signs a PutObjectCommand carrying the exact ContentType and ContentLength', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/bucket/test/key.png?sig')

      const result = await getPresignedPutCredential('test/key.png', 'image/png', 5_000_000)

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
        ContentType: 'image/png',
        ContentLength: 5_000_000,
      })
      expect(result).toEqual({ url: 'https://s3.example/bucket/test/key.png?sig', key: 'test/key.png', contentType: 'image/png' })
    })

    it('forces content-type and content-length into the signature so S3/GCS enforce them', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/signed')

      await getPresignedPutCredential('test/key.png', 'image/png', 1234)

      const [, , options] = mockGetSignedUrl.mock.calls[0] as [
        unknown,
        unknown,
        { expiresIn: number; signableHeaders: Iterable<string> },
      ]
      expect(options.expiresIn).toBe(900)
      expect([...options.signableHeaders]).toEqual(
        expect.arrayContaining(['content-type', 'content-length']),
      )
    })
  })

  describe('getSignedUrlExpiresAt', () => {
    it('returns an expiry date based on the TTL', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'))

      expect(getSignedUrlExpiresAt(60).toISOString()).toBe('2024-06-01T12:01:00.000Z')
    })
  })

  describe('getTextFromS3', () => {
    it('issues a bounded Range GET sized to the parse window and decodes once (never the whole object)', async () => {
      const transformToString = vi.fn().mockResolvedValue('hello world')
      mockSend.mockResolvedValueOnce({ Body: { transformToString }, ContentRange: 'bytes 0-99/11', ContentLength: 11 })

      const result = await getTextFromS3('user/key.txt', SPLIT_FILE_MAX_INPUT_CHARS)

      // Range upper bound = parse-window chars × 4 (worst-case UTF-8 bytes/char) − 1; whole object never requested.
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'user/key.txt',
        Range: `bytes=0-${SPLIT_FILE_MAX_INPUT_CHARS * 4 - 1}`,
      })
      expect(transformToString).toHaveBeenCalledTimes(1) // consumed exactly once
      expect(result).toEqual({ text: 'hello world', truncated: false })
    })

    it('marks truncated when the object is larger than the bytes pulled (from ContentRange total)', async () => {
      const transformToString = vi.fn().mockResolvedValue('partial window')
      // total (after the slash) exceeds the pulled ContentLength → truncated.
      mockSend.mockResolvedValueOnce({
        Body: { transformToString },
        ContentRange: `bytes 0-${SPLIT_FILE_MAX_INPUT_CHARS * 4 - 1}/99999999`,
        ContentLength: SPLIT_FILE_MAX_INPUT_CHARS * 4,
      })

      const result = await getTextFromS3('user/big.txt', SPLIT_FILE_MAX_INPUT_CHARS)
      expect(result.truncated).toBe(true)
    })

    it('does NOT mark truncated when no ContentRange but a short ContentLength proves a whole-object read', async () => {
      // A small .txt: no range total header, but ContentLength < the requested window → we read it all.
      const transformToString = vi.fn().mockResolvedValue('short note')
      mockSend.mockResolvedValueOnce({ Body: { transformToString }, ContentLength: 10 })

      const result = await getTextFromS3('user/small.txt', SPLIT_FILE_MAX_INPUT_CHARS)
      expect(result).toEqual({ text: 'short note', truncated: false })
    })

    it('does NOT mark truncated when ContentLength is exactly requestedBytes', async () => {
      const transformToString = vi.fn().mockResolvedValue('exact window')
      const requestedBytes = SPLIT_FILE_MAX_INPUT_CHARS * 4
      mockSend.mockResolvedValueOnce({ Body: { transformToString }, ContentLength: requestedBytes })

      const result = await getTextFromS3('user/exact.txt', SPLIT_FILE_MAX_INPUT_CHARS)
      expect(result).toEqual({ text: 'exact window', truncated: false })
    })

    it('over-discloses (truncated) when neither ContentRange nor ContentLength can prove a whole read', async () => {
      // No headers to prove we got the whole object → safe direction is to flag a possible clip.
      const transformToString = vi.fn().mockResolvedValue('window of text')
      mockSend.mockResolvedValueOnce({ Body: { transformToString } })

      const result = await getTextFromS3('user/unknown.txt', SPLIT_FILE_MAX_INPUT_CHARS)
      expect(result.truncated).toBe(true)
    })

    it('throws when the object has no body', async () => {
      mockSend.mockResolvedValueOnce({ Body: undefined })
      await expect(getTextFromS3('user/missing.txt', SPLIT_FILE_MAX_INPUT_CHARS)).rejects.toThrow(
        'returned no body',
      )
    })
  })
})
