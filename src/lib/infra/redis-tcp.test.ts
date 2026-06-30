import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fake ioredis: records command args and returns canned values. Declared via
// vi.hoisted so the class exists before the hoisted vi.mock factory runs.
const { calls, getLastOpts, FakeRedis } = vi.hoisted(() => {
  const calls = {
    get: vi.fn(),
    set: vi.fn(),
    getdel: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    eval: vi.fn(),
  }
  let lastOpts: Record<string, unknown> | null = null
  class FakeRedis {
    constructor(
      public url: string,
      public opts: Record<string, unknown>,
    ) {
      lastOpts = opts
    }
    on = vi.fn()
    quit = vi.fn().mockResolvedValue('OK')
    get = calls.get
    set = calls.set
    getdel = calls.getdel
    del = calls.del
    incr = calls.incr
    expire = calls.expire
    eval = calls.eval
  }
  return { calls, getLastOpts: () => lastOpts, FakeRedis }
})

vi.mock('ioredis', () => ({ default: FakeRedis }))

import { getTcpRedis, resetTcpRedisForTests } from '@/lib/infra/redis-tcp'

describe('redis-tcp adapter (ioredis → Upstash surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('REDIS_URL', 'rediss://default:token@localhost:6379')
    resetTcpRedisForTests()
  })

  afterEach(() => {
    resetTcpRedisForTests()
    vi.unstubAllEnvs()
  })

  it('serializes objects to JSON on set and parses them back on get', async () => {
    const redis = getTcpRedis()
    calls.set.mockResolvedValue('OK')
    await redis.set('k', { a: 1, b: 'x' })
    expect(calls.set).toHaveBeenCalledWith('k', '{"a":1,"b":"x"}')

    calls.get.mockResolvedValue('{"a":1,"b":"x"}')
    expect(await redis.get('k')).toEqual({ a: 1, b: 'x' })
  })

  it('stores plain strings raw and returns non-JSON strings unparsed', async () => {
    const redis = getTcpRedis()
    calls.set.mockResolvedValue('OK')
    await redis.set('k', 'hello')
    expect(calls.set).toHaveBeenCalledWith('k', 'hello')

    calls.get.mockResolvedValue('hello')
    expect(await redis.get('k')).toBe('hello')
  })

  it('returns null for a missing key', async () => {
    const redis = getTcpRedis()
    calls.get.mockResolvedValue(null)
    expect(await redis.get('missing')).toBeNull()
  })

  it('maps {ex} and {nx} options to ioredis variadic args', async () => {
    const redis = getTcpRedis()
    calls.set.mockResolvedValue('OK')
    await redis.set('k', '1', { ex: 30 })
    expect(calls.set).toHaveBeenCalledWith('k', '1', 'EX', 30)

    await redis.set('k', '1', { nx: true })
    expect(calls.set).toHaveBeenCalledWith('k', '1', 'NX')

    await redis.set('lock', '1', { nx: true, ex: 60 })
    expect(calls.set).toHaveBeenCalledWith('lock', '1', 'EX', 60, 'NX')
  })

  it('getdel parses the consumed value', async () => {
    const redis = getTcpRedis()
    calls.getdel.mockResolvedValue('{"used":true}')
    expect(await redis.getdel('tok')).toEqual({ used: true })
  })

  it('eval flattens (script, keys, args) into ioredis (script, numkeys, ...keys, ...args)', async () => {
    const redis = getTcpRedis()
    calls.eval.mockResolvedValue(1)
    await redis.eval('SCRIPT', ['k1', 'k2'], [5, 'arg'])
    expect(calls.eval).toHaveBeenCalledWith('SCRIPT', 2, 'k1', 'k2', 5, 'arg')
  })

  it('passes the CA cert into tls options and skips hostname identity when REDIS_CA_CERT is set', () => {
    vi.stubEnv('REDIS_CA_CERT', '-----BEGIN CERT-----')
    resetTcpRedisForTests()
    getTcpRedis()
    const tls = getLastOpts()?.tls as
      | { ca?: string; checkServerIdentity?: (host: string, cert: never) => undefined }
      | undefined
    // verify-CA, not verify-full: chain is verified against the CA, but the hostname
    // identity check is skipped because we dial Memorystore by private IP, not its cert CN.
    expect(tls?.ca).toBe('-----BEGIN CERT-----')
    expect(typeof tls?.checkServerIdentity).toBe('function')
    expect(tls?.checkServerIdentity?.('10.0.0.1', {} as never)).toBeUndefined()
  })
})
