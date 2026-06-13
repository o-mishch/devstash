import { ApiResponse, apiRedirect, authenticatedRoute } from '@/lib/api'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl, fileExistsInS3 } from '@/lib/storage/s3'
import type { RouteContext } from '@/lib/api'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('download')

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId, isPro }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getDownloadItem(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('File not found.')

  if (!item.fileUrl || item.fileUrl.startsWith('http')) return ApiResponse.NOT_FOUND('File not found.')

  if (!isPro && item.itemType.name === 'file') {
    return ApiResponse.FORBIDDEN('Upgrade to Pro to access this file.')
  }
  if (!isPro && item.itemType.name === 'image') {
    return ApiResponse.FORBIDDEN('Upgrade to Pro to access this image.')
  }

  const exists = await fileExistsInS3(item.fileUrl)
  if (!exists) {
    log.warn('file not found in storage', { userId, itemId: item.id, key: item.fileUrl })
    return ApiResponse.NOT_FOUND('The file no longer exists in storage.')
  }

  const signedUrl = await getSignedDownloadUrl(item.fileUrl, undefined, item.fileName ?? undefined)
  log.info('signedDownloadUrl', { userId, itemId: item.id, itemType: item.itemType.name })
  return apiRedirect(signedUrl)
})
