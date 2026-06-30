import 'server-only'

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { getRedis } from '@/lib/infra/redis'
import { localS3Overrides } from '@/lib/storage/s3-local'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'health' })

// Status of an OPTIONAL dependency in the deep readiness check:
//   'ok'       — reachable
//   'down'     — configured but unreachable (logged; does NOT fail the probe)
//   'disabled' — not configured at all (expected when running without it)
export type DependencyHealth = 'ok' | 'down' | 'disabled'

// Per-check ceiling for the OPTIONAL dependencies. The readiness probe
// (deployment.yaml: GET /api/health?deep=1, timeoutSeconds 3) fans out to all
// checks concurrently but only the DB result gates readiness. Without a bound, a
// hung Redis/S3 socket would consume the whole 3s probe budget and time the probe
// out — pulling a HEALTHY pod (DB fine) from rotation over a non-critical dep. Cap
// each optional check so its slowness degrades to 'down' fast, well inside the budget.
const OPTIONAL_CHECK_TIMEOUT_MS = 2000

// Reject a promise if it outruns `ms`. `.unref()` so the timer never keeps the
// process (or a probe request) alive on its own.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`health check timed out after ${ms}ms`)), ms)
      t.unref()
    }),
  ])
}

export async function checkRedis(): Promise<DependencyHealth> {
  const redis = getRedis()
  if (!redis) return 'disabled'
  try {
    await withTimeout(redis.ping(), OPTIONAL_CHECK_TIMEOUT_MS)
    return 'ok'
  } catch (err) {
    log.warn({ err }, 'readiness: redis unreachable (non-critical)')
    return 'down'
  }
}

// Singleton S3Client for readiness probes — separate from the upload client to
// avoid coupling probe availability to upload-client configuration. Initialized
// lazily on first probe call. Reused across calls to avoid creating a new TCP+TLS
// connection pool on every probe (readiness fires every 10s per pod).
let _s3ProbeClient: S3Client | null = null
function getS3ProbeClient(): S3Client {
  if (!_s3ProbeClient) {
    _s3ProbeClient = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      ...localS3Overrides(),
    })
  }
  return _s3ProbeClient
}

export async function checkS3(): Promise<DependencyHealth> {
  const bucket = process.env.AWS_S3_BUCKET
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID) return 'disabled'
  try {
    // HeadBucket is the cheapest "is the bucket reachable + authorized" probe.
    // Endpoint comes from AWS_ENDPOINT_URL_S3 (SDK-native); localS3Overrides()
    // adds forcePathStyle for MinIO/GCS interop. In the local kind run the pod
    // reaches MinIO via the minio-localhost-shim socat sidecar (localhost:9000 →
    // minio:9000), which is loopback-exempt from NetworkPolicy; the socat→minio
    // hop is covered by the local NetworkPolicy patch (port 9000 egress).
    await withTimeout(getS3ProbeClient().send(new HeadBucketCommand({ Bucket: bucket })), OPTIONAL_CHECK_TIMEOUT_MS)
    return 'ok'
  } catch (err) {
    log.warn({ err }, 'readiness: s3 unreachable (non-critical)')
    return 'down'
  }
}

export async function checkEmail(): Promise<DependencyHealth> {
  // Local SMTP path (Mailpit): probe its HTTP readiness endpoint. Gated on SMTP_HOST
  // presence — the same signal isLocalEmailEnabled() uses (set only by the local Secret).
  if (process.env.SMTP_HOST) {
    const host = process.env.SMTP_HOST ?? 'mailpit'
    try {
      const res = await fetch(`http://${host}:8025/readyz`, {
        signal: AbortSignal.timeout(2000),
      })
      return res.ok ? 'ok' : 'down'
    } catch (err) {
      log.warn({ err }, 'readiness: mailpit unreachable (non-critical)')
      return 'down'
    }
  }
  // Production path: Resend is a fire-and-forget HTTP API with no health endpoint.
  // We report 'ok' when an API key is configured (nothing to ping), else 'disabled'.
  return process.env.RESEND_API_KEY ? 'ok' : 'disabled'
}
