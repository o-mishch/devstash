import { authedRoute } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { deleteUploadQuery } from '@/lib/api/schemas/upload'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { deletePendingUpload } from '@/lib/storage/upload-tokens'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'upload' })

export const DELETE = authedRoute({}, async ({ userId, request }) => {
  const parsed = parseOr422(deleteUploadQuery, Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.ok) return parsed.res

  // Only allow deleting keys that belong to this user (IDOR-safe).
  if (!parsed.data.key.startsWith(`${userId}/`)) return problem(403, 'Access denied.')

  // Remove the S3 object (+ thumbnail) and drop the matching pending_upload:* Redis token.
  await deleteStoredFile(parsed.data.key)
  await deletePendingUpload(parsed.data.key)
  log.info({ userId, key: parsed.data.key }, 'deleteUpload')
  return noContent()
})
