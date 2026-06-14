import 'server-only'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { createPortalSession } from '@/lib/stripe'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { createLogger } from '@/lib/infra/logger'
import { getBaseUrl } from '@/lib/utils/url'
import type { BillingRedirectData } from '@/types/billing'

const log = createLogger('api-billing-portal')

export const POST = authenticatedRoute(async (_request, _context, { userId }) => {
  const denied = await rateLimitRoute('stripePortal', userId)
  if (denied) return denied

  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeCustomerId) {
    log.warn('Portal access attempted but no stripeCustomerId', { userId })
    return ApiResponse.BAD_REQUEST('No subscription found. Please contact support.')
  }

  try {
    const portalSession = await createPortalSession(user.stripeCustomerId, `${getBaseUrl()}/settings`)
    if (!portalSession.url) {
      log.warn('Stripe portal session created but URL missing', { userId })
      return ApiResponse.INTERNAL_ERROR('Failed to create Portal session URL')
    }
    log.info('Created portal session', { userId })
    return ApiResponse.OK<BillingRedirectData>({ url: portalSession.url })
  } catch (err) {
    log.error('Failed to create portal session', { userId, error: err })
    return ApiResponse.INTERNAL_ERROR('Unable to open billing portal. Please try again.')
  }
})
