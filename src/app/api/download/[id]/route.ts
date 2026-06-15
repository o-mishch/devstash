import { ApiResponse, apiRedirect, authenticatedRoute } from '@/lib/api'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl } from '@/lib/storage/s3'
import type { RouteContext } from '@/lib/api'
import { logger } from '@/lib/infra/pino'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'

const log = logger.child({ tag: 'download' })

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId, isPro }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getDownloadItem(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('File not found.')

  // Legacy items stored as external URLs predate S3 migration and cannot be signed
  if (!item.fileUrl || item.fileUrl.startsWith('http')) {
    log.warn({ userId, itemId: item.id, fileUrl: item.fileUrl ?? null }, 'file not downloadable')
    return ApiResponse.NOT_FOUND('File not found.')
  }

  if (!isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)) {
    return ApiResponse.FORBIDDEN(`Upgrade to Pro to access this ${item.itemType.name}.`)
  }

  const signedUrl = await getSignedDownloadUrl(item.fileUrl, undefined, item.fileName ?? undefined)
  log.info({ userId, itemId: item.id, itemType: item.itemType.name }, 'signedDownloadUrl')
  return apiRedirect(signedUrl)
})
