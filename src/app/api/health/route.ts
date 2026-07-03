import { publicRoute } from '@/lib/api/route'
import { json } from '@/lib/api/http'
import { prisma } from '@/lib/infra/prisma'
import { checkRedis, checkS3, checkEmail, type DependencyHealth, type EmailHealth } from '@/lib/infra/health-checks'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'health' })

// Health endpoint for Kubernetes probes (see infra/docs/02-kubernetes.md).
//   - Liveness  (GET /api/health):       process is up — no dependency checks, must be fast.
//   - Readiness (GET /api/health?deep=1): verifies dependencies. Postgres is CRITICAL —
//     if it's down the pod is unready (503). Redis, S3 and email are OPTIONAL — their
//     status is reported but an outage of any never fails readiness, since the app keeps
//     serving without them (cache/rate-limit, uploads, and mail degrade independently).
//     The email field is keyed by the active transport: `resend` in production, or `mailpit`
//     when running the local cluster (SMTP_HOST set).
// Public by design — probes run without a session and must never be rate-limited or auth-gated.
export const GET = publicRoute(async ({ request }) => {
  const deep = request.nextUrl.searchParams.get('deep') === '1'

  if (!deep) return json({ status: 'ok' })

  // All checks run concurrently; only the DB result gates readiness.
  const [db, redis, s3, email] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    checkRedis(),
    checkS3(),
    checkEmail(),
  ])

  if (db.status === 'rejected') {
    log.error({ err: db.reason }, 'readiness probe: database unreachable')
    return json({ status: 'degraded', db: 'down' }, 503)
  }

  const settled = (r: PromiseSettledResult<DependencyHealth>): DependencyHealth =>
    r.status === 'fulfilled' ? r.value : 'down'

  // checkEmail() never throws (probe errors resolve to 'down'), so a rejection is only a
  // defensive fallback; default to the production transport name in that impossible case.
  const emailResult: EmailHealth =
    email.status === 'fulfilled' ? email.value : { transport: 'resend', health: 'down' }

  return json({
    status: 'ok',
    db: 'ok',
    redis: settled(redis),
    s3: settled(s3),
    [emailResult.transport]: emailResult.health,
  })
})
