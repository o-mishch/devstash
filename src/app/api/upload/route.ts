import crypto from 'crypto'
import { lookup as mimeType } from 'mime-types'
import { auth } from '@/auth'
import { ApiResponse, apiRoute } from '@/lib/api'
import { uploadToFilebase, deleteFromFilebase } from '@/lib/filebase'
import { ALLOWED_IMAGE_EXTS, ALLOWED_FILE_EXTS, IMAGE_MAX_BYTES, FILE_MAX_BYTES } from '@/lib/utils/constants'

interface UploadResult {
  fileUrl: string
  fileName: string
  fileSize: number
}

export const POST = apiRoute(async (request) => {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const formData = await request.formData()
  const file = formData.get('file')
  const itemType = formData.get('itemType')

  if (!(file instanceof File)) return ApiResponse.BAD_REQUEST('No file provided.')
  if (typeof itemType !== 'string') return ApiResponse.BAD_REQUEST('itemType is required.')

  const isImage = itemType === 'image'
  const allowedExts = isImage ? ALLOWED_IMAGE_EXTS : ALLOWED_FILE_EXTS
  const maxBytes = isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!allowedExts.has(ext)) {
    return ApiResponse.BAD_REQUEST(`File extension ".${ext}" is not allowed for ${itemType} type.`)
  }

  const resolvedContentType = mimeType(file.name) || file.type || 'application/octet-stream'
  const key = `${session.user.id}/${crypto.randomUUID()}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (buffer.length > maxBytes) {
    const maxMb = maxBytes / 1024 / 1024
    return ApiResponse.BAD_REQUEST(`File exceeds the ${maxMb}MB limit.`)
  }

  await uploadToFilebase(key, buffer, resolvedContentType)

  return ApiResponse.CREATED<UploadResult>({
    fileUrl: key,
    fileName: file.name,
    fileSize: buffer.length,
  })
})

export const DELETE = apiRoute(async (request) => {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key) return ApiResponse.BAD_REQUEST('Missing key.')

  // Only allow deleting keys that belong to this user
  if (!key.startsWith(`${session.user.id}/`)) return ApiResponse.FORBIDDEN('Access denied.')

  await deleteFromFilebase(key)

  return ApiResponse.OK()
})
