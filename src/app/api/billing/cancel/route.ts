import { authedRoute } from '@/lib/api/route'
import { noContent } from '@/lib/api/http'
import { toggleSubscriptionCancellation } from '@/lib/billing/subscription/toggle-cancellation'

export const POST = authedRoute({ rateLimit: 'stripeSubscription' }, async ({ userId }) => {
  await toggleSubscriptionCancellation(userId, true)
  return noContent()
})
