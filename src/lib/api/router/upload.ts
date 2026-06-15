import 'server-only'
import { after } from 'next/server'
import { lookup as mimeType } from 'mime-types'
import { ORPCError } from '@orpc/server'
import { authed } from '../orpc'
import { enforceRateLimit } from '../middleware'
import { getPresignedPostCredential, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import { getImageThumbnailKey, canGenerateImageThumbnail, deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { writePendingUpload, sweepExpiredUploads } from '@/lib/storage/upload-tokens'
import { ALLOWED_IMAGE_EXTS, ALLOWED_FILE_EXTS, IMAGE_MAX_BYTES, FILE_MAX_BYTES, THUMB_MAX_BYTES } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'
import type { UploadUrlResult } from '@/types/item'

const log = logger.child({ tag: 'upload-url' })

export const uploadRouter = {
  getUploadUrl: authed.upload.getUploadUrl.handler(async ({ input, context }) => {
    const { userId, isPro } = context
    if (!isPro) throw new ORPCError('FORBIDDEN', { message: 'Upgrade to Pro to upload files and images.' })

    await enforceRateLimit('uploadUrl', userId, context.resHeaders)

    const { fileName, fileSize } = input
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

    const isImage = ALLOWED_IMAGE_EXTS.has(ext)
    const isFile = !isImage && ALLOWED_FILE_EXTS.has(ext)
    if (!isImage && !isFile) {
      throw new ORPCError('BAD_REQUEST', { message: `File extension ".${ext}" is not allowed.` })
    }

    const maxBytes = isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES
    if (fileSize > maxBytes) {
      throw new ORPCError('BAD_REQUEST', { message: `File exceeds the ${maxBytes / 1024 / 1024}MB limit.` })
    }

    const contentType = mimeType(fileName) || 'application/octet-stream'
    const originalKey = `${userId}/${crypto.randomUUID()}.${ext}`
    const original = await getPresignedPostCredential(originalKey, contentType, maxBytes)

    let thumb = null
    if (isImage && canGenerateImageThumbnail(originalKey)) {
      thumb = await getPresignedPostCredential(getImageThumbnailKey(originalKey), 'image/webp', THUMB_MAX_BYTES)
    }

    const expiresAt = getSignedUrlExpiresAt().toISOString()
    const uploadResult: UploadUrlResult = { original, thumb, expiresAt }

    try {
      await writePendingUpload(originalKey, { upload: uploadResult, userId, fileName, fileSize })
    } catch (err) {
      log.error({ userId, err }, 'failed to write pending upload')
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Upload service temporarily unavailable. Please try again.' })
    }

    after(sweepExpiredUploads)
    log.info({ userId, originalKey, isImage }, 'presigned url issued')
    return uploadResult
  }),

  deleteUpload: authed.upload.deleteUpload.handler(async ({ input, context }) => {
    const { userId } = context
    // Only allow deleting keys that belong to this user.
    if (!input.key.startsWith(`${userId}/`)) throw new ORPCError('FORBIDDEN', { message: 'Access denied.' })
    await deleteStoredFile(input.key)
  }),
}
