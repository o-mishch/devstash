import { authedRoute } from '@/lib/api/route'
import { json } from '@/lib/api/http'
import { loadBillingPageContext, toBillingContextResponse } from '@/lib/billing/sync/user-billing-state'
import { getUserUsageStats } from '@/lib/db/usage'
import { billingContextSchema } from '@/lib/api/schemas/billing'

export const GET = authedRoute({}, async ({ userId, isPro }) => {
  const [billingPage, usage] = await Promise.all([
    loadBillingPageContext(userId, isPro),
    getUserUsageStats(userId),
  ])

  // Parse on the way out so the response is gated by the schema — strips any field not in the contract
  // (defense-in-depth against the hand-maintained serializer leaking server-only Stripe config).
  return json(billingContextSchema.parse(toBillingContextResponse(billingPage, usage)))
})
