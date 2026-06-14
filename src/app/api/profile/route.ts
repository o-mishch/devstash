import 'server-only'
import { signOut } from '@/auth'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { getUserAuthMethods, deleteUserById } from '@/lib/db/users'
import { verifyPasswordFromBody } from '@/lib/app/profile-helpers'
import { teardownStripeBillingForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('api-profile-delete')

export const DELETE = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('deleteAccount', userId)
  if (denied) return denied

  const body: unknown = await request.json().catch(() => null)
  const password = (body as { password?: unknown })?.password

  const authMethods = await getUserAuthMethods(userId)
  if (authMethods?.password) {
    const pwError = await verifyPasswordFromBody(userId, password, 'Password is required to delete your account.')
    if (pwError) return pwError
  }

  try {
    await teardownStripeBillingForUser(userId)
  } catch (error) {
    log.error('Stripe billing teardown failed — aborting account deletion', { userId, error })
    return ApiResponse.INTERNAL_ERROR(
      'We could not finish billing cleanup. Please try again shortly or contact support.',
    )
  }

  try {
    await deleteUserById(userId)
  } catch (error) {
    log.error('ACCOUNT_DELETE_PARTIAL_FAILURE', { userId, error }, 'billing teardown succeeded but user row deletion failed')
    return ApiResponse.INTERNAL_ERROR(
      'Billing was cleaned up, but account deletion failed. Please try again or contact support.',
    )
  }

  await signOut({ redirect: false })
  log.info('Account deleted', { userId })
  return ApiResponse.OK()
})
