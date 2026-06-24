'use client'

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

export function BillingSettings({
  initialData,
  searchParams,
}: BillingSettingsProps) {
  const checkoutNotification = checkoutNotificationFromSearchParams(searchParams)

  const { billingContext } = useBillingContext({ initialData })
  const data = billingContext

  // Reconcile the /profile/me Pro flag from billing so the sidebar updates after a checkout return.
  useReconcileProFlag(data?.isPro)

  if (!data) {
    return <div className="h-48 rounded-xl border bg-muted/30 animate-pulse" />
  }

  const {
    billing,
    unavailable: billingUnavailable,
    isPro,
    needsBillingRecovery,
    checkoutDisabled,
    canManageBilling,
    usage,
  } = data

  // Dates/status arrive as ISO strings over JSON — coerce back to Date / the Stripe enum for the
  // display sections (which still type against the rich domain shapes). `new Date(...)` accepts both.
  const stripeSubscriptionStart = billing?.stripeSubscriptionStart ? new Date(billing.stripeSubscriptionStart) : null
  const stripeCurrentPeriodEnd = billing?.stripeCurrentPeriodEnd ? new Date(billing.stripeCurrentPeriodEnd) : null
  const stripeCancelAtPeriodEnd = billing?.stripeCancelAtPeriodEnd ?? false
  const stripeSubscriptionStatus = (billing?.stripeSubscriptionStatus ?? null) as Stripe.Subscription.Status | null
  const billingIssueMessage = getBillingIssueMessage(stripeSubscriptionStatus, isPro)
  const planInfo = isPro ? getSubscriptionIntervalInfo(billing?.stripeSubscriptionInterval ?? null) : null

  const billingActions = (
    <BillingActions
      isPro={isPro}
      isCanceling={stripeCancelAtPeriodEnd}
      canManageBilling={canManageBilling}
      showUpgradeCta={!checkoutDisabled}
      billingUnavailable={billingUnavailable}
    />
  )

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
      icon={<CreditCard />}
      subtitle="Manage your subscription and view your current usage"
      headerExtra={
        <Badge variant={isPro ? 'default' : 'secondary'} className="text-base px-4 py-1.5">
          {isPro ? 'Pro' : 'Free'}
        </Badge>
      }
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
