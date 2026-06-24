import { authedRouteWithParams, apiRedirect } from '@/lib/api/route'
import { problem, parseOr422 } from '@/lib/api/http'
import { idParam } from '@/lib/api/schemas/common'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl } from '@/lib/storage/s3'
import { logger } from '@/lib/infra/pino'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'

const log = logger.child({ tag: 'download' })

type RouteParams = Awaited<RouteContext<'/api/download/[id]'>['params']>

export const GET = authedRouteWithParams<RouteParams>({}, async ({ userId, isPro, params }) => {
  const parsedParams = parseOr422(idParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { id } = parsedParams.data

  const item = await getDownloadItem(userId, id)
  if (!item) return problem(404, ErrorMessage.FILE_NOT_FOUND)

  // Legacy items stored as external URLs predate S3 migration and cannot be signed
  if (!item.fileUrl || item.fileUrl.startsWith('http')) {
    log.warn({ userId, itemId: item.id, fileUrl: item.fileUrl ?? null }, 'file not downloadable')
    return problem(404, ErrorMessage.FILE_NOT_FOUND)
  }

  if (!isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)) {
    return problem(403, `Upgrade to Pro to access this ${item.itemType.name}.`)
  }

  const signedUrl = await getSignedDownloadUrl(item.fileUrl, undefined, item.fileName ?? undefined)
  log.info({ userId, itemId: item.id, itemType: item.itemType.name }, 'signedDownloadUrl')
  return apiRedirect(signedUrl)
})
