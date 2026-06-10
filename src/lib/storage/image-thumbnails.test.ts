import { describe, expect, it } from 'vitest'
import { getFileExtension } from '@/lib/utils/files'
import { canGenerateImageThumbnail, getImageThumbnailKey } from './image-thumbnails'

describe('getImageThumbnailKey', () => {
  it('inserts the thumbnail suffix before the final extension', () => {
    expect(getImageThumbnailKey('user-1/uploads/photo.large.png')).toBe('user-1/uploads/photo.large-thumb.webp')
  })

  it('appends the thumbnail suffix when the key has no extension', () => {
    expect(getImageThumbnailKey('user-1/uploads/photo')).toBe('user-1/uploads/photo-thumb.webp')
  })
})

describe('getFileExtension', () => {
  it('returns the lowercase extension', () => {
    expect(getFileExtension('user-1/photo.JPG')).toBe('jpg')
    expect(getFileExtension('user-1/file')).toBe('')
  })
})

describe('canGenerateImageThumbnail', () => {
  it('allows raster image formats supported by the upload rules', () => {
    expect(canGenerateImageThumbnail('image.png')).toBe(true)
    expect(canGenerateImageThumbnail('image.jpg')).toBe(true)
    expect(canGenerateImageThumbnail('image.webp')).toBe(true)
  })

  it('excludes SVG and non-image file types', () => {
    expect(canGenerateImageThumbnail('image.svg')).toBe(false)
    expect(canGenerateImageThumbnail('doc.pdf')).toBe(false)
  })
})
