import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { downloadQueryParse } from '@/lib/api/schemas/download'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import { canGenerateImageThumbnail, getImageThumbnailKey } from '@/lib/storage/image-thumbnails'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'
import type { SignedDownloadUrlResponse } from '@/types/item'

const log = logger.child({ tag: 'download-url' })

async function signedDownloadUrlResponse(storageKey: string, fileName?: string): Promise<SignedDownloadUrlResponse> {
  const url = await getSignedDownloadUrl(storageKey, undefined, fileName)
  return { url, expiresAt: getSignedUrlExpiresAt().toISOString() }
}

export const GET = authedRouteWithParams<IdParam>({}, async ({ userId, isPro, request, params }) => {
  const parsed = parseOr422(downloadQueryParse, {
    preview: request.nextUrl.searchParams.get('preview') ?? undefined,
  })
  if (!parsed.ok) return parsed.res
  const preview = parsed.data.preview ?? false

  const item = await getDownloadItem(userId, params.id)
  if (!item) return problem(404, ErrorMessage.FILE_NOT_FOUND)

  if (!PRO_ITEM_TYPE_NAMES.has(item.itemType.name)) {
    return problem(400, 'Signed URLs are only available for file and image items.')
  }

  // Legacy items stored as external URLs predate S3 migration and cannot be signed.
  if (!item.fileUrl || item.fileUrl.startsWith('http')) {
    log.warn({ userId, itemId: item.id, fileUrl: item.fileUrl ?? null }, 'file not signable')
    return problem(404, ErrorMessage.FILE_NOT_FOUND)
  }

  const isImagePreview = preview === true && item.itemType.name === 'image'

  if (!isPro && !isImagePreview) {
    return problem(403, 'Direct download URLs require a Pro subscription.')
  }

  if (isImagePreview && !canGenerateImageThumbnail(item.fileUrl)) {
    if (!isPro) return problem(403, 'Direct preview URLs require a generated thumbnail.')
    return json(await signedDownloadUrlResponse(item.fileUrl))
  }

  const storageKey = isImagePreview ? getImageThumbnailKey(item.fileUrl) : item.fileUrl
  const fileName = isImagePreview ? undefined : (item.fileName ?? undefined)
  log.info({ userId, itemId: item.id, itemType: item.itemType.name }, 'signedDownloadUrl')
  return json(await signedDownloadUrlResponse(storageKey, fileName))
})
