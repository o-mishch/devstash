import type { Readable } from 'stream'
import { lookup as mimeType } from 'mime-types'
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemById } from '@/lib/db/items'
import { downloadFromFilebase } from '@/lib/filebase'
import type { RouteContext } from '@/lib/api'

export const GET = authenticatedRoute(async (_request, context: RouteContext, userId) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getItemById(userId, id)
  if (!item || !item.fileUrl) return ApiResponse.NOT_FOUND('File not found.')

  const start = Date.now()
  console.log(`⏳ FETCHING from Filebase (S3): ${item.fileUrl} for item ${item.id}`)
  
  const nodeStream = await downloadFromFilebase(item.fileUrl)
  
  if (!nodeStream) {
    console.log(`❌ FAILED to fetch from Filebase in ${Date.now() - start}ms: ${item.fileUrl}`)
    return ApiResponse.NOT_FOUND('File could not be retrieved.')
  }
  
  console.log(`✅ FETCHED stream from Filebase in ${Date.now() - start}ms: ${item.fileUrl}`)

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
      'Cache-Control': 'private, max-age=3600',
    },
  })
})
