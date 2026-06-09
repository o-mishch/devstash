import { vi, describe, it, expect, beforeEach } from 'vitest'
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { uploadToFilebase, deleteFromFilebase, downloadFromFilebase } from './filebase'
import type { Readable } from 'stream'

// Mock the AWS SDK
const mockSend = vi.fn()

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

describe('filebase utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
