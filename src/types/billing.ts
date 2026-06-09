/** App-owned subscription status labels for billing UI — decoupled from Stripe SDK types. */
export type BillingSubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'paused'
  | 'trialing'
  | 'unpaid'

export type SubscriptionDisplayState =
  | 'canceling'
  | 'unavailable'
  | 'payment_issue'
  | 'paused'
  | 'trial'
  | 'active'
