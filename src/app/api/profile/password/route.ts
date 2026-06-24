import { authedRoute } from '@/lib/api/route'
import { noContent, problemFrom, parseOr422 } from '@/lib/api/http'
import { changePasswordInput } from '@/lib/api/schemas/profile'
import { changeUserPassword } from '@/lib/auth/auth-service'
import { verifyPasswordOrFail } from '@/lib/services/profile-helpers'
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
