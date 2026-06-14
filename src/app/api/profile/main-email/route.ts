import 'server-only'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail, EmailSchema } from '@/lib/utils/validators'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { getProfileData } from '@/lib/db/profile'
import { applyOwnedEmailChange, verifyPasswordFromBody } from '@/lib/app/profile-helpers'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('api-profile-main-email')

export const PATCH = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('changeCredentials', userId)
  if (denied) return denied

  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null
  const result = parseOrFail(EmailSchema, body?.email)
  if (!result.success) return result.response
  const newEmail = result.data

  const data = await getProfileData(userId)
  if (!data) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  if (data.user.hasPassword) {
    const pwError = await verifyPasswordFromBody(userId, body?.password, 'Password is required to change your sign-in email.')
    if (pwError) return pwError
  }

  const applied = await applyOwnedEmailChange({
    userId,
    newEmail,
    notOwnedMessage: 'You can only set an email from one of your linked accounts.',
  })
  if (applied) return applied

  log.info('Main email updated', { userId })
  return ApiResponse.OK()
})
