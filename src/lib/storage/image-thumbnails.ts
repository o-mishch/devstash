import type { Readable } from 'stream'
import { lookup as mimeType } from 'mime-types'
import sharp from 'sharp'
import { ALLOWED_IMAGE_EXTS, IMAGE_THUMBNAIL_MAX_WIDTH, IMAGE_THUMBNAIL_QUALITY } from '@/lib/utils/constants'
import { getFileExtension } from '@/lib/utils/files'
import { downloadFromFilebase, deleteFromFilebase } from '@/lib/storage/filebase'

export function getImageThumbnailKey(fileUrl: string): string {
  const dotIndex = fileUrl.lastIndexOf('.')
  if (dotIndex === -1) return `${fileUrl}-thumb.webp`
  return `${fileUrl.slice(0, dotIndex)}-thumb.webp`
}

export function canGenerateImageThumbnail(fileUrl: string): boolean {
  const ext = getFileExtension(fileUrl)
  return ALLOWED_IMAGE_EXTS.has(ext) && ext !== 'svg'
}

export async function generateImageThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { animated: false })
    .rotate()
    .resize(IMAGE_THUMBNAIL_MAX_WIDTH, null, { withoutEnlargement: true })
    .webp({ quality: IMAGE_THUMBNAIL_QUALITY })
    .toBuffer()
}

export interface ImagePreviewStream {
  readable: Readable
  contentType: string
}

export async function buildImagePreviewStream(fileUrl: string): Promise<ImagePreviewStream | null> {
  const thumbStream = await downloadFromFilebase(getImageThumbnailKey(fileUrl))
  if (thumbStream) {
    return { readable: thumbStream, contentType: 'image/webp' }
  }

  const ext = getFileExtension(fileUrl)
  const fullStream = await downloadFromFilebase(fileUrl)
  if (!fullStream) return null

  if (ext === 'svg') {
    return {
      readable: fullStream,
      contentType: mimeType(fileUrl) || 'image/svg+xml',
    }
  }

  const pipeline = sharp()
    .rotate()
    .resize(IMAGE_THUMBNAIL_MAX_WIDTH, null, { withoutEnlargement: true })
    .webp({ quality: IMAGE_THUMBNAIL_QUALITY })

  return {
    readable: fullStream.pipe(pipeline),
    contentType: 'image/webp',
  }
}

export async function deleteStoredImageFiles(fileUrl: string): Promise<void> {
  await deleteFromFilebase(fileUrl)
  if (canGenerateImageThumbnail(fileUrl)) {
    await deleteFromFilebase(getImageThumbnailKey(fileUrl))
  }
}
