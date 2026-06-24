import { after } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { noContent, problem, problemFrom, parseOr422 } from '@/lib/api/http'
import { requestCredentialEmailInput } from '@/lib/api/schemas/profile'
import { requestCredentialEmail } from '@/lib/auth/auth-service'
import { requireAuthMethods, verifyPasswordFromBody } from '@/lib/services/profile-helpers'

// Authed + per-user rate-limited. In the normal (verification-enabled) flow it always returns 204
// regardless of whether the address was free, so the response can't be used to enumerate which emails
// already have an account. When DISABLE_EMAIL_VERIFICATION is on the login is
// activated instantly from the password collected up front, so it can return 409 (in use) / 422
// (password missing) — that flow is dev-only and not enumeration-sensitive.
export const POST = authedRoute({ rateLimit: 'credentialEmail' }, async ({ userId, request }) => {
  const parsed = parseOr422(requestCredentialEmailInput, await request.json())
  if (!parsed.ok) return parsed.res

  // Re-auth: re-pointing an EXISTING sign-in email is as sensitive as changing the password — for an
  // in-sync account it also moves the identity email, hence the password-reset target — so require the
  // current password, matching the default-email change. A first-time ADD has no password to verify;
  // ownership is proven by the confirm link / the password set up front.
  const auth = await requireAuthMethods(userId)
  if (!auth.ok) return problemFrom(auth.failure)
  if (auth.user.password) {
    const fail = await verifyPasswordFromBody(
      userId,
      parsed.data.password,
      'Your current password is required to change your sign-in email.',
    )
    if (fail) return problemFrom(fail)
  }

  const { result, sendEmail } = await requestCredentialEmail(userId, parsed.data.email, parsed.data.newPassword)
  if (result === 'password-required') return problem(422, 'A password is required to add Email & Password sign-in.')
  if (result === 'email-in-use') return problem(409, 'That email is already in use.')
  if (result === 'send-failed') return problem(503, 'Could not send the confirmation email. Please try again later.')
  if (result === 'not-found') return problem(401, 'Your session is no longer valid. Please sign in again.')

  if (sendEmail) {
    after(sendEmail)
  }
  return noContent()
})
