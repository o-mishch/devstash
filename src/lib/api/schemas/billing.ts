import { z } from 'zod'

// Request/response schemas for the billing endpoints (oRPC `oc.route()` wrappers stripped — bare
// Zod). checkout/portal return a `{ url }` the client hard-redirects to; cancel/reactivate return
// 204. The redirect-terminating `checkout-return` route stays exempt (unchanged). [C].

export const createCheckoutInput = z.object({
  priceId: z.string().trim().min(1, 'Invalid subscription plan selected.'),
})

// Mirrors BillingRedirectData — a Stripe URL the client hard-redirects to.
export const billingRedirectSchema = z.object({ url: z.string() }).meta({ id: 'BillingRedirect' })

// Consolidated billing display context and usage counts for the Client Component.
export const billingContextSchema = z
  .object({
    billing: z
      .object({
        email: z.string().nullable(),
        stripeCustomerId: z.string().nullable(),
        stripeSubscriptionId: z.string().nullable(),
        isPro: z.boolean(),
        stripeSubscriptionStatus: z.string().nullable(),
        stripeSubscriptionStart: z.string().nullable(),
        stripeCurrentPeriodEnd: z.string().nullable(),
        stripeSubscriptionInterval: z.string().nullable(),
        stripeCancelAtPeriodEnd: z.boolean(),
      })
      .nullable(),
    unavailable: z.boolean(),
    isPro: z.boolean(),
    needsBillingRecovery: z.boolean(),
    checkoutDisabled: z.boolean(),
    checkoutDisabledMessage: z.string().nullable(),
    canManageBilling: z.boolean(),
    usage: z.object({
      itemsCount: z.number(),
      collectionsCount: z.number(),
    }),
  })
  .meta({ id: 'BillingContext' })

// The GET /billing/context response shape (string dates/enums, as it travels over JSON) — the single type
// shared by the route serializer, the SSR seed, and the client `useBillingContext` reader.
export type BillingContextResponse = z.infer<typeof billingContextSchema>
