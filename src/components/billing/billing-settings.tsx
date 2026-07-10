'use client'

import { useMemo } from 'react'
import { CreditCard } from 'lucide-react'
import { BillingAlert } from '@/components/billing/billing-alert'
import {
  checkoutNotificationFromSearchParams,
  type SettingsCheckoutSearchParams,
} from '@/lib/billing/checkout/checkout-return-params'
import { CollapsibleCard } from '@/components/shared/collapsible-card'
import { Badge } from '@/components/ui/badge'
import {
  BILLING_UNAVAILABLE_MESSAGE,
  getBillingIssueMessage,
} from '@/lib/billing/messages/billing-messages.client'
import { getSubscriptionIntervalInfo } from '@/lib/billing/config/billing-pricing.client'
import { BillingActions } from './billing-actions'
import { BillingCheckoutNotification } from './billing-checkout-notification'
import {
  BillingFreeTierSection,
  BillingProPlanSection,
  BillingProUnavailableSection,
} from './billing-settings-sections'
import type Stripe from 'stripe'
import { useBillingContext, useReconcileProFlag } from '@/hooks/billing/use-billing-context'
import type { BillingContextResponse } from '@/lib/api/schemas/billing'

interface BillingSettingsProps {
  initialData?: BillingContextResponse
  searchParams: SettingsCheckoutSearchParams
}

// Fully static — no prop/state dependency — hoisted once at module scope instead of recreated per render.
const creditCardIcon = <CreditCard />

export function BillingSettings({
  initialData,
  searchParams,
}: BillingSettingsProps) {
  const checkoutNotification = checkoutNotificationFromSearchParams(searchParams)

  const { billingContext } = useBillingContext({ initialData })
  const data = billingContext

  // Reconcile the /profile/me Pro flag from billing so the sidebar updates after a checkout return.
  useReconcileProFlag(data?.isPro)

  // Hooks must run unconditionally (before the `!data` loading-state return below), so the memo
  // inputs are read via optional chaining here rather than from the post-guard destructure.
  const isPro = data?.isPro ?? false
  const billingUnavailable = data?.unavailable ?? false
  const checkoutDisabled = data?.checkoutDisabled ?? false
  const canManageBilling = data?.canManageBilling ?? false
  const stripeCancelAtPeriodEnd = data?.billing?.stripeCancelAtPeriodEnd ?? false

  const billingActions = useMemo(
    () => (
      <BillingActions
        isPro={isPro}
        isCanceling={stripeCancelAtPeriodEnd}
        canManageBilling={canManageBilling}
        showUpgradeCta={!checkoutDisabled}
        billingUnavailable={billingUnavailable}
      />
    ),
    [isPro, stripeCancelAtPeriodEnd, canManageBilling, checkoutDisabled, billingUnavailable],
  )

  const headerExtra = useMemo(
    () => (
      <Badge variant={isPro ? 'default' : 'secondary'} className="text-base px-4 py-1.5">
        {isPro ? 'Pro' : 'Free'}
      </Badge>
    ),
    [isPro],
  )

  if (!data) {
    return <div className="h-48 rounded-xl border bg-muted/30 animate-pulse" />
  }

  const { billing, needsBillingRecovery, usage } = data

  // Dates/status arrive as ISO strings over JSON — coerce back to Date / the Stripe enum for the
  // display sections (which still type against the rich domain shapes). `new Date(...)` accepts both.
  const stripeSubscriptionStart = billing?.stripeSubscriptionStart ? new Date(billing.stripeSubscriptionStart) : null
  const stripeCurrentPeriodEnd = billing?.stripeCurrentPeriodEnd ? new Date(billing.stripeCurrentPeriodEnd) : null
  const stripeSubscriptionStatus = (billing?.stripeSubscriptionStatus ?? null) as Stripe.Subscription.Status | null
  const billingIssueMessage = getBillingIssueMessage(stripeSubscriptionStatus, isPro)
  const planInfo = isPro ? getSubscriptionIntervalInfo(billing?.stripeSubscriptionInterval ?? null) : null

  let billingBody
  if (isPro && !billingUnavailable && planInfo) {
    billingBody = (
      <BillingProPlanSection
        stripeCancelAtPeriodEnd={stripeCancelAtPeriodEnd}
        stripeSubscriptionStatus={stripeSubscriptionStatus}
        stripeSubscriptionStart={stripeSubscriptionStart}
        stripeCurrentPeriodEnd={stripeCurrentPeriodEnd}
        planLabel={planInfo.label}
        planPrice={planInfo.price}
        planUnit={planInfo.unit}
        billingActions={billingActions}
      />
    )
  } else if (isPro && billingUnavailable) {
    billingBody = <BillingProUnavailableSection billingActions={billingActions} />
  } else {
    billingBody = (
      <BillingFreeTierSection
        needsBillingRecovery={needsBillingRecovery}
        itemsCount={usage.itemsCount}
        collectionsCount={usage.collectionsCount}
        canManageBilling={canManageBilling}
        billingActions={billingActions}
      />
    )
  }

  return (
    <CollapsibleCard
      title="Billing & Usage"
      icon={creditCardIcon}
      subtitle="Manage your subscription and view your current usage"
      headerExtra={headerExtra}
    >
      <div className="space-y-6">
        <BillingCheckoutNotification notification={checkoutNotification} />
        {billingUnavailable && (
          <BillingAlert textSize="xs">{BILLING_UNAVAILABLE_MESSAGE}</BillingAlert>
        )}
        {billingIssueMessage && (
          <BillingAlert textSize="xs">{billingIssueMessage}</BillingAlert>
        )}
        {billingBody}
      </div>
    </CollapsibleCard>
  )
}
