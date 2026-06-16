import { publicRoute, rateLimited } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { resetPasswordInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { applyPasswordReset } from '@/lib/auth/auth-service'

export const POST = publicRoute(async ({ request }) => {
  const { success, retryAfter } = await checkRateLimit('resetPassword', await getActionIP())
  if (!success) return rateLimited(retryAfter)

  const parsed = parseOr422(resetPasswordInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { token, password } = parsed.data

  const result = await applyPasswordReset(token, password)
  if (result !== 'ok') {
    return problem(400, 'This reset link is invalid or has expired.')
  }
  return noContent()
})
