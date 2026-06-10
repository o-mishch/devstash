import { ALLOWED_IMAGE_EXTS } from '@/lib/utils/constants'
import { getFileExtension } from '@/lib/utils/files'
import { deleteFromFilebase } from '@/lib/storage/filebase'

export function getImageThumbnailKey(fileUrl: string): string {
  const dotIndex = fileUrl.lastIndexOf('.')
  if (dotIndex === -1) return `${fileUrl}-thumb.webp`
  return `${fileUrl.slice(0, dotIndex)}-thumb.webp`
}

export function canGenerateImageThumbnail(fileUrl: string): boolean {
  const ext = getFileExtension(fileUrl)
  return ALLOWED_IMAGE_EXTS.has(ext) && ext !== 'svg'
}

export async function deleteStoredImageFiles(fileUrl: string): Promise<void> {
  await deleteFromFilebase(fileUrl)
  if (canGenerateImageThumbnail(fileUrl)) {
    await deleteFromFilebase(getImageThumbnailKey(fileUrl))
  }
}
