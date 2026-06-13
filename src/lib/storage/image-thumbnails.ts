'server-only'

import { ALLOWED_IMAGE_EXTS } from '@/lib/utils/constants'
import { getFileExtension } from '@/lib/utils/files'
import { deleteFromS3 } from '@/lib/storage/s3'

export function getImageThumbnailKey(fileUrl: string): string {
  const dotIndex = fileUrl.lastIndexOf('.')
  if (dotIndex === -1) return `${fileUrl}-thumb.webp`
  return `${fileUrl.slice(0, dotIndex)}-thumb.webp`
}

export function canGenerateImageThumbnail(fileUrl: string): boolean {
  const ext = getFileExtension(fileUrl)
  return ALLOWED_IMAGE_EXTS.has(ext) && ext !== 'svg'
}

export async function deleteStoredFile(fileUrl: string): Promise<void> {
  await deleteFromS3(fileUrl)
  if (canGenerateImageThumbnail(fileUrl)) {
    await deleteFromS3(getImageThumbnailKey(fileUrl))
  }
}
