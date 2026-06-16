import { publicRoute, rateLimited } from '@/lib/api/route'
import { json, parseOr422 } from '@/lib/api/http'
import { forgotPasswordInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { triggerPasswordReset } from '@/lib/auth/auth-service'

export const POST = publicRoute(async ({ request }) => {
  const { success, retryAfter } = await checkRateLimit('forgotPassword', await getActionIP())
  if (!success) return rateLimited(retryAfter)

  const parsed = parseOr422(forgotPasswordInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { email } = parsed.data

  await triggerPasswordReset(email)
  // Always report "sent" — no account enumeration.
  return json({ redirectTo: `/forgot-password?sent=1&email=${encodeURIComponent(email)}` })
})
