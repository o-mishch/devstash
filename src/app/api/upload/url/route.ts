import { after } from 'next/server'
import { lookup as mimeType } from 'mime-types'
import { authedRoute, rateLimited } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { getUploadUrlInput } from '@/lib/api/schemas/upload'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { getPresignedPutCredential, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import { getImageThumbnailKey, canGenerateImageThumbnail } from '@/lib/storage/image-thumbnails'
import { writePendingUpload, sweepExpiredUploads } from '@/lib/storage/upload-tokens'
import {
  ALLOWED_IMAGE_EXTS,
  ALLOWED_FILE_EXTS,
  IMAGE_MAX_BYTES,
  FILE_MAX_BYTES,
  THUMB_MAX_BYTES,
} from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'
import type { UploadUrlResult } from '@/types/item'

const log = logger.child({ tag: 'upload-url' })

export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(getUploadUrlInput, await request.json())
  if (!parsed.ok) return parsed.res

  // Pro gate before the rate limit so non-Pro callers get 403 without consuming budget.
  if (!isPro) return problem(403, 'Upgrade to Pro to upload files and images.')

  const { success, retryAfter } = await checkRateLimit('uploadUrl', userId)
  if (!success) return rateLimited(retryAfter)

  const { fileName, fileSize, thumbSize } = parsed.data
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

  const isImage = ALLOWED_IMAGE_EXTS.has(ext)
  const isFile = !isImage && ALLOWED_FILE_EXTS.has(ext)
  if (!isImage && !isFile) {
    return problem(400, `File extension ".${ext}" is not allowed.`)
  }

  const maxBytes = isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES
  if (fileSize > maxBytes) {
    return problem(400, `File exceeds the ${maxBytes / 1024 / 1024}MB limit.`)
  }

  const contentType = mimeType(fileName) || 'application/octet-stream'
  const originalKey = `${userId}/${crypto.randomUUID()}.${ext}`
  const original = await getPresignedPutCredential(originalKey, contentType, fileSize)

  // A thumb credential is issued only when the client declares a thumbSize — its exact
  // byte length must be signed into the URL, so we cannot presign a thumb we can't size.
  let thumb = null
  if (isImage && thumbSize && canGenerateImageThumbnail(originalKey)) {
    if (thumbSize > THUMB_MAX_BYTES) {
      return problem(400, `Thumbnail exceeds the ${THUMB_MAX_BYTES / 1024}KB limit.`)
    }
    thumb = await getPresignedPutCredential(getImageThumbnailKey(originalKey), 'image/webp', thumbSize)
  }

  const expiresAt = getSignedUrlExpiresAt().toISOString()
  const uploadResult: UploadUrlResult = { original, thumb, expiresAt }

  try {
    await writePendingUpload(originalKey, { upload: uploadResult, userId, fileName, fileSize })
  } catch (err) {
    log.error({ userId, err }, 'failed to write pending upload')
    return problem(500, 'Upload service temporarily unavailable. Please try again.')
  }

  after(sweepExpiredUploads)
  log.info({ userId, originalKey, isImage }, 'presigned url issued')
  return json(uploadResult)
})
