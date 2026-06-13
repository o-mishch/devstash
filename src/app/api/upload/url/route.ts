import crypto from 'crypto'
import { z } from 'zod'
import { lookup as mimeType } from 'mime-types'
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getPresignedPostCredential, getSignedUploadUrl, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import { getImageThumbnailKey, canGenerateImageThumbnail } from '@/lib/storage/image-thumbnails'
import { ALLOWED_IMAGE_EXTS, ALLOWED_FILE_EXTS, IMAGE_MAX_BYTES, FILE_MAX_BYTES } from '@/lib/utils/constants'
import type { UploadUrlResult } from '@/types/item'

const uploadUrlSchema = z.object({
  fileName: z.string().trim().min(1),
  fileSize: z.number().int().positive(),
  itemType: z.enum(['image', 'file']),
  hasThumb: z.boolean(),
})

export const POST = authenticatedRoute(async (request, _context, { userId, isPro }) => {
  if (!isPro) return ApiResponse.FORBIDDEN('Upgrade to Pro to upload files and images.')

  const body = await request.json() as unknown
  const parsed = uploadUrlSchema.safeParse(body)
  if (!parsed.success) return ApiResponse.VALIDATION_ERROR('Invalid upload request.')

  const { fileName, fileSize, itemType, hasThumb } = parsed.data
  const isImage = itemType === 'image'
  const allowedExts = isImage ? ALLOWED_IMAGE_EXTS : ALLOWED_FILE_EXTS
  const maxBytes = isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES

  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (!allowedExts.has(ext)) {
    return ApiResponse.BAD_REQUEST(`File extension ".${ext}" is not allowed for ${itemType} type.`)
  }

  if (fileSize > maxBytes) {
    const maxMb = maxBytes / 1024 / 1024
    return ApiResponse.BAD_REQUEST(`File exceeds the ${maxMb}MB limit.`)
  }

  const contentType = mimeType(fileName) || 'application/octet-stream'
  const originalKey = `${userId}/${crypto.randomUUID()}.${ext}`
  const original = await getPresignedPostCredential(originalKey, contentType, maxBytes)

  let thumbKey: string | null = null
  let thumbUrl: string | null = null
  if (hasThumb && canGenerateImageThumbnail(originalKey)) {
    thumbKey = getImageThumbnailKey(originalKey)
    thumbUrl = await getSignedUploadUrl(thumbKey, 'image/webp')
  }

  const expiresAt = getSignedUrlExpiresAt().toISOString()

  return ApiResponse.OK<UploadUrlResult>({ originalKey, original, maxBytes, thumbKey, thumbUrl, expiresAt })
})
