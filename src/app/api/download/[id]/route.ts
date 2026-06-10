import { ApiResponse, apiRedirect, authenticatedRoute } from '@/lib/api'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl } from '@/lib/storage/filebase'
import { canGenerateImageThumbnail, getImageThumbnailKey } from '@/lib/storage/image-thumbnails'
import type { RouteContext } from '@/lib/api'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('download')

export const GET = authenticatedRoute(async (request, context: RouteContext, { userId, isPro }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getDownloadItem(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('File not found.')

  const preview = new URL(request.url).searchParams.get('preview') === '1'
  if (!isPro && item.itemType.name === 'file') {
    return ApiResponse.FORBIDDEN('Upgrade to Pro to access this file.')
  }
  if (!isPro && item.itemType.name === 'image' && !preview) {
    return ApiResponse.FORBIDDEN('Upgrade to Pro to access this image.')
  }

  if (!item.fileUrl || item.fileUrl.startsWith('http')) return ApiResponse.NOT_FOUND('File not found.')

  const isImagePreview = preview && item.itemType.name === 'image'
  const storageKey = isImagePreview && canGenerateImageThumbnail(item.fileUrl)
    ? getImageThumbnailKey(item.fileUrl)
    : item.fileUrl

  const signedUrl = await getSignedDownloadUrl(storageKey)
  log.info(`redirect issued: item:${item.id} preview=${preview}`)
  return apiRedirect(signedUrl)
})
