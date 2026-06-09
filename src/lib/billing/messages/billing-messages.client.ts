import {
  CHECKOUT_INFO_MESSAGES,
  type CheckoutReturnNotification,
} from '@/lib/billing/checkout/checkout-return-params'

export const CHECKOUT_NOT_CONFIGURED_MESSAGE =
  'Upgrade checkout is not configured. Contact support if this persists.'

export const BILLING_PORTAL_FALLBACK_ERROR = 'Unable to open billing portal. Please try again.'

export const BILLING_CANCEL_FALLBACK_ERROR = 'Unable to cancel subscription. Please try again.'

export const BILLING_REACTIVATE_FALLBACK_ERROR = 'Unable to reactivate subscription. Please try again.'

export const CHECKOUT_DISABLED_RECOVERY_MESSAGE =
  'Resolve billing in Settings using Manage Billing — a new checkout is not available while billing is unresolved.'

export const CHECKOUT_TOAST_MESSAGES = {
  canceled: 'Checkout canceled. Your subscription has not been changed.',
  success: 'Subscription successful! Welcome to DevStash Pro.',
  syncing: 'Checkout completed. Your subscription is syncing now.',
} as const

/** Shared “Current plan” pricing CTA — marketing homepage and upgrade page. */
export const CURRENT_PLAN_LABEL = 'Current plan'

export const CURRENT_PLAN_CTA_CLASSNAME =
  'flex w-full items-center justify-center rounded-xl border border-border px-6 py-2.5 text-sm font-medium text-muted-foreground'

/** User-facing copy for a checkout return notification — shared by server alerts and client toasts. */
export function getCheckoutNotificationMessage(
  notification: CheckoutReturnNotification,
): string {
  switch (notification.type) {
    case 'canceled':
      return CHECKOUT_TOAST_MESSAGES.canceled
    case 'success':
      return CHECKOUT_TOAST_MESSAGES.success
    case 'syncing':
      return CHECKOUT_TOAST_MESSAGES.syncing
    case 'info':
      return CHECKOUT_INFO_MESSAGES[notification.messageKey]
  }
}

export function getBillingRecoveryHint(): string {
  return 'Your Stripe billing account is still linked. Use Manage Billing to resolve the issue above — upgrading again requires an active or canceled subscription, not an unpaid or paused one.'
}

export function getProContentRetentionHint(): string {
  return 'File and image items from a previous Pro subscription remain in your library, but Pro is required to access them again.'
}
