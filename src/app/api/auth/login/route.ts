import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { publicRoute, rateLimited } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { loginInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { outboundEmailEnabled } from '@/lib/utils/auth'
import { assertCredentialLoginAllowed, validateUserPassword } from '@/lib/auth/auth-service'

export const POST = publicRoute(async ({ request }) => {
  const parsed = parseOr422(loginInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { email, password } = parsed.data

  // Broad IP guard + max-length before bcrypt — shared with NextAuth `authorize`.
  const ip = await getActionIP()
  const guard = await assertCredentialLoginAllowed(ip, password)
  if (!guard.ok) return rateLimited(guard.retryAfter ?? 60)

  // Validate password before signIn so we can return 403 + { email } for correct-but-unverified
  // attempts. signIn → authorize runs validateUserPassword again (defense-in-depth for other callers).
  const user = await validateUserPassword(email, password)

  if (!user) {
    // Wrong password, or no credential account — generic 400 that consumes the failed-attempt
    // budget. Never reveals whether the account exists.
    const { success, retryAfter } = await checkRateLimit('login', `${ip}:${email}`)
    if (!success) return rateLimited(retryAfter)
    return problem(400, 'Invalid email or password.')
  }

  // Password is correct. Only now is it safe to reveal unverified state — existence of an unverified
  // account is no longer enumerable by anyone who doesn't already know the password. No rate-limit
  // budget is consumed for a correct-but-unverified attempt.
  //
  // Gate on the timestamp of the field the input matched (same rule as `auth.ts` authorize), NOT the
  // primary `emailVerified`: a primary-`email` match checks `emailVerified`, a `credentialEmail` match
  // checks `credentialEmailVerified`. For the primary-email case `matchedVerified === emailVerified`,
  // so the unverified-credentials 403 is unchanged; but an OAuth account (whose `emailVerified` is
  // always null) signing in with its confirmed credential email is no longer wrongly blocked.
  if (outboundEmailEnabled() && !user.matchedVerified) {
    return problem(403, 'Please verify your email before signing in.', { email })
  }

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch (error) {
    if (error instanceof AuthError) {
      return problem(400, 'Something went wrong. Please try again.')
    }
    throw error
  }

  return noContent()
})
