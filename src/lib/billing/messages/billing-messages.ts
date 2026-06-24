import 'server-only'

import type Stripe from 'stripe'
import { subscriptionNeedsBillingPortalRecovery } from '../config/billing-config'

// BILLING_UNAVAILABLE_MESSAGE + getBillingIssueMessage are pure display copy now defined in the client-safe
// sibling (the billing settings card is a Client Component); re-exported below so server callers are unchanged.

export function getExistingSubscriptionMessage(
  subscriptionStatus?: Stripe.Subscription.Status,
): string {
  if (subscriptionNeedsBillingPortalRecovery(subscriptionStatus)) {
    return 'Your subscription has a billing issue. Open Manage Billing in settings to update your payment method.'
  }
  return 'You already have a subscription. Manage it from Billing settings.'
}

export {
  BILLING_UNAVAILABLE_MESSAGE,
  getBillingIssueMessage,
  BILLING_CANCEL_FALLBACK_ERROR,
  BILLING_PORTAL_FALLBACK_ERROR,
  BILLING_REACTIVATE_FALLBACK_ERROR,
  CHECKOUT_DISABLED_RECOVERY_MESSAGE,
  CHECKOUT_NOT_CONFIGURED_MESSAGE,
  CHECKOUT_TOAST_MESSAGES,
  CURRENT_PLAN_CTA_CLASSNAME,
  CURRENT_PLAN_LABEL,
  getBillingRecoveryHint,
  getCheckoutNotificationMessage,
  getProContentRetentionHint,
} from './billing-messages.client'
