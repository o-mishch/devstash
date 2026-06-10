import { vi, describe, it, expect, beforeEach } from 'vitest'
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  uploadToFilebase,
  deleteFromFilebase,
  downloadFromFilebase,
  fileExistsInFilebase,
  getSignedDownloadUrl,
  getSignedUrlExpiresAt,
} from './filebase'
import type { Readable } from 'stream'

// Mock the AWS SDK
const mockSend = vi.fn()
const { mockGetSignedUrl } = vi.hoisted(() => ({
  mockGetSignedUrl: vi.fn(),
}))

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(function() {
      return { send: mockSend }
    }),
    PutObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    HeadObjectCommand: vi.fn(),
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}))

describe('filebase utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    process.env.FILEBASE_KEY = 'test-key'
    process.env.FILEBASE_SECRET = 'test-secret'
    process.env.FILEBASE_BUCKET = 'test-bucket'
  })

  describe('uploadToFilebase', () => {
    it('sends PutObjectCommand with correct parameters', async () => {
      const buffer = Buffer.from('test data')
      await uploadToFilebase('test/key.png', buffer, 'image/png')
      
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
        Body: buffer,
        ContentType: 'image/png',
      })
      expect(mockSend).toHaveBeenCalled()
    })
  })

  describe('deleteFromFilebase', () => {
    it('sends DeleteObjectCommand with correct parameters', async () => {
      await deleteFromFilebase('test/key.png')
      
      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
      })
      expect(mockSend).toHaveBeenCalled()
    })

    it('catches and logs error instead of throwing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSend.mockRejectedValueOnce(new Error('S3 error'))
      
      await expect(deleteFromFilebase('test/key.png')).resolves.not.toThrow()
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('delete failed: test/key.png | error="S3 error"'))
      consoleSpy.mockRestore()
    })
  })

  describe('downloadFromFilebase', () => {
    it('sends GetObjectCommand and returns Body stream', async () => {
      const mockStream = {} as Readable
      mockSend.mockResolvedValueOnce({ Body: mockStream })
      
      const result = await downloadFromFilebase('test/key.png')
      
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
      })
      expect(mockSend).toHaveBeenCalled()
      expect(result).toBe(mockStream)
    })

    it('returns null and logs error if download fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSend.mockRejectedValueOnce(new Error('S3 error'))
      
      const result = await downloadFromFilebase('test/key.png')
      
      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('download failed: test/key.png | error="S3 error"'))
      consoleSpy.mockRestore()
    })
  })

  describe('fileExistsInFilebase', () => {
    it('sends HeadObjectCommand and returns true when the file exists', async () => {
      mockSend.mockResolvedValueOnce({})

      const result = await fileExistsInFilebase('test/key.png')

      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
      })
      expect(result).toBe(true)
    })

    it('returns false when the head request fails', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockSend.mockRejectedValueOnce(new Error('missing'))

      const result = await fileExistsInFilebase('test/key.png')

      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('head failed: test/key.png | error="missing"'))
      consoleSpy.mockRestore()
    })
  })

  describe('getSignedDownloadUrl', () => {
    it('signs a GetObjectCommand for the requested key with the default TTL', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed.example/file.png')

      const result = await getSignedDownloadUrl('test/key.png')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/key.png',
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
  })

  describe('getSignedUrlExpiresAt', () => {
    it('returns an expiry date based on the TTL', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'))

      expect(getSignedUrlExpiresAt(60).toISOString()).toBe('2024-06-01T12:01:00.000Z')
    })
  })
})
