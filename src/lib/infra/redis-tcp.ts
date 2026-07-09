import 'server-only'

import type { GoogleAuth as GoogleAuthClient } from 'google-auth-library'
import type { Redis as UpstashRedis } from '@upstash/redis'
import { createClient, type RedisClientType } from 'redis'
import { logger } from '@/lib/infra/pino'

// Native TCP Redis/Valkey backend (node-redis) used on long-running deployments — GKE
// (Memorystore for Valkey) and the local kind run. It is OFF on Vercel: getRedis() only
// reaches for this when REDIS_URL is set, so the serverless path keeps using the
// connectionless @upstash/redis REST client untouched (see redis.ts).
//
// This module exposes the SAME method surface the app already calls on the Upstash client
// (get/set/getdel/del/incr/expire/eval/ping) with Upstash's auto-JSON-serialize semantics,
// so the ~24 call sites, redis-cache.ts and the auth/upload token stores need zero changes.
// The object is cast to the Upstash `Redis` type at the boundary: it implements only the
// subset the app uses, which is all any caller touches.
//
// AUTH: Memorystore for Valkey uses IAM auth (no static password). When REDIS_IAM_AUTH=true
// (set only in the GKE overlay) the client authenticates with the AUTH username "default"
// and a short-lived Google OAuth2 access token minted for the Workload-Identity SA. We wire
// that through node-redis's first-class AsyncCredentialsProvider: node-redis calls
// credentials() on every (re)connect, so each new connection gets a freshly-minted token
// with no manual refresh timer. Tokens expire in ~1 h and an authenticated connection stays
// valid 12 h; when the server drops the connection at that cap (or on any socket close) the
// reconnect fetches a new token automatically. Locally REDIS_IAM_AUTH is unset → plain
// no-auth valkey over redis:// (the same code path, no credentialsProvider).
//
// FAILOVER NOTE: unlike the previous ioredis client, node-redis has no per-command
// reconnectOnError hook, so there is no explicit READONLY trigger. On a Memorystore replica
// failover the primary PSC endpoint is repointed and the live socket is dropped, which the
// reconnectStrategy below handles (fresh connection to the promoted primary). The old
// ioredis READONLY reconnect was a belt-and-suspenders for a demoted-but-still-serving
// primary — a window Memorystore's managed endpoint model closes by severing the socket.

const log = logger.child({ tag: 'redis-tcp' })

// The default RedisClientType (no modules/functions/scripts). A concrete createClient(opts)
// call infers a narrower generic, so it is cast to this alias at the boundary below.
type TcpClient = RedisClientType

// The client is built lazily behind a memoized promise: on the IAM path node-redis awaits a
// token (via the credentials provider) during connect(), but getTcpRedis() is called
// synchronously (see redis.ts). The adapter is returned synchronously; the socket is created
// and connected on the first command.
let _clientPromise: Promise<TcpClient> | null = null
let _client: TcpClient | null = null
let _adapter: UpstashRedis | null = null

function isIamAuth(): boolean {
  return process.env.REDIS_IAM_AUTH === 'true'
}

// Memoize the GoogleAuth instance so its internal token cache survives across reconnects — a
// fresh instance would re-hit the metadata server every time. `import type` above is erased
// at build time; the runtime module is loaded only on the IAM path via the dynamic import
// below, so google-auth-library is never pulled in on the local/no-IAM path.
let _googleAuth: GoogleAuthClient | null = null

// Fetches an OAuth2 access token for the ambient credentials (on GKE: the app SA via
// Workload Identity, resolved through the metadata server). google-auth-library caches the
// token and refreshes it when near expiry, so calling this on every reconnect is cheap.
async function getIamAccessToken(): Promise<string> {
  if (!_googleAuth) {
    const { GoogleAuth } = await import('google-auth-library')
    _googleAuth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
  }
  const token = await _googleAuth.getAccessToken()
  if (!token) throw new Error('redis-tcp: failed to obtain Google IAM access token for Valkey')
  return token
}

