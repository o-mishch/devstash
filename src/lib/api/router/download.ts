import 'server-only'
import { ORPCError } from '@orpc/server'
import { authed } from '../orpc'
import { ErrorMessage } from '../error-messages'
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

export const downloadRouter = {
  getSignedUrl: authed.download.getSignedUrl.handler(async ({ input, context }) => {
    const { userId, isPro } = context

    const item = await getDownloadItem(userId, input.id)
    if (!item) throw new ORPCError('NOT_FOUND', { message: ErrorMessage.FILE_NOT_FOUND })

    if (!PRO_ITEM_TYPE_NAMES.has(item.itemType.name)) {
      throw new ORPCError('BAD_REQUEST', { message: 'Signed URLs are only available for file and image items.' })
    }

    // Legacy items stored as external URLs predate S3 migration and cannot be signed.
    if (!item.fileUrl || item.fileUrl.startsWith('http')) {
      log.warn({ userId, itemId: item.id, fileUrl: item.fileUrl ?? null }, 'file not signable')
      throw new ORPCError('NOT_FOUND', { message: ErrorMessage.FILE_NOT_FOUND })
    }

    const isImagePreview = input.preview === true && item.itemType.name === 'image'

    if (!isPro && !isImagePreview) {
      throw new ORPCError('FORBIDDEN', { message: 'Direct download URLs require a Pro subscription.' })
    }

    if (isImagePreview && !canGenerateImageThumbnail(item.fileUrl)) {
      if (!isPro) throw new ORPCError('FORBIDDEN', { message: 'Direct preview URLs require a generated thumbnail.' })
      return signedDownloadUrlResponse(item.fileUrl)
    }

    const storageKey = isImagePreview ? getImageThumbnailKey(item.fileUrl) : item.fileUrl
    const fileName = isImagePreview ? undefined : (item.fileName ?? undefined)
    log.info({ userId, itemId: item.id, itemType: item.itemType.name }, 'signedDownloadUrl')
    return signedDownloadUrlResponse(storageKey, fileName)
  }),
}
