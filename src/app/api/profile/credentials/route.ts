import { authedRoute } from '@/lib/api/route'
import { noContent, problem, problemFrom, parseOr422 } from '@/lib/api/http'
import { optionalPasswordInput } from '@/lib/api/schemas/profile'
import { ErrorMessage } from '@/lib/api/error-messages'
import { removeCredentialLogin } from '@/lib/db/users'
import { pickLinkedEmailForPrimary } from '@/lib/utils/auth'
import { verifyPasswordFromBody, requireAuthMethods } from '@/lib/app/profile-helpers'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
import { syncStripeCustomerEmailForUserSafe } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile' })

export const DELETE = authedRoute({ rateLimit: 'changeCredentials' }, async ({ userId, request }) => {
  const parsed = parseOr422(optionalPasswordInput, await request.json())
  if (!parsed.ok) return parsed.res

  const auth = await requireAuthMethods(userId)
  if (!auth.ok) return problemFrom(auth.failure)
  if (!auth.user.password) return problem(400, ErrorMessage.NO_PASSWORD_SET)
  if (auth.user.accounts.length === 0) return problem(400, ErrorMessage.CANNOT_REMOVE_ONLY_SIGN_IN_METHOD)

  const fail = await verifyPasswordFromBody(
    userId,
    parsed.data.password,
    'Password is required to unlink your Email & Password sign-in.',
  )
  if (fail) return problemFrom(fail)

  // Unlinking clears the credentialEmail. When the primary `email` IS that credential address, it
  // would be left as an email the user can no longer authenticate with, so move the primary onto a
  // linked OAuth account's address. A normal primary email (not the credential one) is left untouched.
  const primaryIsCredentialEmail = auth.user.credentialEmail !== null && auth.user.email === auth.user.credentialEmail
  const fallbackEmail = pickLinkedEmailForPrimary(auth.user.accounts)
  if (primaryIsCredentialEmail && !fallbackEmail) {
    return problem(400, 'Cannot unlink your sign-in email — link an OAuth account with a known email first.')
  }
  const newEmail = primaryIsCredentialEmail && fallbackEmail ? fallbackEmail : auth.user.email
  const emailMoved = newEmail !== auth.user.email

  await removeCredentialLogin(userId, newEmail)
  // Resilient: the unlink is committed; a Stripe outage must not 500 it.
  if (emailMoved) await syncStripeCustomerEmailForUserSafe(userId, newEmail)
  invalidateProfileCache(userId)
  void sendSecurityNotification(userId, 'password-removed')
  log.info({ userId, emailMoved }, 'Credential login unlinked')
  return noContent()
})
