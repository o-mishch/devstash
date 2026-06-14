import 'server-only'
import { authenticatedRoute } from '@/lib/api'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { toggleSubscriptionCancellation } from '@/lib/billing/subscription/toggle-cancellation'

export const POST = authenticatedRoute(async (_request, _context, { userId }) => {
  const denied = await rateLimitRoute('stripeSubscription', userId)
  if (denied) return denied
  return toggleSubscriptionCancellation(userId, true)
})
