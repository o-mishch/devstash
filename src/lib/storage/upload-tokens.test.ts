import { vi, describe, it, expect, beforeEach } from 'vitest'

import { anyOf } from '@/test/matchers'

vi.mock('@/lib/infra/redis', () => ({
  getRedis: vi.fn<typeof getRedis>(),
}))

vi.mock('@/lib/storage/s3', () => ({
  deleteFromS3: vi.fn<typeof deleteFromS3>(),
  SIGNED_URL_TTL_SECONDS: 900,
}))

import { getRedis } from '@/lib/infra/redis'
import { deleteFromS3 } from '@/lib/storage/s3'
import { writePendingUpload, consumePendingUpload, sweepExpiredUploads } from './upload-tokens'

const mockGetRedis = vi.mocked(getRedis)
const mockDeleteFromS3 = vi.mocked(deleteFromS3)

// Locally-shaped stand-ins for the @upstash/redis client methods used by upload-tokens.ts —
// there is no single named export to `typeof` against, so these mirror the call signatures
// actually exercised in src/lib/storage/upload-tokens.ts.
type RedisKeyGetFn = (key: string) => Promise<unknown>
type RedisSetFn = (key: string, value: unknown, opts: { ex: number }) => Promise<string>
type RedisDelFn = (key: string) => Promise<number>
type RedisScanFn = (cursor: number, opts: { match: string; count: number }) => Promise<[number, string[]]>

// @upstash/redis's Redis class declares protected members, so no object literal can ever
// structurally satisfy it — `as never` is the only way to hand getRedis()'s mock a fake client.
function stubRedis(redis: ReturnType<typeof makeRedis> | null) {
  mockGetRedis.mockReturnValue(redis as never)
}

const FILE_KEY = 'user-1/uuid.png'
const REDIS_KEY = `pending_upload:${FILE_KEY}`
const USER_ID = 'user-1'
const FUTURE = new Date(Date.now() + 900_000).toISOString()
const PAST = new Date(Date.now() - 1_000).toISOString()

const mockOriginal = {
  url: 'https://s3.example/upload',
  key: FILE_KEY,
  contentType: 'image/png',
}
const mockThumb = {
  url: 'https://s3.example/upload',
  key: 'user-1/uuid-thumb.webp',
  contentType: 'image/webp',
}

interface MakeEntryOptions {
  expiresAt?: string
  userId?: string
  thumb?: typeof mockThumb | null
}

function makeEntry(options: MakeEntryOptions = {}) {
  const { expiresAt = FUTURE, userId = USER_ID, thumb = mockThumb } = options
  return {
    result: { original: mockOriginal, thumb, expiresAt },
    userId,
    fileName: 'photo.png',
    fileSize: 204800,
  }
}

function makeRedis(overrides: Record<string, unknown> = {}) {
  return {
    set: vi.fn<RedisSetFn>().mockResolvedValue('OK'),
    get: vi.fn<RedisKeyGetFn>().mockResolvedValue(null),
    getdel: vi.fn<RedisKeyGetFn>().mockResolvedValue(null),
    del: vi.fn<RedisDelFn>().mockResolvedValue(1),
    scan: vi.fn<RedisScanFn>().mockResolvedValue([0, []]),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDeleteFromS3.mockResolvedValue(undefined)
})

describe('writePendingUpload', () => {
  it('writes a per-key entry with TTL > SIGNED_URL_TTL_SECONDS', async () => {
    const redis = makeRedis()
    stubRedis(redis)

    await writePendingUpload(FILE_KEY, {
      upload: { original: mockOriginal, thumb: null, expiresAt: FUTURE },
      userId: USER_ID,
      fileName: 'photo.png',
      fileSize: 204800,
    })

    expect(redis.set).toHaveBeenCalledOnce()
    const [key, value, opts] = redis.set.mock.calls[0] as [string, object, { ex: number }]
    expect(key).toBe(REDIS_KEY)
    expect(value).toMatchObject({ userId: USER_ID, fileName: 'photo.png', fileSize: 204800 })
    expect(opts.ex).toBeGreaterThan(900)
  })

  it('throws when Redis is unavailable', async () => {
    stubRedis(null)
    await expect(
      writePendingUpload(FILE_KEY, { upload: { original: mockOriginal, thumb: null, expiresAt: FUTURE }, userId: USER_ID, fileName: 'photo.png', fileSize: 1024 })
    ).rejects.toThrow('Redis unavailable')
  })
})

