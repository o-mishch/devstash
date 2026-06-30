import 'server-only'

import type { Redis as UpstashRedis } from '@upstash/redis'
import IORedis from 'ioredis'
import { logger } from '@/lib/infra/pino'

// Native TCP Redis backend (ioredis) used on long-running deployments — GKE
// (Memorystore) and the local kind run. It is OFF on Vercel: getRedis() only
// reaches for this when REDIS_URL is set, so the serverless path keeps using the
// connectionless @upstash/redis REST client untouched (see redis.ts).
//
// This module exposes the SAME method surface the app already calls on the
// Upstash client (get/set/getdel/del/incr/expire/eval) with Upstash's
// auto-JSON-serialize semantics, so the ~24 call sites, redis-cache.ts and the
// auth/upload token stores need zero changes. The object is cast to the Upstash
// `Redis` type at the boundary: it implements only the subset the app uses, which
// is all any caller touches.

const log = logger.child({ tag: 'redis-tcp' })

type IORedisClient = InstanceType<typeof IORedis>

let _client: IORedisClient | null = null
let _adapter: UpstashRedis | null = null

// Upstash stores strings as-is and JSON-encodes everything else; on read it tries
// JSON.parse and falls back to the raw string. We mirror that so objects, numbers
// and plain string tokens all round-trip identically across both backends.
function serialize(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function deserialize<T>(raw: string | null): T | null {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as unknown as T
  }
}

function createClient(): IORedisClient {
  // ioredis is a Node net/tls library — safe here because nothing runs on the edge
  // runtime (no middleware.ts, no `runtime: 'edge'` routes) and Vercel never sets
  // REDIS_URL, so getRedis() never reaches this branch there anyway.
  const caCert = process.env.REDIS_CA_CERT
  const client = new IORedis(process.env.REDIS_URL as string, {
    connectTimeout: 5000,
    // Fail fast (2 retries) so a down Redis degrades gracefully instead of hanging
    // a request — every caller already no-ops on a rejected command.
    maxRetriesPerRequest: 2,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
    // Memorystore STANDARD_HA: on failover the old primary answers writes with
    // READONLY until the client reconnects to the promoted replica. Force a
    // reconnect on that error so writes recover automatically.
    reconnectOnError: (err: Error) => err.message.includes('READONLY'),
    // AUTH rides in the rediss:// URL (redis://default:<token>@host:port). rediss://
    // already enables TLS; supply the CA to verify Memorystore's server-auth cert.
    // checkServerIdentity is skipped (verify-CA, not verify-full): we dial Memorystore
    // by private IP, but its Google-managed cert is issued to the instance identity, not
    // the IP — default hostname verification would throw ERR_TLS_CERT_ALTNAME_INVALID.
    // The CA chain is still verified (rejectUnauthorized stays true). Mirrors db-local.ts.
    ...(caCert ? { tls: { ca: caCert, checkServerIdentity: () => undefined } } : {}),
  })
  // Swallow connection errors at the socket level — every caller already treats a
  // failed command as a graceful no-op (rate-limit fail-open/closed, cache miss),
  // so an unhandled 'error' must not crash the process.
  client.on('error', (err: Error) => log.warn({ err }, 'redis-tcp connection error'))
  return client
}

interface SetOptions {
  ex?: number
  nx?: boolean
}

function buildAdapter(client: IORedisClient): UpstashRedis {
  const adapter = {
    async get<T = unknown>(key: string): Promise<T | null> {
      return deserialize<T>(await client.get(key))
    },
    async set(key: string, value: unknown, opts?: SetOptions): Promise<'OK' | null> {
      const payload = serialize(value)
      if (opts?.nx && opts.ex) return client.set(key, payload, 'EX', opts.ex, 'NX')
      if (opts?.nx) return client.set(key, payload, 'NX')
      if (opts?.ex) return client.set(key, payload, 'EX', opts.ex)
      return client.set(key, payload)
    },
    async getdel<T = unknown>(key: string): Promise<T | null> {
      return deserialize<T>(await client.getdel(key))
    },
    del(...keys: string[]): Promise<number> {
      return client.del(...keys)
    },
    incr(key: string): Promise<number> {
      return client.incr(key)
    },
    expire(key: string, seconds: number): Promise<number> {
      return client.expire(key, seconds)
    },
    eval<TData = unknown>(script: string, keys: string[], args: (string | number)[]): Promise<TData> {
      return client.eval(script, keys.length, ...keys, ...args) as Promise<TData>
    },
    async ping(): Promise<string> {
      return client.ping()
    },
  }
  // The app only ever calls the methods above; the cast narrows our shim to the
  // Upstash surface without re-implementing the full client.
  return adapter as unknown as UpstashRedis
}

/** Singleton ioredis-backed client exposing the Upstash `Redis` method surface. */
export function getTcpRedis(): UpstashRedis {
  if (_adapter) return _adapter
  _client = createClient()
  _adapter = buildAdapter(_client)
  log.info({}, 'redis-tcp client initialized')
  return _adapter
}

/** Tears down the singleton — tests only. */
export function resetTcpRedisForTests(): void {
  void _client?.quit().catch(() => {})
  _client = null
  _adapter = null
}
