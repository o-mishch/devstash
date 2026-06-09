import { describe, it, expect } from 'vitest'
import { getFileExtension } from '@/lib/utils/files'
import {
  getImageThumbnailKey,
  canGenerateImageThumbnail,
} from '@/lib/storage/image-thumbnails'

describe('image thumbnail utilities', () => {
  describe('getImageThumbnailKey', () => {
    it('replaces the file extension with -thumb.webp', () => {
      expect(getImageThumbnailKey('user-1/abc.png')).toBe('user-1/abc-thumb.webp')
      expect(getImageThumbnailKey('user-1/photo.jpeg')).toBe('user-1/photo-thumb.webp')
    })

    it('appends -thumb.webp when the key has no extension', () => {
      expect(getImageThumbnailKey('user-1/noext')).toBe('user-1/noext-thumb.webp')
    })
  })

  describe('getFileExtension', () => {
    it('returns the lowercase extension', () => {
      expect(getFileExtension('user-1/photo.JPG')).toBe('jpg')
      expect(getFileExtension('user-1/file')).toBe('')
    })
  })

  describe('canGenerateImageThumbnail', () => {
    it('returns true for raster image extensions except svg', () => {
      expect(canGenerateImageThumbnail('user-1/a.png')).toBe(true)
      expect(canGenerateImageThumbnail('user-1/a.webp')).toBe(true)
      expect(canGenerateImageThumbnail('user-1/a.gif')).toBe(true)
    })

    it('returns false for svg and non-image keys', () => {
      expect(canGenerateImageThumbnail('user-1/a.svg')).toBe(false)
      expect(canGenerateImageThumbnail('user-1/doc.pdf')).toBe(false)
    })
  })
})
