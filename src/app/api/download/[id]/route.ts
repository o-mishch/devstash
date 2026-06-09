import type { Readable } from 'stream'
import { lookup as mimeType } from 'mime-types'
import sharp from 'sharp'
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemById } from '@/lib/db/items'
import { downloadFromFilebase } from '@/lib/storage/filebase'
import { buildImagePreviewStream } from '@/lib/storage/image-thumbnails'
import type { RouteContext } from '@/lib/api'
import { createLogger } from '@/lib/infra/logger'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'

const log = createLogger('download')

function isPreviewRequest(request: Request): boolean {
  return new URL(request.url).searchParams.get('preview') === '1'
}

function getCacheControl(isPro: boolean, itemTypeName: string): string {
  return !isPro && PRO_ITEM_TYPE_NAMES.has(itemTypeName)
    ? 'private, no-cache, no-store, must-revalidate'
    : 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
}

function readableToWebStream(readable: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      readable.on('data', (chunk: Buffer) => controller.enqueue(chunk))
      readable.on('end', () => controller.close())
      readable.on('error', (err: Error) => controller.error(err))
    },
    cancel() {
      readable.destroy()
    },
  })
}

function streamFileResponse(
  readable: Readable,
  contentType: string,
  fileName: string,
  cacheControl: string,
): Response {
  const disposition = contentType.startsWith('image/') ? 'inline' : 'attachment'

  return new Response(readableToWebStream(readable), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': cacheControl,
    },
  })
}

export const GET = authenticatedRoute(async (request, context: RouteContext, { userId, isPro }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getItemById(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('File not found.')

  if (!isPro && item.itemType.name === 'file') {
    return ApiResponse.FORBIDDEN('Upgrade to Pro to access this file.')
  }

  if (!item.fileUrl || item.fileUrl.startsWith('http')) return ApiResponse.NOT_FOUND('File not found.')

  const cacheControl = getCacheControl(isPro, item.itemType.name)
  const fileName = item.fileName ?? 'download'

  if (isPreviewRequest(request) && item.itemType.name === 'image') {
    const start = Date.now()
    const preview = await buildImagePreviewStream(item.fileUrl)

    if (!preview) {
      log.warn(`preview fetch failed for item:${item.id} (${Date.now() - start}ms)`)
      return ApiResponse.NOT_FOUND('File could not be retrieved.')
    }

    log.info(`preview stream ready (${Date.now() - start}ms): ${item.fileUrl}`)

    let readable = preview.readable
    if (!isPro) {
      log.info('Applying sharp blur to image preview stream')
      readable = readable.pipe(sharp().blur(5))
    }

    return streamFileResponse(readable, preview.contentType, fileName, cacheControl)
  }

  const start = Date.now()
  const nodeStream = await downloadFromFilebase(item.fileUrl)

  if (!nodeStream) {
    log.warn(`filebase fetch failed for item:${item.id} (${Date.now() - start}ms)`)
    return ApiResponse.NOT_FOUND('File could not be retrieved.')
  }

  log.info(`stream ready (${Date.now() - start}ms): ${item.fileUrl}`)

  let readable = nodeStream as Readable

  if (!isPro && item.itemType.name === 'image') {
    log.info('Applying sharp blur to image stream')
    readable = readable.pipe(sharp().blur(5))
  }

  const contentType = mimeType(fileName) || 'application/octet-stream'

  return streamFileResponse(readable, contentType, fileName, cacheControl)
})
