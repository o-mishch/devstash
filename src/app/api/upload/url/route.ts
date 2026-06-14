import 'server-only'

import { after } from 'next/server'
import { z } from 'zod'
import { lookup as mimeType } from 'mime-types'
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getPresignedPostCredential, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import { getImageThumbnailKey, canGenerateImageThumbnail } from '@/lib/storage/image-thumbnails'
import { writePendingUpload, sweepExpiredUploads } from '@/lib/storage/upload-tokens'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { ALLOWED_IMAGE_EXTS, ALLOWED_FILE_EXTS, IMAGE_MAX_BYTES, FILE_MAX_BYTES, THUMB_MAX_BYTES } from '@/lib/utils/constants'
import { createLogger } from '@/lib/infra/logger'
import type { UploadUrlResult } from '@/types/item'

const log = createLogger('upload-url')

const uploadUrlSchema = z.object({
  fileName: z.string().trim().min(1),
  fileSize: z.number().int().positive(),
})

export const POST = authenticatedRoute(async (request, _context, { userId, isPro }) => {
  if (!isPro) return ApiResponse.FORBIDDEN('Upgrade to Pro to upload files and images.')

  const rateLimit = await rateLimitRoute('uploadUrl', userId)
  if (rateLimit) return rateLimit

  const body = await request.json() as unknown
  const parsed = uploadUrlSchema.safeParse(body)
  if (!parsed.success) return ApiResponse.VALIDATION_ERROR('Invalid upload request.')

  const { fileName, fileSize } = parsed.data
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

  const isImage = ALLOWED_IMAGE_EXTS.has(ext)
  const isFile = !isImage && ALLOWED_FILE_EXTS.has(ext)
  if (!isImage && !isFile) {
    return ApiResponse.BAD_REQUEST(`File extension ".${ext}" is not allowed.`)
  }

  const maxBytes = isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES
  if (fileSize > maxBytes) {
    const maxMb = maxBytes / 1024 / 1024
    return ApiResponse.BAD_REQUEST(`File exceeds the ${maxMb}MB limit.`)
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
    log.error('failed to write pending upload', { userId, err })
    return ApiResponse.INTERNAL_ERROR('Upload service temporarily unavailable. Please try again.')
  }

  after(sweepExpiredUploads)
  log.info('presigned url issued', { userId, originalKey, isImage })
  return ApiResponse.OK<UploadUrlResult>(uploadResult)
})
