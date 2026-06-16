import { authedRoute } from '@/lib/api/route'
import { noContent, problem, problemFrom, parseOr422 } from '@/lib/api/http'
import { changePasswordInput, setInitialPasswordInput } from '@/lib/api/schemas/profile'
import { changeUserPassword } from '@/lib/auth/auth-service'
import { verifyPasswordOrFail, requireAuthMethods, applyOwnedEmailChange } from '@/lib/app/profile-helpers'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile' })

export const PATCH = authedRoute({ rateLimit: 'changePassword' }, async ({ userId, request }) => {
  const parsed = parseOr422(changePasswordInput, await request.json())
  if (!parsed.ok) return parsed.res

  const fail = await verifyPasswordOrFail(
    userId,
    parsed.data.currentPassword,
    'Current password is incorrect or not set.',
  )
  if (fail) return problemFrom(fail)

  await changeUserPassword(userId, parsed.data.newPassword)
  log.info({ userId }, 'Password changed')
  return noContent()
})

export const POST = authedRoute({ rateLimit: 'changePassword' }, async ({ userId, request }) => {
  const parsed = parseOr422(setInitialPasswordInput, await request.json())
  if (!parsed.ok) return parsed.res

  const auth = await requireAuthMethods(userId)
  if (!auth.ok) return problemFrom(auth.failure)
  if (auth.user.password) {
    return problem(409, 'You already have a password. Use Change Password instead.')
  }

  const fail = await applyOwnedEmailChange({
    userId,
    newEmail: parsed.data.email,
    notOwnedMessage: 'You can only use an email from one of your linked accounts.',
  })
  if (fail) return problemFrom(fail)

  await changeUserPassword(userId, parsed.data.newPassword)
  invalidateProfileCache(userId)
  log.info({ userId }, 'Initial password set')
  return noContent()
})
