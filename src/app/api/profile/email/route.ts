import 'server-only'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail, changeCredentialEmailSchema } from '@/lib/utils/validators'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { getUserAuthMethods } from '@/lib/db/users'
import { applyOwnedEmailChange, verifyPasswordOrFail } from '@/lib/app/profile-helpers'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile-email' })

export const PATCH = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('changeCredentials', userId)
  if (denied) return denied

  const body: unknown = await request.json()
  const parsed = parseOrFail(changeCredentialEmailSchema, body)
  if (!parsed.success) return parsed.response
  const { email: newEmail, password } = parsed.data

  const user = await getUserAuthMethods(userId)
  if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
  if (!user.password) return ApiResponse.BAD_REQUEST('No password set.')

  const pwError = await verifyPasswordOrFail(userId, password)
  if (pwError) return pwError

  const applied = await applyOwnedEmailChange({
    userId,
    newEmail,
    notOwnedMessage: 'You can only use an email from one of your linked accounts.',
  })
  if (applied) return applied

  log.info({ userId }, 'Credential email changed')
  return ApiResponse.OK()
})