// Upstash stores strings as-is and JSON-encodes everything else; on read it tries JSON.parse
// and falls back to the raw string. We mirror that so objects, numbers and plain string
// tokens all round-trip identically across both backends.
function serialize(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function deserialize<T>(raw: string | null): T | null {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    // Mirrors Upstash: a value that wasn't JSON-encoded (plain string tokens) round-trips as-is.
    // T is caller-supplied with no runtime evidence to validate against, same as the JSON.parse
    // branch above — inherent to a generic deserialize helper with no schema.
    return raw as T
  }
}

async function createAndConnect(): Promise<TcpClient> {
  // node-redis is a Node net/tls library — safe here because nothing runs on the edge
  // runtime (no middleware.ts, no `runtime: 'edge'` routes) and Vercel never sets REDIS_URL,
  // so getRedis() never reaches this branch there anyway.
  const caCert = process.env.REDIS_CA_CERT

  // Bounded exponential backoff (mirrors the old ioredis retryStrategy). Returning a number
  // keeps retrying, so the client self-heals after an outage or a 12 h authed-connection cap.
  const reconnectStrategy = (retries: number): number => Math.min(retries * 200, 2000)

  // IAM auth (Valkey on GKE): node-redis calls credentials() on every (re)connect and sends
  // AUTH "default" <token>. Fetching the token inside the provider means the FIRST connect
  // already has a valid token and every reconnect re-AUTHs with a fresh one — no manual timer.
  const credentialsProvider = isIamAuth()
    ? {
        type: 'async-credentials-provider' as const,
        credentials: async () => ({ username: 'default', password: await getIamAccessToken() }),
      }
    : undefined

  const client = createClient({
    url: process.env.REDIS_URL as string,
    ...(credentialsProvider ? { credentialsProvider } : {}),
    // Pin RESP3 explicitly. node-redis 6 already defaults to it, but the old ioredis client
    // spoke RESP2 — making it explicit keeps the protocol version visible/reviewable and
    // immune to a future library default flip. Valkey 9 supports both; every command this
    // adapter uses (get/set/getDel/del/incr/expire/eval/ping) returns a scalar whose shape is
    // identical across RESP2/3, so RESP3 is a free win (native-type parsing, no downside).
    RESP: 3,
    // Reject commands immediately while disconnected instead of queueing them — every caller
    // already treats a failed command as a graceful no-op (rate-limit fail-open/closed, cache
    // miss), so failing fast beats a growing offline queue that would flood on reconnect.
    disableOfflineQueue: true,
    socket: caCert
      ? {
          connectTimeout: 5000,
          reconnectStrategy,
          // rediss:// (TLS) — supply the Google-managed CA to verify Valkey's server-auth
          // cert. checkServerIdentity is disabled (verify-CA, not verify-full): we dial
          // Memorystore by private PSC IP but its cert is issued to the instance identity,
          // not the IP, so default hostname verification would throw
          // ERR_TLS_CERT_ALTNAME_INVALID. The CA chain is still verified. Mirrors db-local.ts.
          tls: true,
          ca: caCert,
          checkServerIdentity: () => undefined,
        }
      : { connectTimeout: 5000, reconnectStrategy },
  })

  // Swallow connection errors at the socket level — every caller already treats a failed
  // command as a graceful no-op, so an unhandled 'error' must not crash the process.
  client.on('error', (err: Error) => log.warn({ err }, 'redis-tcp connection error'))

  await client.connect()
  _client = client
  return _client
}

// Memoize the connect. On rejection (e.g. a transient token fetch or DNS failure at cold
// start) clear the memo so the NEXT command retries instead of being poisoned by a cached
// rejected promise for the life of the process.
function ensureClient(): Promise<TcpClient> {
  _clientPromise ??= createAndConnect().catch((err: unknown) => {
    _clientPromise = null
    _client = null
    throw err
  })
  return _clientPromise
}

