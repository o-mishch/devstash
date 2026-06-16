import { authedRoute } from '@/lib/api/route'
import { noContent, problem, problemFrom, parseOr422 } from '@/lib/api/http'
import { changeEmailInput } from '@/lib/api/schemas/profile'
import { ErrorMessage } from '@/lib/api/error-messages'
import { verifyPasswordOrFail, requireAuthMethods, applyOwnedEmailChange } from '@/lib/app/profile-helpers'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile' })

export const PATCH = authedRoute({ rateLimit: 'changeCredentials' }, async ({ userId, request }) => {
  const parsed = parseOr422(changeEmailInput, await request.json())
  if (!parsed.ok) return parsed.res

  const auth = await requireAuthMethods(userId)
  if (!auth.ok) return problemFrom(auth.failure)
  if (!auth.user.password) return problem(400, ErrorMessage.NO_PASSWORD_SET)

  const vfail = await verifyPasswordOrFail(userId, parsed.data.password)
  if (vfail) return problemFrom(vfail)

  const fail = await applyOwnedEmailChange({
    userId,
    newEmail: parsed.data.email,
    notOwnedMessage: 'You can only use an email from one of your linked accounts.',
  })
  if (fail) return problemFrom(fail)

  log.info({ userId }, 'Credential email changed')
  return noContent()
})
