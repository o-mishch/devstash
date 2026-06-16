import { authedRoute } from '@/lib/api/route'
import { noContent, problem, problemFrom, parseOr422 } from '@/lib/api/http'
import { optionalPasswordInput } from '@/lib/api/schemas/profile'
import { ErrorMessage } from '@/lib/api/error-messages'
import { removeUserPassword } from '@/lib/db/users'
import { verifyPasswordFromBody, requireAuthMethods } from '@/lib/app/profile-helpers'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
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
    'Password is required to remove your password.',
  )
  if (fail) return problemFrom(fail)

  await removeUserPassword(userId)
  invalidateProfileCache(userId)
  void sendSecurityNotification(userId, 'password-removed')
  log.info({ userId }, 'Credentials removed')
  return noContent()
})
