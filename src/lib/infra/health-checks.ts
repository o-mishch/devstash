import 'server-only'

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { getRedis } from '@/lib/infra/redis'
import { localS3Overrides } from '@/lib/storage/s3-local'
import { isLocalEmailEnabled } from '@/lib/infra/email-local'
import { outboundEmailEnabled } from '@/lib/utils/auth'
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
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
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

// HTTP reachability probe shared by the two email transports (Mailpit, Resend):
// a 2xx means 'ok'; anything else or a thrown/timed-out request means 'down' (logged,
// never fatal). Redis/S3 use SDK clients with withTimeout, so they don't route through here.
async function probeHttp(url: string, label: string, init?: RequestInit): Promise<DependencyHealth> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(OPTIONAL_CHECK_TIMEOUT_MS) })
    return res.ok ? 'ok' : 'down'
  } catch (err) {
    log.warn({ err }, `readiness: ${label} unreachable (non-critical)`)
    return 'down'
  }
}

export interface EmailHealth {
  transport: 'resend' | 'mailpit'
  health: DependencyHealth
}

// Email transport check — probes whichever transport is actually wired, and names it so the
// probe reflects what mail really flows through: Resend in production, or the local-cluster
// Mailpit when SMTP_HOST is set (isLocalEmailEnabled). The Mailpit branch never runs outside
// a local run, so production only ever verifies Resend.
//   'disabled' — outbound email is killed (DISABLE_EMAIL_VERIFICATION=true), or Resend has no key.
//   'ok'/'down' — Mailpit: its HTTP readiness endpoint. Resend: an authenticated GET to its API
//                 confirms the key is valid and the API reachable (i.e. we could send) — we never
//                 send a real email on a probe, so a live authenticated call is the closest signal.
export async function checkEmail(): Promise<EmailHealth> {
  if (isLocalEmailEnabled()) {
    const health = outboundEmailEnabled()
      ? await probeHttp(`http://${process.env.SMTP_HOST}:8025/readyz`, 'mailpit')
      : 'disabled'
    return { transport: 'mailpit', health }
  }

  const apiKey = process.env.RESEND_API_KEY
  const health =
    outboundEmailEnabled() && apiKey
      ? await probeHttp('https://api.resend.com/domains', 'resend', {
          headers: { authorization: `Bearer ${apiKey}` },
        })
      : 'disabled'
  return { transport: 'resend', health }
}
