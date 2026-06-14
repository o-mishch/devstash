import {
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import type Stripe from 'stripe'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  getSubscriptionBadgeConfig,
  getSubscriptionCardAccent,
  shouldShowAccessEnds,
  type SubscriptionBadgeIcon,
} from '@/lib/billing/subscription/billing-subscription-display'
import { getProContentRetentionHint, getBillingRecoveryHint } from '@/lib/billing/messages/billing-messages.client'
import { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/utils/constants'
import { formatDate } from '@/lib/utils/format'

const BADGE_ICONS: Record<SubscriptionBadgeIcon, typeof CheckCircle2> = {
  'check-circle': CheckCircle2,
  clock: Clock,
  'alert-triangle': AlertTriangle,
}

interface BillingDetailRowProps {
  label: string
  value: string
  valueClassName?: string
}

function BillingDetailRow({ label, value, valueClassName }: BillingDetailRowProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${valueClassName ?? ''}`}>{value}</span>
    </div>
  )
}

interface SubscriptionStatusBadgeProps {
  stripeCancelAtPeriodEnd: boolean
  stripeSubscriptionStatus: Stripe.Subscription.Status | null
}

function SubscriptionStatusBadge({
  stripeCancelAtPeriodEnd,
  stripeSubscriptionStatus,
}: SubscriptionStatusBadgeProps) {
  const { label, icon, className } = getSubscriptionBadgeConfig(
    stripeCancelAtPeriodEnd,
    stripeSubscriptionStatus,
  )
  const Icon = BADGE_ICONS[icon]

  return (
    <Badge variant="outline" className={`${className} gap-1.5 text-xs`}>
      <Icon className="size-3" />
      {label}
    </Badge>
  )
}

interface BillingProPlanCardProps {
  stripeCancelAtPeriodEnd: boolean
  stripeSubscriptionStatus: Stripe.Subscription.Status | null
  stripeSubscriptionStart: Date | null
  stripeCurrentPeriodEnd: Date | null
  planLabel: string
  planPrice: string
  planUnit: string
}

function BillingProPlanCard({
  stripeCancelAtPeriodEnd,
  stripeSubscriptionStatus,
  stripeSubscriptionStart,
  stripeCurrentPeriodEnd,
  planLabel,
  planPrice,
  planUnit,
}: BillingProPlanCardProps) {
  const accent = getSubscriptionCardAccent(stripeCancelAtPeriodEnd, stripeSubscriptionStatus)
  const HeaderIcon = BADGE_ICONS[accent.icon]
  const showAccessEnds = shouldShowAccessEnds(stripeCancelAtPeriodEnd, stripeSubscriptionStatus)

  return (
    <div className={`rounded-lg border divide-y ${accent.borderClassName}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <HeaderIcon className={`size-4 ${accent.iconClassName}`} />
          <span className="text-sm font-semibold">DevStash Pro</span>
        </div>
        <SubscriptionStatusBadge
          stripeCancelAtPeriodEnd={stripeCancelAtPeriodEnd}
          stripeSubscriptionStatus={stripeSubscriptionStatus}
        />
      </div>

      <BillingDetailRow label="Plan" value={`${planLabel} · ${planPrice} / ${planUnit}`} />
      {stripeSubscriptionStart && (
        <BillingDetailRow label="Pro since" value={formatDate(stripeSubscriptionStart, true)} />
      )}
      {showAccessEnds ? (
        <BillingDetailRow
          label="Access ends"
          value={stripeCurrentPeriodEnd ? formatDate(stripeCurrentPeriodEnd, true) : '—'}
          valueClassName={showAccessEnds ? 'text-amber-500' : undefined}
        />
      ) : (
        <BillingDetailRow
          label="Next renewal"
          value={stripeCurrentPeriodEnd ? formatDate(stripeCurrentPeriodEnd, true) : '—'}
        />
      )}

      {stripeCancelAtPeriodEnd && stripeCurrentPeriodEnd && (
        <div className="px-4 py-3 bg-amber-500/5">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Your subscription won&apos;t renew. Pro access continues until <strong>{formatDate(stripeCurrentPeriodEnd, true)}</strong>, then you&apos;ll move to the free plan.
          </p>
        </div>
      )}
    </div>
  )
}

interface BillingProPlanSectionProps {
  stripeCancelAtPeriodEnd: boolean
  stripeSubscriptionStatus: Stripe.Subscription.Status | null
  stripeSubscriptionStart: Date | null
  stripeCurrentPeriodEnd: Date | null
  planLabel: string
  planPrice: string
  planUnit: string
  billingActions: ReactNode
}

export function BillingProPlanSection({
  stripeCancelAtPeriodEnd,
  stripeSubscriptionStatus,
  stripeSubscriptionStart,
  stripeCurrentPeriodEnd,
  planLabel,
  planPrice,
  planUnit,
  billingActions,
}: BillingProPlanSectionProps) {
  return (
    <>
      <BillingProPlanCard
        stripeCancelAtPeriodEnd={stripeCancelAtPeriodEnd}
        stripeSubscriptionStatus={stripeSubscriptionStatus}
        stripeSubscriptionStart={stripeSubscriptionStart}
        stripeCurrentPeriodEnd={stripeCurrentPeriodEnd}
        planLabel={planLabel}
        planPrice={planPrice}
        planUnit={planUnit}
      />
      <Separator />
      {billingActions}
    </>
  )
}

interface BillingProUnavailableSectionProps {
  billingActions: ReactNode
}

export function BillingProUnavailableSection({ billingActions }: BillingProUnavailableSectionProps) {
  return (
    <>
      <Separator />
      {billingActions}
    </>
  )
}

interface BillingFreeTierSectionProps {
  needsBillingRecovery: boolean
  itemsCount: number
  collectionsCount: number
  canManageBilling: boolean
  billingActions: ReactNode
}

export function BillingFreeTierSection({
  needsBillingRecovery,
  itemsCount,
  collectionsCount,
  canManageBilling,
  billingActions,
}: BillingFreeTierSectionProps) {
  const itemPercent = Math.min((itemsCount / FREE_TIER_ITEM_LIMIT) * 100, 100)
  const collectionPercent = Math.min((collectionsCount / FREE_TIER_COLLECTION_LIMIT) * 100, 100)

  return (
    <>
      {needsBillingRecovery && (
        <p className="text-xs text-muted-foreground">
          {getBillingRecoveryHint()}
        </p>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Items</span>
            <span className="text-muted-foreground">{itemsCount} / {FREE_TIER_ITEM_LIMIT}</span>
          </div>
          <Progress value={itemPercent} className="h-2" />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Collections</span>
            <span className="text-muted-foreground">{collectionsCount} / {FREE_TIER_COLLECTION_LIMIT}</span>
          </div>
          <Progress value={collectionPercent} className="h-2" />
        </div>
      </div>

      {canManageBilling && (
        <p className="text-xs text-muted-foreground">
          {getProContentRetentionHint()}
        </p>
      )}

      <Separator />
      {billingActions}
    </>
  )
}
