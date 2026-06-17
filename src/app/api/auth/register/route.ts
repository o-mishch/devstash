import { after } from 'next/server'
import { publicRoute, rateLimited } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { registerInput } from '@/lib/api/schemas/auth'
import { checkRateLimit, getActionIP } from '@/lib/infra/rate-limit'
import { registerUser } from '@/lib/auth/auth-service'

export const POST = publicRoute(async ({ request }) => {
  const { success, retryAfter } = await checkRateLimit('register', await getActionIP())
  if (!success) return rateLimited(retryAfter)

  const parsed = parseOr422(registerInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { name, email, password } = parsed.data

  const { result, sendEmail } = await registerUser(name, email, password)

  if (result === 'email-in-use') {
    // Dev-only (DISABLE_EMAIL_VERIFICATION): the email belongs to an existing account and can't be
    // re-used as a fresh Email & Password sign-up without a verification link.
    return problem(409, 'This email is already in use.')
  }

  if (sendEmail) {
    after(sendEmail)
  }

  if (result === 'skipped') {
    return json({ redirectTo: '/sign-in' })
  }
  return json({
    redirectTo: `/register?pending=1&email=${encodeURIComponent(email)}&sent=1`,
  })
})
