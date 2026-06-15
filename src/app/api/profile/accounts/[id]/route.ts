import 'server-only'
import { z } from 'zod'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail } from '@/lib/utils/validators'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { getUserAuthMethods, checkAccountExists, unlinkUserAccount } from '@/lib/db/users'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile-accounts' })

const accountIdSchema = z.string().trim().min(1, 'Account is required.')

export const DELETE = authenticatedRoute(async (_request, context, { userId }) => {
  const denied = await rateLimitRoute('changeCredentials', userId)
  if (denied) return denied

  const { id } = await context.params
  const parsed = parseOrFail(accountIdSchema, id)
  if (!parsed.success) return parsed.response

  const user = await getUserAuthMethods(userId)
  if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const totalAuthMethods = (user.password ? 1 : 0) + user.accounts.length
  if (totalAuthMethods <= 1) {
    return ApiResponse.BAD_REQUEST('Cannot remove your only sign-in method.')
  }

  const account = await checkAccountExists(parsed.data, userId)
  if (!account) return ApiResponse.NOT_FOUND('Account not found.')

  await unlinkUserAccount(userId, parsed.data)
  invalidateProfileCache(userId)
  log.info({ userId, accountId: parsed.data }, 'Provider unlinked')
  return ApiResponse.OK()
})
