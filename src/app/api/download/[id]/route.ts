import type { Readable } from 'stream'
import { lookup as mimeType } from 'mime-types'
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemById } from '@/lib/db/items'
import { downloadFromFilebase } from '@/lib/filebase'
import type { RouteContext } from '@/lib/api'
import { createLogger } from '@/lib/logger'

const log = createLogger('download')

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getItemById(userId, id)
  if (!item || !item.fileUrl) return ApiResponse.NOT_FOUND('File not found.')
  if (item.fileUrl.startsWith('http')) return ApiResponse.NOT_FOUND('File not found.')

  const start = Date.now()
  const nodeStream = await downloadFromFilebase(item.fileUrl)

  if (!nodeStream) {
    log.warn(`filebase fetch failed for item:${item.id} (${Date.now() - start}ms)`)
    return ApiResponse.NOT_FOUND('File could not be retrieved.')
  }

  log.info(`stream ready (${Date.now() - start}ms): ${item.fileUrl}`)

  const readable = nodeStream as Readable

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

  return new Response(webStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
})
