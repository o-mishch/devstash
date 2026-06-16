import { z } from 'zod'

// Request/response schemas for the billing endpoints (oRPC `oc.route()` wrappers stripped — bare
// Zod). checkout/portal return a `{ url }` the client hard-redirects to; cancel/reactivate return
// 204. The redirect-terminating `checkout-return` route stays exempt (unchanged). [C].

export const createCheckoutInput = z.object({
  priceId: z.string().trim().min(1, 'Invalid subscription plan selected.'),
})

// Mirrors BillingRedirectData — a Stripe URL the client hard-redirects to.
export const billingRedirectSchema = z.object({ url: z.string() }).meta({ id: 'BillingRedirect' })
