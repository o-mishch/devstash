import { oc } from '@orpc/contract'
import { z } from 'zod'
import { billingRedirectSchema } from './common'

// `priceId` is validated as a non-empty string here; the handler enforces the allowed-price-id
// check (server-only config) and returns BAD_REQUEST for a disallowed plan.
export const billingContract = {
  createCheckout: oc
    .route({ method: 'POST', path: '/billing/checkout' })
    .input(z.object({ priceId: z.string().trim().min(1, 'Invalid subscription plan selected.') }))
    .output(billingRedirectSchema),

  createPortal: oc
    .route({ method: 'POST', path: '/billing/portal' })
    .output(billingRedirectSchema),

  cancelSubscription: oc.route({ method: 'POST', path: '/billing/cancel' }),

  reactivateSubscription: oc.route({ method: 'POST', path: '/billing/reactivate' }),
}
