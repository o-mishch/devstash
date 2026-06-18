import { authedRoute } from '@/lib/api/route'
import { noContent, problem, problemFrom, parseOr422 } from '@/lib/api/http'
import { updateMainEmailInput } from '@/lib/api/schemas/profile'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getProfileData } from '@/lib/db/profile'
import { verifyPasswordFromBody, applyOwnedEmailChange } from '@/lib/app/profile-helpers'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile' })

export const PATCH = authedRoute({ rateLimit: 'changeCredentials' }, async ({ userId, request }) => {
  const parsed = parseOr422(updateMainEmailInput, await request.json())
  if (!parsed.ok) return parsed.res

  const data = await getProfileData(userId)
  if (!data) return problem(401, ErrorMessage.NOT_AUTHENTICATED)

  if (data.user.hasPassword) {
    const fail = await verifyPasswordFromBody(
      userId,
      parsed.data.password,
      'Password is required to change your primary email.',
    )
    if (fail) return problemFrom(fail)
  }

  const efail = await applyOwnedEmailChange({
    userId,
    newEmail: parsed.data.email,
    notOwnedMessage: 'You can only set an email from one of your linked accounts.',
    profile: data,
  })
  if (efail) return problemFrom(efail)

  log.info({ userId }, 'Main email updated')
  return noContent()
})
