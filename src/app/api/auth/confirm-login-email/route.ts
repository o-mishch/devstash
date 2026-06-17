import { publicRoute, rateLimited } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { confirmLoginEmailInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { confirmCredentialEmail } from '@/lib/auth/auth-service'

// Public, token-gated. IP rate-limited by its own bucket to blunt token brute-forcing on top of the
// token's 256-bit entropy (a dedicated key so it can't starve the unrelated password-reset budget).
export const POST = publicRoute(async ({ request }) => {
  const { success, retryAfter } = await checkRateLimit('confirmLoginEmail', await getActionIP())
  if (!success) return rateLimited(retryAfter)

  const parsed = parseOr422(confirmLoginEmailInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { token, password } = parsed.data

  const result = await confirmCredentialEmail(token, password)
  if (result === 'email-in-use') {
    return problem(
      409,
      'That email is already in use. This link has been used — request a new confirmation link from your profile.',
    )
  }
  if (result === 'password-required') {
    return problem(
      422,
      'A password is required to finish adding Email & Password sign-in. Enter a password to continue, or request a new confirmation link from your profile.',
    )
  }
  if (result !== 'ok') {
    return problem(400, 'This confirmation link is invalid or has expired.')
  }
  return noContent()
})
