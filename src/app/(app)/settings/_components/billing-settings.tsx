import { Suspense } from 'react'
import { CreditCard, CheckCircle2, Clock, Zap } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { getSession } from '@/lib/session'
import { getUserUsage, FREE_TIER_ITEM_LIMIT, FREE_TIER_COLLECTION_LIMIT } from '@/lib/usage'
import { getSubscriptionForDisplay } from '@/lib/db/stripe'
import { formatDate } from '@/lib/utils/format'
import { PRICING } from '@/lib/utils/constants'
import { BillingForms } from './billing-actions'
import type { SubscriptionInterval } from '@/generated/prisma'

interface DetailRowProps {
  label: string
  value: string
  valueClassName?: string
}

function DetailRow({ label, value, valueClassName }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${valueClassName ?? ''}`}>{value}</span>
    </div>
  )
}

const INTERVAL_INFO = {
  year: { label: 'Yearly', price: PRICING.yearly.amount, unit: 'year' },
  month: { label: 'Monthly', price: PRICING.monthly.amount, unit: 'month' },
} as const

function getIntervalInfo(interval: SubscriptionInterval | null) {
  return INTERVAL_INFO[interval ?? 'month']
}

export async function BillingSettings() {
  const session = await getSession()
  const userId = session?.user?.id
  const isPro = session?.user?.isPro ?? false

  if (!userId) return null

  const [usage, stripeInfo] = await Promise.all([
    getUserUsage(userId),
    isPro ? getSubscriptionForDisplay(userId).catch(() => null) : Promise.resolve(null),
  ])

  const itemPercent = Math.min((usage.itemsCount / FREE_TIER_ITEM_LIMIT) * 100, 100)
  const collectionPercent = Math.min((usage.collectionsCount / FREE_TIER_COLLECTION_LIMIT) * 100, 100)

  const subscriptionStart = stripeInfo?.subscriptionStart ?? null
  const currentPeriodEnd = stripeInfo?.currentPeriodEnd ?? null
  const cancelAtPeriodEnd = stripeInfo?.cancelAtPeriodEnd ?? false
  const interval = stripeInfo?.subscriptionInterval ?? null
  const isStale = stripeInfo?.isStale ?? false

  const { label, price, unit } = getIntervalInfo(interval)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-5 text-muted-foreground" />
            Billing & Usage
          </CardTitle>
          <Badge variant={isPro ? 'default' : 'secondary'} className="text-base px-4 py-1.5">
            {isPro ? 'Pro' : 'Free'}
          </Badge>
        </div>
        <CardDescription>
          Manage your subscription and view your current usage
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {isPro ? (
          <>
            {/* Subscription status + details — single unified section */}
            <div className={`rounded-lg border divide-y ${cancelAtPeriodEnd ? 'border-amber-500/40' : ''}`}>
              {/* Status header row */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`size-4 ${cancelAtPeriodEnd ? 'text-amber-500' : 'text-emerald-500'}`} />
                  <span className="text-sm font-semibold">DevStash Pro</span>
                </div>
                {cancelAtPeriodEnd ? (
                  <Badge variant="outline" className="text-amber-500 border-amber-500/50 bg-amber-500/10 gap-1.5 text-xs">
                    <Clock className="size-3" />
                    Canceling
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/50 bg-emerald-500/10 gap-1.5 text-xs">
                    <CheckCircle2 className="size-3" />
                    Active
                  </Badge>
                )}
              </div>

              {/* Data rows */}
              <DetailRow label="Plan" value={`${label} · ${price} / ${unit}`} />
              {subscriptionStart && (
                <DetailRow
                  label="Pro since"
                  value={formatDate(subscriptionStart, true)}
                />
              )}
              {cancelAtPeriodEnd ? (
                <DetailRow
                  label="Access ends"
                  value={currentPeriodEnd ? formatDate(currentPeriodEnd, true) : '—'}
                  valueClassName="text-amber-500"
                />
              ) : (
                <DetailRow
                  label="Next renewal"
                  value={currentPeriodEnd ? formatDate(currentPeriodEnd, true) : '—'}
                />
              )}

              {/* Inline canceling notice — no separate warning box */}
              {cancelAtPeriodEnd && currentPeriodEnd && (
                <div className="px-4 py-3 bg-amber-500/5">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Your subscription won&apos;t renew. Pro access continues until <strong>{formatDate(currentPeriodEnd, true)}</strong>, then you&apos;ll move to the free plan.
                  </p>
                </div>
              )}
            </div>

            <Separator />

            <Suspense fallback={null}>
              <BillingForms
                isPro={isPro}
                isCanceling={cancelAtPeriodEnd}
                priceIdMonthly={process.env.STRIPE_PRICE_ID_MONTHLY}
                priceIdYearly={process.env.STRIPE_PRICE_ID_YEARLY}
                isStale={isStale}
              />
            </Suspense>
          </>
        ) : (
          <>
            {/* Usage bars */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Items</span>
                  <span className="text-muted-foreground">{usage.itemsCount} / {FREE_TIER_ITEM_LIMIT}</span>
                </div>
                <Progress value={itemPercent} className="h-2" />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Collections</span>
                  <span className="text-muted-foreground">{usage.collectionsCount} / {FREE_TIER_COLLECTION_LIMIT}</span>
                </div>
                <Progress value={collectionPercent} className="h-2" />
              </div>
            </div>

            {/* Upgrade nudge */}
            <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-start gap-3">
              <Zap className="size-4 text-primary mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Unlock Pro</p>
                <p className="text-xs text-muted-foreground">
                  File & image uploads, unlimited items and collections.
                </p>
              </div>
            </div>

            <Separator />

            <Suspense fallback={null}>
              <BillingForms
                isPro={isPro}
                isCanceling={false}
                priceIdMonthly={process.env.STRIPE_PRICE_ID_MONTHLY}
                priceIdYearly={process.env.STRIPE_PRICE_ID_YEARLY}
              />
            </Suspense>
          </>
        )}
      </CardContent>
    </Card>
  )
}
