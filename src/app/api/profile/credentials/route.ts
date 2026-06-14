import 'server-only'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { getUserAuthMethods, removeUserPassword } from '@/lib/db/users'
import { verifyPasswordFromBody } from '@/lib/app/profile-helpers'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('api-profile-credentials')

export const DELETE = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('changeCredentials', userId)
  if (denied) return denied

  const body: unknown = await request.json().catch(() => null)
  const password = (body as { password?: unknown })?.password

  const user = await getUserAuthMethods(userId)
  if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
  if (!user.password) return ApiResponse.BAD_REQUEST('No password set.')
  if (user.accounts.length === 0) return ApiResponse.BAD_REQUEST('Cannot remove your only sign-in method.')

  const pwError = await verifyPasswordFromBody(userId, password, 'Password is required to remove your password.')
  if (pwError) return pwError

  await removeUserPassword(userId)
  invalidateProfileCache(userId)
  log.info('Credentials removed', { userId })
  return ApiResponse.OK()
})
