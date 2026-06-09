import 'server-only'

import type Stripe from 'stripe'
import { subscriptionNeedsBillingPortalRecovery } from '../config/billing-config'

export const BILLING_UNAVAILABLE_MESSAGE =
  'Unable to load billing details right now. Please refresh the page or try again shortly.'

export function getBillingIssueMessage(
  status: Stripe.Subscription.Status | null | undefined,
  isPro: boolean,
): string | null {
  if (status === 'past_due' && isPro) {
    return 'Your latest payment failed. Pro access continues for now — update your payment method in Manage Billing to avoid interruption.'
  }
  if (status === 'unpaid') {
    return 'Your subscription has an unpaid invoice. Use Manage Billing below to update your payment method and restore Pro access — a new checkout is not available while billing is unresolved.'
  }
  if (status === 'paused') {
    return 'Your subscription is paused. Use Manage Billing below to resume and restore Pro access — a new checkout is not available while billing is paused.'
  }
  return null
}

export function getExistingSubscriptionMessage(
  subscriptionStatus?: Stripe.Subscription.Status,
): string {
  if (subscriptionNeedsBillingPortalRecovery(subscriptionStatus)) {
    return 'Your subscription has a billing issue. Open Manage Billing in settings to update your payment method.'
  }
  return 'You already have a subscription. Manage it from Billing settings.'
}

export {
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
