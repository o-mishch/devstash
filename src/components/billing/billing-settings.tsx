import { CreditCard } from 'lucide-react'
import { BillingAlert } from '@/components/billing/billing-alert'
import {
  checkoutNotificationFromSearchParams,
  type SettingsCheckoutSearchParams,
} from '@/lib/billing/checkout/checkout-return-params'
import { CollapsibleCard } from '@/components/shared/collapsible-card'
import { Badge } from '@/components/ui/badge'
import { getUserUsageStats } from '@/lib/db/usage'
import { loadBillingPageContext } from '@/lib/billing/sync/user-billing-state'
import {
  BILLING_UNAVAILABLE_MESSAGE,
  getBillingIssueMessage,
} from '@/lib/billing/messages/billing-messages'
import { getSubscriptionIntervalInfo } from '@/lib/billing/config/billing-pricing'
import { BillingActions } from './billing-actions'
import { BillingCheckoutNotification } from './billing-checkout-notification'
import {
  BillingFreeTierSection,
  BillingProPlanSection,
  BillingProUnavailableSection,
} from './billing-settings-sections'

interface BillingSettingsProps {
  userId: string
  fallbackIsPro?: boolean
  searchParams: Promise<SettingsCheckoutSearchParams>
}

export async function BillingSettings({
  userId,
  fallbackIsPro = false,
  searchParams,
}: BillingSettingsProps) {
  const resolvedSearchParams = await searchParams
  const checkoutNotification = checkoutNotificationFromSearchParams(resolvedSearchParams)
  const needsFreshBilling = checkoutNotification !== null

  const [usage, billingPage] = await Promise.all([
    getUserUsageStats(userId),
    loadBillingPageContext(userId, fallbackIsPro, { freshBillingContext: needsFreshBilling }),
  ])

  const {
    billing,
    unavailable: billingUnavailable,
    isPro,
    needsBillingRecovery,
    checkoutDisabled,
    canManageBilling,
  } = billingPage

  const stripeSubscriptionStart = billing?.stripeSubscriptionStart ?? null
  const stripeCurrentPeriodEnd = billing?.stripeCurrentPeriodEnd ?? null
  const stripeCancelAtPeriodEnd = billing?.stripeCancelAtPeriodEnd ?? false
  const stripeSubscriptionStatus = billing?.stripeSubscriptionStatus ?? null
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
    // Same widget rules as the rest of the app: accent left border + hover + collapse. The async data
    // fetch stays in this server component; only the collapse toggle (CollapsibleCard) is client, with
    // the server-rendered body passed through as children.
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
