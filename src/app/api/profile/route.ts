import { authedRoute } from '@/lib/api/route'
import { noContent, problem, problemFrom, parseOr422 } from '@/lib/api/http'
import { optionalPasswordInput } from '@/lib/api/schemas/profile'
import { signOut } from '@/auth'
import { getUserAuthMethods, deleteUserById } from '@/lib/db/users'
import { verifyPasswordFromBody } from '@/lib/app/profile-helpers'
import { teardownStripeBillingForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile' })

export const DELETE = authedRoute({ rateLimit: 'deleteAccount' }, async ({ userId, request }) => {
  const parsed = parseOr422(optionalPasswordInput, await request.json())
  if (!parsed.ok) return parsed.res

  const authMethods = await getUserAuthMethods(userId)
  if (authMethods?.password) {
    const fail = await verifyPasswordFromBody(
      userId,
      parsed.data.password,
      'Password is required to delete your account.',
    )
    if (fail) return problemFrom(fail)
  }

  try {
    await teardownStripeBillingForUser(userId)
  } catch (error) {
    log.error({ userId, err: error }, 'Stripe billing teardown failed — aborting account deletion')
    return problem(500, 'We could not finish billing cleanup. Please try again shortly or contact support.')
  }

  try {
    await deleteUserById(userId)
  } catch (error) {
    log.error(
      { userId, err: error },
      'ACCOUNT_DELETE_PARTIAL_FAILURE — billing teardown succeeded but user row deletion failed',
    )
    return problem(500, 'Billing was cleaned up, but account deletion failed. Please try again or contact support.')
  }

  await signOut({ redirect: false })
  log.info({ userId }, 'Account deleted')
  return noContent()
})
