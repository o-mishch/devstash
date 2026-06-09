import type { Readable } from 'stream'
import { lookup as mimeType } from 'mime-types'
import sharp from 'sharp'
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemById } from '@/lib/db/items'
import { downloadFromFilebase } from '@/lib/storage/filebase'
import type { RouteContext } from '@/lib/api'
import { createLogger } from '@/lib/infra/logger'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'

const log = createLogger('download')

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId, isPro }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getItemById(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('File not found.')

  if (!isPro && item.itemType.name === 'file') {
    return ApiResponse.FORBIDDEN('Upgrade to Pro to access this file.')
  }

  if (!item.fileUrl || item.fileUrl.startsWith('http')) return ApiResponse.NOT_FOUND('File not found.')

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

  const webStream = new ReadableStream({
    start(controller) {
      readable.on('data', (chunk: Buffer) => controller.enqueue(chunk))
      readable.on('end', () => controller.close())
      readable.on('error', (err: Error) => controller.error(err))
    },
    cancel() {
      readable.destroy()
    },
  })

  const fileName = item.fileName ?? 'download'
  const contentType = mimeType(fileName) || 'application/octet-stream'
  const disposition = contentType.startsWith('image/') ? 'inline' : 'attachment'

  const cacheControl = !isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)
    ? 'private, no-cache, no-store, must-revalidate'
    : 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'

  return new Response(webStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': cacheControl,
    },
  })
})
