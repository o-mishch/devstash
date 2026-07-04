import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/infra/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/infra/redis')>()
  return { ...actual, getRedis: vi.fn() }
})

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: vi.fn() },
}))

import { makeRedisCache } from './redis-cache'
import { getRedis } from '@/lib/infra/redis'
import { logger } from '@/lib/infra/pino'

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const mockRedis = { get: vi.fn(), set: vi.fn(), del: vi.fn() }

function makeCache<T = string>(overrides?: Partial<Parameters<typeof makeRedisCache>[0]>) {
  return makeRedisCache<T>({ namespace: 'ns', defaultTtlSeconds: 60, logTag: 't', ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/unbound-method -- mock reference, not a detached call
  vi.mocked(logger.child).mockReturnValue(mockLog as never)
  vi.mocked(getRedis).mockReturnValue(mockRedis as never)
})

describe('read', () => {
  it('returns Redis hit value', async () => {
    const cache = makeCache()
    mockRedis.get.mockResolvedValue('cached')
    expect(await cache.read('k')).toBe('cached')
  })

  it('returns null on Redis miss with no memory entry', async () => {
    const cache = makeCache()
    mockRedis.get.mockResolvedValue(null)
    expect(await cache.read('k')).toBeNull()
  })

  it('returns memory fallback value when Redis misses', async () => {
    const cache = makeCache()
    mockRedis.set.mockResolvedValue('OK')
    await cache.write('k', 'from-mem')
    mockRedis.get.mockResolvedValue(null)
    expect(await cache.read('k')).toBe('from-mem')
  })

  it('returns null for expired memory entry', async () => {
    const cache = makeCache()
    mockRedis.set.mockResolvedValue('OK')
    await cache.write('k', 'stale', -1)
    mockRedis.get.mockResolvedValue(null)
    expect(await cache.read('k')).toBeNull()
  })

  it('warns and falls through on AbortError', async () => {
    const cache = makeCache()
    mockRedis.get.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await expect(cache.read('k')).resolves.toBeNull()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }), 'Cache read timed out')
  })

  it('warns and falls through on TimeoutError', async () => {
    const cache = makeCache()
    mockRedis.get.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
    await expect(cache.read('k')).resolves.toBeNull()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }), 'Cache read timed out')
  })

  it('warns and falls through on generic Redis error', async () => {
    const cache = makeCache()
    mockRedis.get.mockRejectedValue(new Error('connection refused'))
    await expect(cache.read('k')).resolves.toBeNull()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }), 'Cache read failed')
  })
})

describe('write', () => {
  it('calls redis.set with namespaced key and default TTL', async () => {
    const cache = makeCache()
    mockRedis.set.mockResolvedValue('OK')
    await cache.write('k', 'v')
    expect(mockRedis.set).toHaveBeenCalledWith('ns:k', 'v', { ex: 60 })
  })

  it('respects TTL override', async () => {
    const cache = makeCache()
    mockRedis.set.mockResolvedValue('OK')
    await cache.write('k', 'v', 10)
    expect(mockRedis.set).toHaveBeenCalledWith('ns:k', 'v', { ex: 10 })
  })

  it('warns on write AbortError and does not throw', async () => {
    const cache = makeCache()
    mockRedis.set.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
    await expect(cache.write('k', 'v')).resolves.toBeUndefined()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }), 'Cache write timed out')
  })

  it('warns on generic write error and does not throw', async () => {
    const cache = makeCache()
    mockRedis.set.mockRejectedValue(new Error('boom'))
    await expect(cache.write('k', 'v')).resolves.toBeUndefined()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }), 'Cache write failed')
  })
})

describe('invalidate', () => {
  it('calls redis.del with namespaced key', async () => {
    const cache = makeCache()
    mockRedis.del.mockResolvedValue(1)
    await cache.invalidate('k')
    expect(mockRedis.del).toHaveBeenCalledWith('ns:k')
  })

  it('evicts the memory entry so subsequent reads miss', async () => {
    const cache = makeCache()
    mockRedis.set.mockResolvedValue('OK')
    mockRedis.del.mockResolvedValue(1)
    await cache.write('k', 'v')
    await cache.invalidate('k')
    mockRedis.get.mockResolvedValue(null)
    expect(await cache.read('k')).toBeNull()
  })

  it('warns on invalidation timeout and does not throw', async () => {
    const cache = makeCache()
    mockRedis.del.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    await expect(cache.invalidate('k')).resolves.toBeUndefined()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }), 'Cache invalidation timed out')
  })
})

describe('invalidateMany', () => {
  it('invalidates all provided keys', async () => {
    const cache = makeCache()
    mockRedis.del.mockResolvedValue(1)
    await cache.invalidateMany(['a', 'b', 'c'])
    expect(mockRedis.del).toHaveBeenCalledTimes(3)
    expect(mockRedis.del).toHaveBeenCalledWith('ns:a')
    expect(mockRedis.del).toHaveBeenCalledWith('ns:b')
    expect(mockRedis.del).toHaveBeenCalledWith('ns:c')
  })
})

describe('no Redis — memory fallback only', () => {
  beforeEach(() => {
    vi.mocked(getRedis).mockReturnValue(null)
  })

  it('reads value written to memory', async () => {
    const cache = makeCache<number>()
    await cache.write('n', 99)
    expect(await cache.read('n')).toBe(99)
  })

  it('returns null for expired memory entry', async () => {
    const cache = makeCache<number>()
    await cache.write('old', 1, -1)
    expect(await cache.read('old')).toBeNull()
  })
})
