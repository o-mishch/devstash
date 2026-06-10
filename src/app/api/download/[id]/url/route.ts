import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl, getSignedUrlExpiresAt } from '@/lib/storage/filebase'
import { canGenerateImageThumbnail, getImageThumbnailKey } from '@/lib/storage/image-thumbnails'
import type { RouteContext } from '@/lib/api'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import type { SignedDownloadUrlResponse } from '@/types/item'

async function signedDownloadUrlResponse(storageKey: string) {
  const url = await getSignedDownloadUrl(storageKey)
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

  if (!item.fileUrl || item.fileUrl.startsWith('http')) {
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
  return signedDownloadUrlResponse(storageKey)
})
