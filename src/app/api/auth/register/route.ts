import { publicRoute, rateLimited } from '@/lib/api/route'
import { json, parseOr422 } from '@/lib/api/http'
import { registerInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { registerUser } from '@/lib/auth/auth-service'

export const POST = publicRoute(async ({ request }) => {
  const { success, retryAfter } = await checkRateLimit('register', await getActionIP())
  if (!success) return rateLimited(retryAfter)

  const parsed = parseOr422(registerInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { name, email, password } = parsed.data

  const verification = await registerUser(name, email, password)

  if (verification === 'skipped') {
    return json({ redirectTo: '/sign-in' })
  }
  return json({
    redirectTo: `/register?pending=1&email=${encodeURIComponent(email)}&sent=${verification === 'sent' ? '1' : '0'}`,
  })
})
