/** Returned by checkout/portal billing routes — the URL the client redirects to. */
export interface BillingRedirectData {
  url: string
}

export type SubscriptionDisplayState =
  | 'canceling'
  | 'unavailable'
  | 'payment_issue'
  | 'paused'
  | 'trial'
  | 'active'
