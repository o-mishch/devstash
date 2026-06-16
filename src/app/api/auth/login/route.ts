import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { publicRoute, rateLimited } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { loginInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { validateUserPassword } from '@/lib/auth/auth-service'

export const POST = publicRoute(async ({ request }) => {
  const parsed = parseOr422(loginInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { email, password } = parsed.data

  // Validate the password FIRST. `validateUserPassword` runs a constant-time bcrypt compare even on
  // a missing / OAuth-only account (Case 9), so timing can't enumerate accounts.
  const user = await validateUserPassword(email, password)

  if (!user) {
    // Wrong password, or no credential account — generic 400 that consumes the failed-attempt
    // budget. Never reveals whether the account exists. (Case 5)
    const { success, retryAfter } = await checkRateLimit('login', `${await getActionIP()}:${email}`)
    if (!success) return rateLimited(retryAfter)
    return problem(400, 'Invalid email or password.')
  }

  // Password is correct. Only now is it safe to reveal unverified state — existence of an unverified
  // account is no longer enumerable by anyone who doesn't already know the password. No rate-limit
  // budget is consumed for a correct-but-unverified attempt. (Case 5)
  if (emailVerificationEnabled() && !user.emailVerified) {
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
