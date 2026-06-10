import { Readable } from 'stream'
import { lookup as mimeType } from 'mime-types'
import { ApiResponse, apiRedirect, authenticatedRoute } from '@/lib/api'
import { getDownloadItem } from '@/lib/db/items'
import { downloadFromFilebase, getSignedDownloadUrl } from '@/lib/storage/filebase'
import { canGenerateImageThumbnail, getImageThumbnailKey } from '@/lib/storage/image-thumbnails'
import type { RouteContext } from '@/lib/api'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('download')

function encodeContentDisposition(fileName: string): string {
  const fallbackName = fileName.replace(/[^\x20-\x7E]|["\\]/g, '_')
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export const GET = authenticatedRoute(async (request, context: RouteContext, { userId, isPro }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getDownloadItem(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('File not found.')

  const preview = new URL(request.url).searchParams.get('preview') === '1'
  if (!isPro && item.itemType.name === 'file') {
    return ApiResponse.FORBIDDEN('Upgrade to Pro to access this file.')
  }
  if (!isPro && item.itemType.name === 'image' && !preview) {
    return ApiResponse.FORBIDDEN('Upgrade to Pro to access this image.')
  }

  if (!item.fileUrl || item.fileUrl.startsWith('http')) return ApiResponse.NOT_FOUND('File not found.')

  const isImagePreview = preview && item.itemType.name === 'image'
  const storageKey = isImagePreview && canGenerateImageThumbnail(item.fileUrl)
    ? getImageThumbnailKey(item.fileUrl)
    : item.fileUrl

  if (preview) {
    const signedUrl = await getSignedDownloadUrl(storageKey)
    log.info(`preview redirect issued: item:${item.id}`)
    return apiRedirect(signedUrl)
  }

  const fileStream = await downloadFromFilebase(storageKey)
  if (!fileStream) return ApiResponse.NOT_FOUND('File not found.')

  const fileName = item.fileName ?? item.id
  const contentType = mimeType(fileName) || 'application/octet-stream'
  log.info(`attachment response issued: item:${item.id}`)

  return new Response(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Disposition': encodeContentDisposition(fileName),
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
    },
  })
})