interface SetOptions {
  ex?: number
  nx?: boolean
}

// Upstash-style scan options (lowercase) — mapped to node-redis's uppercase {MATCH, COUNT} below.
interface ScanOptions {
  match?: string
  count?: number
}

function buildAdapter(): UpstashRedis {
  const adapter = {
    async get<T = unknown>(key: string): Promise<T | null> {
      const client = await ensureClient()
      return deserialize<T>(await client.get(key))
    },
    async set(key: string, value: unknown, opts?: SetOptions): Promise<'OK' | null> {
      const client = await ensureClient()
      const payload = serialize(value)
      // Map Upstash-style {ex, nx} → node-redis {EX, NX} in one object; omit the options arg
      // entirely when neither is set so a plain SET stays a two-arg SET (no empty options object).
      const setOpts = { ...(opts?.ex ? { EX: opts.ex } : {}), ...(opts?.nx ? { NX: true } : {}) }
      const result = Object.keys(setOpts).length > 0 ? client.set(key, payload, setOpts) : client.set(key, payload)
      return result as Promise<'OK' | null>
    },
    async getdel<T = unknown>(key: string): Promise<T | null> {
      const client = await ensureClient()
      return deserialize<T>(await client.getDel(key))
    },
    async del(...keys: string[]): Promise<number> {
      const client = await ensureClient()
      return client.del(keys)
    },
    async incr(key: string): Promise<number> {
      const client = await ensureClient()
      return client.incr(key)
    },
    async decr(key: string): Promise<number> {
      const client = await ensureClient()
      return client.decr(key)
    },
    async scan(cursor: number, opts?: ScanOptions): Promise<[string, string[]]> {
      const client = await ensureClient()
      // Upstash returns a [cursor, keys] tuple with lowercase {match, count}; node-redis
      // returns a {cursor, keys} object with uppercase {MATCH, COUNT}. Map both directions so
      // the caller's `const [next, keys] = await redis.scan(...)` destructure keeps working.
      const reply = await client.scan(String(cursor), {
        ...(opts?.match ? { MATCH: opts.match } : {}),
        ...(opts?.count ? { COUNT: opts.count } : {}),
      })
      return [String(reply.cursor), reply.keys]
    },
    async expire(key: string, seconds: number): Promise<number> {
      const client = await ensureClient()
      return client.expire(key, seconds)
    },
    async eval<TData = unknown>(script: string, keys: string[], args: (string | number)[]): Promise<TData> {
      const client = await ensureClient()
      return client.eval(script, { keys, arguments: args.map(String) }) as Promise<TData>
    },
    async ping(): Promise<string> {
      const client = await ensureClient()
      return client.ping()
    },
  }
  // The app only ever calls the methods above; the cast narrows our shim to the Upstash
  // surface without re-implementing the full client. A single-step assertion suffices — the
  // shim's method names/signatures overlap enough with the real Upstash Redis class for
  // TypeScript to accept it directly, no `unknown` bounce needed.
  return adapter as UpstashRedis
}

/** Singleton node-redis-backed client exposing the Upstash `Redis` method surface. */
export function getTcpRedis(): UpstashRedis {
  if (_adapter) return _adapter
  _adapter = buildAdapter()
  log.info({ iamAuth: isIamAuth() }, 'redis-tcp client initialized')
  return _adapter
}

/**
 * The raw, connected node-redis client behind the adapter — for consumers that need the real
 * client rather than the Upstash surface (rate-limiter-flexible's `storeClient`, see
 * rate-limit-tcp.ts). Shares the same singleton connection (IAM token, TLS, reconnect); the
 * client instance is stable across reconnects, so a limiter can hold this reference safely.
 */
export function getTcpRedisClient(): Promise<TcpClient> {
  return ensureClient()
}

/** Tears down the singleton — tests only. */
export function resetTcpRedisForTests(): void {
  if (_client?.isOpen) void _client.quit().catch(() => {})
  _client = null
  _clientPromise = null
  _adapter = null
}