describe('consumePendingUpload', () => {
  it('returns unavailable when Redis is null', async () => {
    stubRedis(null)
    expect(await consumePendingUpload(FILE_KEY, USER_ID)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('returns not_found when key does not exist (GETDEL returns null)', async () => {
    stubRedis(makeRedis())
    expect(await consumePendingUpload(FILE_KEY, USER_ID)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_found when stored value is corrupt', async () => {
    const redis = makeRedis({ get: vi.fn<RedisKeyGetFn>().mockResolvedValue({ invalid: true }) })
    stubRedis(redis)
    expect(await consumePendingUpload(FILE_KEY, USER_ID)).toEqual({ ok: false, reason: 'not_found' })
    expect(redis.getdel).not.toHaveBeenCalled()
  })

  it('returns unauthorized when userId does not match', async () => {
    const raw = makeEntry({ userId: 'other-user' })
    const redis = makeRedis({ get: vi.fn<RedisKeyGetFn>().mockResolvedValue(raw) })
    stubRedis(redis)
    const result = await consumePendingUpload(FILE_KEY, USER_ID)
    expect(result).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it('consumes and returns metadata including thumbKey on success', async () => {
    const raw = makeEntry()
    const redis = makeRedis({ get: vi.fn<RedisKeyGetFn>().mockResolvedValue(raw), getdel: vi.fn<RedisKeyGetFn>().mockResolvedValue(raw) })
    stubRedis(redis)
    const result = await consumePendingUpload(FILE_KEY, USER_ID)
    expect(result).toEqual({ ok: true, data: { fileName: 'photo.png', fileSize: 204800, thumbKey: 'user-1/uuid-thumb.webp' } })
    expect(redis.getdel).toHaveBeenCalledWith(REDIS_KEY)
  })

  it('returns thumbKey as null when no thumb exists', async () => {
    const raw = makeEntry({ thumb: null })
    const redis = makeRedis({ get: vi.fn<RedisKeyGetFn>().mockResolvedValue(raw), getdel: vi.fn<RedisKeyGetFn>().mockResolvedValue(raw) })
    stubRedis(redis)
    const result = await consumePendingUpload(FILE_KEY, USER_ID)
    expect(result).toEqual({ ok: true, data: { fileName: 'photo.png', fileSize: 204800, thumbKey: null } })
  })

  it('returns not_found when token is consumed concurrently between get and getdel', async () => {
    const raw = makeEntry()
    const redis = makeRedis({ get: vi.fn<RedisKeyGetFn>().mockResolvedValue(raw), getdel: vi.fn<RedisKeyGetFn>().mockResolvedValue(null) })
    stubRedis(redis)
    expect(await consumePendingUpload(FILE_KEY, USER_ID)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns unavailable on unexpected Redis error', async () => {
    const redis = makeRedis({ get: vi.fn<RedisKeyGetFn>().mockRejectedValue(new Error('connection reset')) })
    stubRedis(redis)
    expect(await consumePendingUpload(FILE_KEY, USER_ID)).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('sweepExpiredUploads', () => {
  it('does nothing when Redis is unavailable', async () => {
    stubRedis(null)
    await sweepExpiredUploads()
    expect(mockDeleteFromS3).not.toHaveBeenCalled()
  })

  it('does nothing when no matching keys exist', async () => {
    stubRedis(makeRedis())
    await sweepExpiredUploads()
    expect(mockDeleteFromS3).not.toHaveBeenCalled()
  })

  it('skips active entries whose presign window has not expired', async () => {
    const redis = makeRedis({
      scan: vi.fn<RedisScanFn>().mockResolvedValue([0, [REDIS_KEY]]),
      get: vi.fn<RedisKeyGetFn>().mockResolvedValue(makeEntry()),
    })
    stubRedis(redis)
    await sweepExpiredUploads()
    expect(mockDeleteFromS3).not.toHaveBeenCalled()
    expect(redis.del).not.toHaveBeenCalled()
  })

  it('deletes S3 original + thumb and removes Redis key for expired entries', async () => {
    const redis = makeRedis({
      scan: vi.fn<RedisScanFn>().mockResolvedValue([0, [REDIS_KEY]]),
      get: vi.fn<RedisKeyGetFn>().mockResolvedValue(makeEntry({ expiresAt: PAST })),
    })
    stubRedis(redis)
    await sweepExpiredUploads()
    expect(mockDeleteFromS3).toHaveBeenCalledWith(FILE_KEY)
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/uuid-thumb.webp')
    expect(redis.del).toHaveBeenCalledWith(REDIS_KEY)
  })

  it('skips thumb deletion when no thumb exists', async () => {
    const redis = makeRedis({
      scan: vi.fn<RedisScanFn>().mockResolvedValue([0, [REDIS_KEY]]),
      get: vi.fn<RedisKeyGetFn>().mockResolvedValue(makeEntry({ expiresAt: PAST, thumb: null })),
    })
    stubRedis(redis)
    await sweepExpiredUploads()
    expect(mockDeleteFromS3).toHaveBeenCalledTimes(1)
    expect(mockDeleteFromS3).toHaveBeenCalledWith(FILE_KEY)
  })

  it('DELs corrupt entries without touching S3', async () => {
    const redis = makeRedis({
      scan: vi.fn<RedisScanFn>().mockResolvedValue([0, [REDIS_KEY]]),
      get: vi.fn<RedisKeyGetFn>().mockResolvedValue({ invalid: true }),
    })
    stubRedis(redis)
    await sweepExpiredUploads()
    expect(mockDeleteFromS3).not.toHaveBeenCalled()
    expect(redis.del).toHaveBeenCalledWith(REDIS_KEY)
  })

  it('continues processing remaining entries when one entry throws', async () => {
    const key2 = 'pending_upload:user-1/good.png'
    const redis = makeRedis({
      scan: vi.fn<RedisScanFn>().mockResolvedValue([0, [REDIS_KEY, key2]]),
      get: vi.fn<RedisKeyGetFn>()
        .mockRejectedValueOnce(new Error('redis timeout'))
        .mockResolvedValueOnce(makeEntry({ expiresAt: PAST })),
    })
    stubRedis(redis)
    await sweepExpiredUploads()
    // S3 key is derived from the Redis key prefix, not the stored entry fields
    expect(mockDeleteFromS3).toHaveBeenCalledWith('user-1/good.png')
    expect(redis.del).toHaveBeenCalledWith(key2)
    expect(redis.del).not.toHaveBeenCalledWith(REDIS_KEY)
  })

  it('paginates through all SCAN pages until cursor returns 0', async () => {
    const redis = makeRedis({
      scan: vi.fn<RedisScanFn>()
        .mockResolvedValueOnce([42, ['pending_upload:user-1/a.png']])
        .mockResolvedValueOnce([0, ['pending_upload:user-1/b.png']]),
      get: vi.fn<RedisKeyGetFn>().mockResolvedValue(makeEntry()), // active — not swept
    })
    stubRedis(redis)
    await sweepExpiredUploads()
    expect(redis.scan).toHaveBeenCalledTimes(2)
    expect(redis.scan).toHaveBeenNthCalledWith(1, 0, expect.objectContaining({ match: 'pending_upload:*' }))
    expect(redis.scan).toHaveBeenNthCalledWith(2, 42, anyOf(Object))
  })
})
