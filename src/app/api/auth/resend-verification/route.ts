import { publicRoute, rateLimited } from '@/lib/api/route'
import { noContent, parseOr422 } from '@/lib/api/http'
import { resendVerificationInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { resendVerification } from '@/lib/emails/verification'

export const POST = publicRoute(async ({ request }) => {
  const ip = await getActionIP()
  // Broad IP-only guard before body parse — separate bucket, does not consume the per-email quota.
  const ipGuard = await checkRateLimit('resendVerificationIP', ip)
  if (!ipGuard.success) return rateLimited(ipGuard.retryAfter)

  const parsed = parseOr422(resendVerificationInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { email } = parsed.data

  // Tighter per-IP+email guard for the actual send.
  const sendGuard = await checkRateLimit('resendVerification', `${ip}:${email}`)
  if (!sendGuard.success) return rateLimited(sendGuard.retryAfter)

  await resendVerification(email)
  return noContent()
})
