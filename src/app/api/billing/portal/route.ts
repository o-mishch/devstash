import { authedRoute } from '@/lib/api/route'
import { json, problem } from '@/lib/api/http'
import { createPortalSession } from '@/lib/infra/stripe'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { logger } from '@/lib/infra/pino'
import { getBaseUrl } from '@/lib/utils/url'

const portalLog = logger.child({ tag: 'api-billing-portal' })

export const POST = authedRoute({ rateLimit: 'stripePortal' }, async ({ userId }) => {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeCustomerId) {
    portalLog.warn({ userId }, 'Portal access attempted but no stripeCustomerId')
    return problem(400, 'No subscription found. Please contact support.')
  }

  try {
    const portalSession = await createPortalSession(user.stripeCustomerId, `${getBaseUrl()}/settings`)
    if (!portalSession.url) {
      portalLog.warn({ userId }, 'Stripe portal session created but URL missing')
      return problem(500, 'Failed to create Portal session URL')
    }
    portalLog.info({ userId }, 'Created portal session')
    return json({ url: portalSession.url })
  } catch (err) {
    portalLog.error({ userId, err }, 'Failed to create portal session')
    return problem(500, 'Unable to open billing portal. Please try again.')
  }
})
