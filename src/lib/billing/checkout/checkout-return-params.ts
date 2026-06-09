/** Allowlisted checkout info messages — only these keys may appear in return URL params. */
export const CHECKOUT_INFO_MESSAGES = {
  session_owner_mismatch: 'That checkout session does not belong to your account.',
  invalid_session: 'Invalid checkout session.',
  sync_pending: 'Checkout completed, but subscription sync is still pending. Please refresh shortly.',
  no_subscription: 'Checkout completed, but no subscription was found yet. Please refresh shortly.',
  activation_failed:
    'Checkout completed, but your subscription could not be activated. Please contact support if Pro access is missing.',
  rate_limited: 'Too many attempts. Please try again shortly.',
} as const

export type CheckoutInfoMessageKey = keyof typeof CHECKOUT_INFO_MESSAGES

export type CheckoutReturnNotification =
  | { type: 'canceled' }
  | { type: 'success' }
  | { type: 'syncing' }
  | { type: 'info'; messageKey: CheckoutInfoMessageKey }

export interface SettingsCheckoutSearchParams {
  checkout?: string
  reason?: string
}

function isCheckoutInfoMessageKey(value: string): value is CheckoutInfoMessageKey {
  return value in CHECKOUT_INFO_MESSAGES
}

/** Maps post-redirect settings query params to a one-time checkout toast. */
export function checkoutNotificationFromSearchParams(
  searchParams: SettingsCheckoutSearchParams,
): CheckoutReturnNotification | null {
  switch (searchParams.checkout) {
    case 'canceled':
      return { type: 'canceled' }
    case 'success':
      return { type: 'success' }
    case 'syncing':
      return { type: 'syncing' }
    case 'info': {
      const reason = searchParams.reason?.trim()
      if (!reason || !isCheckoutInfoMessageKey(reason)) return null
      return { type: 'info', messageKey: reason }
    }
    default:
      return null
  }
}

/** Builds the settings path shown after Stripe checkout return API finalization. */
export function buildCheckoutReturnRedirectPath(notification: CheckoutReturnNotification): string {
  if (notification.type === 'info') {
    return `/settings?checkout=info&reason=${encodeURIComponent(notification.messageKey)}`
  }
  return `/settings?checkout=${notification.type}`
}

export function checkoutInfoNotification(messageKey: CheckoutInfoMessageKey): CheckoutReturnNotification {
  return { type: 'info', messageKey }
}
