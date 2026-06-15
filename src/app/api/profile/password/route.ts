import 'server-only'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail, changePasswordSchema, setInitialPasswordSchema } from '@/lib/utils/validators'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { changeUserPassword } from '@/lib/auth/auth-service'
import { getUserAuthMethods } from '@/lib/db/users'
import { applyOwnedEmailChange, verifyPasswordOrFail } from '@/lib/app/profile-helpers'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile-password' })

/** Change an existing password. */
export const PATCH = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('changePassword', userId)
  if (denied) return denied

  const body: unknown = await request.json()
  const parsed = parseOrFail(changePasswordSchema, body)
  if (!parsed.success) return parsed.response

  const pwError = await verifyPasswordOrFail(userId, parsed.data.currentPassword, 'Current password is incorrect or not set.')
  if (pwError) return pwError

  await changeUserPassword(userId, parsed.data.newPassword)
  log.info({ userId }, 'Password changed')
  return ApiResponse.OK()
})

/** Set an initial password for an OAuth-only account. */
export const POST = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('changePassword', userId)
  if (denied) return denied

  const body: unknown = await request.json()
  const parsed = parseOrFail(setInitialPasswordSchema, body)
  if (!parsed.success) return parsed.response
  const { email: selectedEmail, newPassword } = parsed.data

  const user = await getUserAuthMethods(userId)
  if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
  if (user.password) return ApiResponse.CONFLICT('You already have a password. Use Change Password instead.')

  const applied = await applyOwnedEmailChange({
    userId,
    newEmail: selectedEmail,
    notOwnedMessage: 'You can only use an email from one of your linked accounts.',
  })
  if (applied) return applied

  await changeUserPassword(userId, newPassword)
  invalidateProfileCache(userId)
  log.info({ userId }, 'Initial password set')
  return ApiResponse.OK()
})
