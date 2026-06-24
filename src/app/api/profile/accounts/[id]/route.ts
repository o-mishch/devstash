import { authedRouteWithParams } from '@/lib/api/route'
import { noContent, problem, problemFrom, parseOr422 } from '@/lib/api/http'
import { accountIdParam } from '@/lib/api/schemas/profile'
import { ErrorMessage } from '@/lib/api/error-messages'
import { checkAccountExists, unlinkUserAccount } from '@/lib/db/users'
import { requireAuthMethods } from '@/lib/app/profile-helpers'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile' })

type RouteParams = Awaited<RouteContext<'/api/profile/accounts/[id]'>['params']>

export const DELETE = authedRouteWithParams<RouteParams>(
  { rateLimit: 'changeCredentials' },
  async ({ userId, params }) => {
    const parsedParams = parseOr422(accountIdParam, params)
    if (!parsedParams.ok) return parsedParams.res
    const { id } = parsedParams.data

    const auth = await requireAuthMethods(userId)
    if (!auth.ok) return problemFrom(auth.failure)

    const totalAuthMethods = (auth.user.password ? 1 : 0) + auth.user.accounts.length
    if (totalAuthMethods <= 1) return problem(400, ErrorMessage.CANNOT_REMOVE_ONLY_SIGN_IN_METHOD)

    const account = await checkAccountExists(id, userId)
    if (!account) return problem(404, 'Account not found.')

    await unlinkUserAccount(userId, id)
    invalidateProfileCache(userId)
    void sendSecurityNotification(userId, 'method-unlinked')
    log.info({ userId, accountId: id }, 'Provider unlinked')
    return noContent()
  },
)
