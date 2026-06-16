import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { publicRoute, rateLimited } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { loginInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { getUserEmailVerified } from '@/lib/db/users'

export const POST = publicRoute(async ({ request }) => {
  const parsed = parseOr422(loginInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { email, password } = parsed.data

  if (emailVerificationEnabled()) {
    const user = await getUserEmailVerified(email)
    if (user && !user.emailVerified) {
      // Typed 403 carrying the email so the client can offer "resend verification". No rate-limit
      // budget is consumed — this is not a failed credential attempt.
      return problem(403, 'Please verify your email before signing in.', { email })
    }
  }

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === 'CredentialsSignin') {
        // Only count FAILED attempts — successful logins must not consume the budget.
        const { success, retryAfter } = await checkRateLimit('login', `${await getActionIP()}:${email}`)
        if (!success) return rateLimited(retryAfter)
        return problem(400, 'Invalid email or password.')
      }
      return problem(400, 'Something went wrong. Please try again.')
    }
    throw error
  }

  return noContent()
})
