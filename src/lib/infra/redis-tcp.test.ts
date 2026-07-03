import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fake node-redis client: records the createClient() options + command args and returns
// canned values. connect() mirrors node-redis by invoking the credentialsProvider so the IAM
// wiring is exercised end-to-end. Declared via vi.hoisted so it exists before vi.mock runs.
const { calls, getLastOpts, getLastCredentials, createClient } = vi.hoisted(() => {
  const calls = {
    get: vi.fn(),
    set: vi.fn(),
    getDel: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    decr: vi.fn(),
    scan: vi.fn(),
    expire: vi.fn(),
    eval: vi.fn(),
    ping: vi.fn(),
  }
  let lastOpts: Record<string, unknown> | null = null
  let lastCredentials: { username?: string; password?: string } | null = null
  const createClient = vi.fn((opts: Record<string, unknown>) => {
    lastOpts = opts
    const client = {
      isOpen: false,
      options: opts,
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
      async connect() {
        // node-redis calls the provider's credentials() on connect to obtain AUTH creds.
        const provider = opts.credentialsProvider as
          | { credentials: () => Promise<{ username?: string; password?: string }> }
          | undefined
        if (provider) lastCredentials = await provider.credentials()
        this.isOpen = true
        return this
      },
      get: calls.get,
      set: calls.set,
      getDel: calls.getDel,
      del: calls.del,
      incr: calls.incr,
      decr: calls.decr,
      scan: calls.scan,
      expire: calls.expire,
      eval: calls.eval,
      ping: calls.ping,
    }
    return client
  })
  return { calls, getLastOpts: () => lastOpts, getLastCredentials: () => lastCredentials, createClient }
})

vi.mock('redis', () => ({ createClient }))

// Fake google-auth-library: redis-tcp dynamically imports it only on the IAM path.
const getAccessToken = vi.hoisted(() => vi.fn())
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getAccessToken = getAccessToken
  },
}))

import { getTcpRedis, resetTcpRedisForTests } from '@/lib/infra/redis-tcp'

describe('redis-tcp adapter (node-redis → Upstash surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('REDIS_URL', 'rediss://localhost:6379')
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

  it('maps {ex} and {nx} options to node-redis SET option objects', async () => {
    const redis = getTcpRedis()
    calls.set.mockResolvedValue('OK')
    await redis.set('k', '1', { ex: 30 })
    expect(calls.set).toHaveBeenCalledWith('k', '1', { EX: 30 })

    await redis.set('k', '1', { nx: true })
    expect(calls.set).toHaveBeenCalledWith('k', '1', { NX: true })

    await redis.set('lock', '1', { nx: true, ex: 60 })
    expect(calls.set).toHaveBeenCalledWith('lock', '1', { EX: 60, NX: true })
  })

  it('getdel parses the consumed value', async () => {
    const redis = getTcpRedis()
    calls.getDel.mockResolvedValue('{"used":true}')
    expect(await redis.getdel('tok')).toEqual({ used: true })
  })

  it('decr delegates to the node-redis client', async () => {
    const redis = getTcpRedis()
    calls.decr.mockResolvedValue(2)
    expect(await redis.decr('gen')).toBe(2)
    expect(calls.decr).toHaveBeenCalledWith('gen')
  })

  it('scan maps lowercase {match, count} → uppercase {MATCH, COUNT} and returns the [cursor, keys] tuple', async () => {
    const redis = getTcpRedis()
    // node-redis returns a {cursor, keys} object with a string cursor; the adapter must expose
    // the Upstash [cursor, keys] tuple the caller destructures.
    calls.scan.mockResolvedValue({ cursor: '42', keys: ['pending_upload:a', 'pending_upload:b'] })
    const [nextCursor, keys] = await redis.scan(0, { match: 'pending_upload:*', count: 100 })
    expect(calls.scan).toHaveBeenCalledWith('0', { MATCH: 'pending_upload:*', COUNT: 100 })
    expect(nextCursor).toBe('42')
    expect(keys).toEqual(['pending_upload:a', 'pending_upload:b'])
  })

  it('eval maps (script, keys, args) into node-redis (script, {keys, arguments}) with string args', async () => {
    const redis = getTcpRedis()
    calls.eval.mockResolvedValue(1)
    await redis.eval('SCRIPT', ['k1', 'k2'], [5, 'arg'])
    expect(calls.eval).toHaveBeenCalledWith('SCRIPT', { keys: ['k1', 'k2'], arguments: ['5', 'arg'] })
  })

  it('passes the CA cert into socket tls options and skips hostname identity when REDIS_CA_CERT is set', async () => {
    vi.stubEnv('REDIS_CA_CERT', '-----BEGIN CERT-----')
    resetTcpRedisForTests()
    const redis = getTcpRedis()
    // The socket is built lazily on the first command — trigger one, then inspect opts.
    calls.get.mockResolvedValue(null)
    await redis.get('x')
    const socket = getLastOpts()?.socket as
      | { tls?: boolean; ca?: string; checkServerIdentity?: (host: string, cert: never) => undefined }
      | undefined
    // verify-CA, not verify-full: chain is verified against the CA, but the hostname identity
    // check is skipped because we dial Memorystore by private IP, not its cert CN.
    expect(socket?.tls).toBe(true)
    expect(socket?.ca).toBe('-----BEGIN CERT-----')
    expect(typeof socket?.checkServerIdentity).toBe('function')
    expect(socket?.checkServerIdentity?.('10.0.0.1', {} as never)).toBeUndefined()
  })

  it('does NOT set a credentials provider by default (local no-auth valkey path)', async () => {
    const redis = getTcpRedis()
    calls.get.mockResolvedValue(null)
    await redis.get('x')
    expect(getLastOpts()?.credentialsProvider).toBeUndefined()
    expect(getLastCredentials()).toBeNull()
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('authenticates with the AUTH username "default" + an IAM access token when REDIS_IAM_AUTH=true', async () => {
    vi.stubEnv('REDIS_IAM_AUTH', 'true')
    getAccessToken.mockResolvedValue('iam-token-abc')
    resetTcpRedisForTests()
    const redis = getTcpRedis()
    calls.get.mockResolvedValue(null)
    await redis.get('x')
    expect(getAccessToken).toHaveBeenCalled()
    expect(getLastCredentials()).toEqual({ username: 'default', password: 'iam-token-abc' })
  })

  it('retries the connect after a transient failure instead of poisoning the singleton', async () => {
    vi.stubEnv('REDIS_IAM_AUTH', 'true')
    // First token fetch fails (e.g. metadata server hiccup at cold start), second succeeds.
    getAccessToken.mockRejectedValueOnce(new Error('metadata timeout')).mockResolvedValue('iam-token-xyz')
    resetTcpRedisForTests()
    const redis = getTcpRedis()
    calls.get.mockResolvedValue(null)

    await expect(redis.get('x')).rejects.toThrow('metadata timeout')
    // The next command must rebuild the client rather than reuse a cached rejected promise.
    await redis.get('x')
    expect(getLastCredentials()).toEqual({ username: 'default', password: 'iam-token-xyz' })
  })
})
