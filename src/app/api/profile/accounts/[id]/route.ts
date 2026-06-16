import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { noContent, problem, problemFrom } from '@/lib/api/http'
import { ErrorMessage } from '@/lib/api/error-messages'
import { checkAccountExists, unlinkUserAccount } from '@/lib/db/users'
import { requireAuthMethods } from '@/lib/app/profile-helpers'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile' })

export const DELETE = authedRouteWithParams<IdParam>(
  { rateLimit: 'changeCredentials' },
  async ({ userId, params }) => {
    const auth = await requireAuthMethods(userId)
    if (!auth.ok) return problemFrom(auth.failure)

    const totalAuthMethods = (auth.user.password ? 1 : 0) + auth.user.accounts.length
    if (totalAuthMethods <= 1) return problem(400, ErrorMessage.CANNOT_REMOVE_ONLY_SIGN_IN_METHOD)

    const account = await checkAccountExists(params.id, userId)
    if (!account) return problem(404, 'Account not found.')

    await unlinkUserAccount(userId, params.id)
    invalidateProfileCache(userId)
    log.info({ userId, accountId: params.id }, 'Provider unlinked')
    return noContent()
  },
)
