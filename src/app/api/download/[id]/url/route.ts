import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import { canGenerateImageThumbnail, getImageThumbnailKey } from '@/lib/storage/image-thumbnails'
import type { RouteContext } from '@/lib/api'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import type { SignedDownloadUrlResponse } from '@/types/item'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('download-url')

async function signedDownloadUrlResponse(storageKey: string, fileName?: string) {
  const url = await getSignedDownloadUrl(storageKey, undefined, fileName)
  const expiresAt = getSignedUrlExpiresAt()
  return ApiResponse.OK<SignedDownloadUrlResponse>({ url, expiresAt: expiresAt.toISOString() })
}

export const GET = authenticatedRoute(async (request, context: RouteContext, { userId, isPro }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getDownloadItem(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('File not found.')

  if (!PRO_ITEM_TYPE_NAMES.has(item.itemType.name)) {
    return ApiResponse.BAD_REQUEST('Signed URLs are only available for file and image items.')
  }

  // Legacy items stored as external URLs predate S3 migration and cannot be signed
  if (!item.fileUrl || item.fileUrl.startsWith('http')) {
    log.warn('file not signable', { userId, itemId: item.id, fileUrl: item.fileUrl ?? null })
    return ApiResponse.NOT_FOUND('File not found.')
  }

  const preview = new URL(request.url).searchParams.get('preview') === '1'
  const isImagePreview = preview && item.itemType.name === 'image'

  if (!isPro && !isImagePreview) {
    return ApiResponse.FORBIDDEN('Direct download URLs require a Pro subscription.')
  }

  if (isImagePreview && !canGenerateImageThumbnail(item.fileUrl)) {
    if (!isPro) return ApiResponse.FORBIDDEN('Direct preview URLs require a generated thumbnail.')
    return signedDownloadUrlResponse(item.fileUrl)
  }

  const storageKey = isImagePreview ? getImageThumbnailKey(item.fileUrl) : item.fileUrl
  const fileName = isImagePreview ? undefined : (item.fileName ?? undefined)
  log.info('signedDownloadUrl', { userId, itemId: item.id, itemType: item.itemType.name })
  return signedDownloadUrlResponse(storageKey, fileName)
})
