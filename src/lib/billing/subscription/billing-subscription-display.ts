import type { BillingSubscriptionStatus, SubscriptionDisplayState } from '@/types/billing'

export type SubscriptionBadgeIcon = 'clock' | 'alert-triangle' | 'check-circle'

export interface SubscriptionBadgeConfig {
  label: string
  icon: SubscriptionBadgeIcon
  className: string
}

export interface SubscriptionCardAccentConfig {
  borderClassName: string
  icon: SubscriptionBadgeIcon
  iconClassName: string
}

function resolveSubscriptionDisplayState(
  cancelAtPeriodEnd: boolean,
  stripeStatus: BillingSubscriptionStatus | null,
  liveStripeUnavailable: boolean,
): SubscriptionDisplayState {
  if (cancelAtPeriodEnd) return 'canceling'
  if (liveStripeUnavailable && stripeStatus == null) return 'unavailable'
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'payment_issue'
  if (stripeStatus === 'paused') return 'paused'
  if (stripeStatus === 'trialing') return 'trial'
  return 'active'
}

const BADGE_BY_STATE: Record<SubscriptionDisplayState, SubscriptionBadgeConfig> = {
  canceling: {
    label: 'Canceling',
    icon: 'clock',
    className: 'text-amber-500 border-amber-500/50 bg-amber-500/10',
  },
  unavailable: {
    label: 'Status unavailable',
    icon: 'alert-triangle',
    className: 'text-muted-foreground border-border bg-muted/30',
  },
  payment_issue: {
    label: 'Payment issue',
    icon: 'alert-triangle',
    className: 'text-amber-500 border-amber-500/50 bg-amber-500/10',
  },
  paused: {
    label: 'Paused',
    icon: 'alert-triangle',
    className: 'text-amber-500 border-amber-500/50 bg-amber-500/10',
  },
  trial: {
    label: 'Trial',
    icon: 'clock',
    className: 'text-sky-500 border-sky-500/50 bg-sky-500/10',
  },
  active: {
    label: 'Active',
    icon: 'check-circle',
    className: 'text-emerald-500 border-emerald-500/50 bg-emerald-500/10',
  },
}

const ACCENT_BY_STATE: Record<SubscriptionDisplayState, SubscriptionCardAccentConfig> = {
  canceling: {
    borderClassName: 'border-amber-500/40',
    icon: 'clock',
    iconClassName: 'text-amber-500',
  },
  unavailable: {
    borderClassName: '',
    icon: 'alert-triangle',
    iconClassName: 'text-muted-foreground',
  },
  payment_issue: {
    borderClassName: 'border-amber-500/40',
    icon: 'alert-triangle',
    iconClassName: 'text-amber-500',
  },
  paused: {
    borderClassName: 'border-amber-500/40',
    icon: 'alert-triangle',
    iconClassName: 'text-amber-500',
  },
  trial: {
    borderClassName: 'border-sky-500/40',
    icon: 'clock',
    iconClassName: 'text-sky-500',
  },
  active: {
    borderClassName: '',
    icon: 'check-circle',
    iconClassName: 'text-emerald-500',
  },
}

export function getSubscriptionBadgeConfig(
  cancelAtPeriodEnd: boolean,
  stripeStatus: BillingSubscriptionStatus | null,
  liveStripeUnavailable = false,
): SubscriptionBadgeConfig {
  const state = resolveSubscriptionDisplayState(cancelAtPeriodEnd, stripeStatus, liveStripeUnavailable)
  return BADGE_BY_STATE[state]
}

export function getSubscriptionCardAccent(
  cancelAtPeriodEnd: boolean,
  stripeStatus: BillingSubscriptionStatus | null,
  liveStripeUnavailable = false,
): SubscriptionCardAccentConfig {
  const state = resolveSubscriptionDisplayState(cancelAtPeriodEnd, stripeStatus, liveStripeUnavailable)
  return ACCENT_BY_STATE[state]
}

export function shouldShowAccessEnds(
  cancelAtPeriodEnd: boolean,
  stripeStatus: BillingSubscriptionStatus | null,
  liveStripeUnavailable = false,
): boolean {
  const state = resolveSubscriptionDisplayState(cancelAtPeriodEnd, stripeStatus, liveStripeUnavailable)
  return state === 'canceling' || state === 'payment_issue' || state === 'paused'
}

export function usesAccentPeriodValueClass(
  cancelAtPeriodEnd: boolean,
  stripeStatus: BillingSubscriptionStatus | null,
  liveStripeUnavailable = false,
): boolean {
  const state = resolveSubscriptionDisplayState(cancelAtPeriodEnd, stripeStatus, liveStripeUnavailable)
  return state === 'canceling' || state === 'payment_issue' || state === 'paused'
}
