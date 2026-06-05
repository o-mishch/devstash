import { Suspense } from 'react'
import { CreditCard, CheckCircle2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { getSession } from '@/lib/session'
import { getUserUsage, FREE_TIER_ITEM_LIMIT, FREE_TIER_COLLECTION_LIMIT } from '@/lib/usage'
import { getUserSubscriptionDates } from '@/lib/db/stripe'
import { formatDate } from '@/lib/utils/format'
import { BillingForms } from './billing-actions'

export async function BillingSettings() {
  const session = await getSession()
  const userId = session?.user?.id
  const isPro = session?.user?.isPro ?? false

  if (!userId) return null

  const [usage, subscriptionDates] = await Promise.all([
    getUserUsage(userId),
    isPro ? getUserSubscriptionDates(userId).catch(() => null) : Promise.resolve(null),
  ])

  const itemPercent = Math.min((usage.itemsCount / FREE_TIER_ITEM_LIMIT) * 100, 100)
  const collectionPercent = Math.min((usage.collectionsCount / FREE_TIER_COLLECTION_LIMIT) * 100, 100)

  const subscriptionStart = subscriptionDates?.subscriptionStart ?? null
  const currentPeriodEnd = subscriptionDates?.currentPeriodEnd ?? null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-5 text-muted-foreground" />
            Billing & Usage
          </CardTitle>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            Current plan:
            <Badge variant={isPro ? 'default' : 'secondary'}>
              {isPro ? 'Pro' : 'Free'}
            </Badge>
          </span>
        </div>
        <CardDescription>
          Manage your subscription and view your current usage
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPro ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
              <CheckCircle2 className="size-5 text-primary shrink-0" />
              <div>
                <p className="font-medium">DevStash Pro Active</p>
                <p className="text-sm text-muted-foreground">You have unlimited items and collections.</p>
              </div>
            </div>
            {(subscriptionStart || currentPeriodEnd) && (
              <div className="rounded-lg border border-border p-4 space-y-3 text-sm">
                {subscriptionStart && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Member since</span>
                    <span className="font-medium">{formatDate(subscriptionStart, true)}</span>
                  </div>
                )}
                {currentPeriodEnd && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Next payment</span>
                    <span className="font-medium">{formatDate(currentPeriodEnd, true)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
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
        )}

        <div className="pt-4 border-t">
          <Suspense fallback={null}>
            <BillingForms
              isPro={isPro}
              priceIdMonthly={process.env.STRIPE_PRICE_ID_MONTHLY}
              priceIdYearly={process.env.STRIPE_PRICE_ID_YEARLY}
            />
          </Suspense>
        </div>
      </CardContent>
    </Card>
  )
}
