import 'server-only'
import { z } from 'zod'
import { getRedis } from '@/lib/infra/redis'
import { deleteFromS3, SIGNED_URL_TTL_SECONDS } from '@/lib/storage/s3'
import { logger } from '@/lib/infra/pino'
import { uploadUrlResultSchema } from '@/lib/api/schemas/upload'
import type { UploadUrlResult } from '@/types/item'

const log = logger.child({ tag: 'upload-tokens' })

const KEY_PREFIX = 'pending_upload:'
// Keep entry alive past the presign window so background sweeps can reclaim S3 orphans
const SWEEP_GRACE_SECONDS = 3600
const REDIS_TTL_SECONDS = SIGNED_URL_TTL_SECONDS + SWEEP_GRACE_SECONDS

// Reuse the same credential schema the route returns (PresignedPutCredential, incl. `key`) so
// the stored token shape can never silently drift from what /upload/url writes.
const storedUploadSchema = z.object({
  result: uploadUrlResultSchema,
  userId: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
})

type StoredUpload = z.infer<typeof storedUploadSchema>

function tokenKey(fileKey: string): string {
  return `${KEY_PREFIX}${fileKey}`
}

function tryValidateStoredUpload(raw: unknown): StoredUpload | null {
  try {
    return storedUploadSchema.parse(raw)
  } catch (err) {
    log.warn({ err, raw }, 'upload token parse failed')
    return null
  }
}

interface WritePendingUploadParams {
  upload: UploadUrlResult
  userId: string
  fileName: string
  fileSize: number
}

export interface ConsumedUpload {
  fileName: string
  fileSize: number
  thumbKey: string | null
}

export type ConsumeResult =
  | { ok: true; data: ConsumedUpload }
  | { ok: false; reason: 'not_found' | 'unauthorized' | 'unavailable' }

/** Stores upload credential + ownership metadata as a per-key Redis entry with TTL. */
export async function writePendingUpload(fileKey: string, params: WritePendingUploadParams): Promise<void> {
  const redis = getRedis()
  if (!redis) throw new Error('Redis unavailable')
  const entry: StoredUpload = {
    result: params.upload,
    userId: params.userId,
    fileName: params.fileName,
    fileSize: params.fileSize,
  }
  await redis.set(tokenKey(fileKey), entry, { ex: REDIS_TTL_SECONDS })
}

/** Validates ownership then consumes the upload token via GETDEL — single-use. */
export async function consumePendingUpload(fileKey: string, userId: string): Promise<ConsumeResult> {
  try {
    const redis = getRedis()
    if (!redis) return { ok: false, reason: 'unavailable' }

    const raw = await redis.get<StoredUpload>(tokenKey(fileKey))
    if (!raw) return { ok: false, reason: 'not_found' }

    const entry = tryValidateStoredUpload(raw)
    if (!entry) return { ok: false, reason: 'not_found' }

    if (entry.userId !== userId) return { ok: false, reason: 'unauthorized' }

    const consumed = await redis.getdel<StoredUpload>(tokenKey(fileKey))
    if (!consumed) return { ok: false, reason: 'not_found' }

    return {
      ok: true,
      data: {
        fileName: entry.fileName,
        fileSize: entry.fileSize,
        thumbKey: entry.result.thumb?.key ?? null,
      },
    }
  } catch (err) {
    log.warn({ fileKey, userId, err }, 'failed to consume pending upload')
    return { ok: false, reason: 'unavailable' }
  }
}

/** Removes the pending upload token for a file key — best-effort cleanup on the cancel/delete path. */
export async function deletePendingUpload(fileKey: string): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.del(tokenKey(fileKey))
  } catch (err) {
    log.warn({ fileKey, err }, 'failed to delete pending upload')
  }
}

/** Scans for expired pending upload entries and deletes their S3 objects + Redis keys. */
export async function sweepExpiredUploads(): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return

    const now = Date.now()
    let cursor = 0
    let swept = 0

    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: `${KEY_PREFIX}*`, count: 100 })
      cursor = Number(nextCursor)

      for (const key of keys) {
        try {
          const raw = await redis.get<StoredUpload>(key)
          if (!raw) continue

          const entry = tryValidateStoredUpload(raw)
          if (!entry) {
            // Corrupt entry — remove without touching S3
            await redis.del(key)
            continue
          }

          if (new Date(entry.result.expiresAt).getTime() >= now) continue

          // Presign window closed — delete S3 objects then the Redis key
          await deleteFromS3(key.slice(KEY_PREFIX.length))
          const thumbKey = entry.result.thumb?.key
          if (thumbKey) await deleteFromS3(thumbKey)
          await redis.del(key)
          swept++
        } catch (err) {
          log.warn({ key, err }, 'sweep: failed to process entry')
        }
      }
    } while (cursor !== 0)

    if (swept > 0) log.info({ swept }, 'sweep complete')
  } catch (err) {
    log.error({ err }, 'sweep failed')
  }
}
